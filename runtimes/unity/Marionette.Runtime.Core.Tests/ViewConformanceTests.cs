using System.Collections.Generic;
using System.IO;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.Skeleton;
using Marionette.Runtime.View;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // Ties the engine-agnostic VIEW layer (Marionette.Runtime.View) to the committed conformance corpus. The
    // view's mesh world positions come from the SAME MeshSample calls the solve harness asserts, so gathering
    // the draw items and comparing their world geometry to the fixtures proves the view path does not drift
    // from the behavioral oracle. Draw ORDER (solve-order step 6) is asserted structurally: every gathered
    // item sits at its draw-order render position. Region placement, atlas UV mapping, and buffer batching
    // are covered by their own focused suites (ViewGeometryTests, MeshBufferAssemblerTests).
    public sealed class ViewConformanceTests
    {
        private const string DefaultSkin = "default";

        // Rigs whose fixtures capture mesh world vertices; each is gathered through the view and compared to
        // the fixture within the shared A.5 VERTEX tolerance. rig-clipping additionally carries a draw-order
        // permutation, so it doubles as the mesh draw-order case.
        public static IEnumerable<object[]> MeshRigs()
        {
            yield return new object[] { "rig-rigid-mesh" };
            yield return new object[] { "rig-weighted-mesh" };
            yield return new object[] { "rig-linked-mesh" };
            yield return new object[] { "rig-deform" };
            yield return new object[] { "rig-clipping" };
        }

        [Theory]
        [MemberData(nameof(MeshRigs))]
        public void MeshDrawItemWorldPositionsMatchTheFixture(string rigId)
        {
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            int comparisons = 0;
            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                scene.Sample(spec, sample, s);
                SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);

                foreach (MeshVertices expected in sample.Meshes)
                {
                    Assert.Equal(DefaultSkin, expected.Skin);
                    int slotIndex = scene.SlotIndex(expected.Slot);

                    // The fixture may capture a slot's NON-active attachments too (solve coverage, e.g. the
                    // linked-mesh rig captures body/bodyShared/bodyOwn). The view draws only the ACTIVE
                    // attachment, so compare only the fixture entry that matches the resolved active name.
                    if (scene.Pose.SlotAttachment[slotIndex] != expected.Attachment)
                    {
                        continue;
                    }

                    DrawItem item = FindItem(items, slotIndex);
                    Assert.Equal(expected.Positions.Count, item.VertexCount * 2);
                    for (int lane = 0; lane < expected.Positions.Count; lane += 1)
                    {
                        double actual = item.WorldPositions[lane];
                        Assert.True(
                            Tolerances.Vertex.Within(actual, expected.Positions[lane]),
                            $"[{rigId}] mesh '{expected.Key}' vertex lane {lane} at t={sample.Time}: "
                            + $"expected {expected.Positions[lane]:R}, view {actual:R}");
                        comparisons += 1;
                    }
                }
            }

            Assert.True(comparisons > 0, $"[{rigId}] no mesh draw items were compared");
        }

        // Every gathered draw item sits at its own render position in the solved draw order (solve-order step
        // 6): items[i].SlotIndex == pose.drawOrder[items[i].RenderPosition], and render positions strictly
        // ascend. Because the harness independently locks pose.drawOrder to the fixture permutation for
        // rig-clipping, this ties the view's draw order to the oracle transitively.
        [Theory]
        [MemberData(nameof(MeshRigs))]
        public void DrawItemsAreEmittedInDrawOrder(string rigId)
        {
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                scene.Sample(spec, sample, s);
                SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);

                int previousPosition = -1;
                for (int i = 0; i < items.Count; i += 1)
                {
                    DrawItem item = items[i];
                    Assert.True(
                        item.RenderPosition > previousPosition,
                        $"[{rigId}] draw item {i} render position {item.RenderPosition} did not ascend");
                    previousPosition = item.RenderPosition;
                    Assert.Equal(scene.Pose.DrawOrder[item.RenderPosition], item.SlotIndex);
                }
            }
        }

        // rig-blendmodes: each region slot's draw item carries the slot's static blend mode EXACTLY and its
        // resolved LIGHT tint equals the pose slot color times the (white) attachment color, so the tint rides
        // the same COLOR tolerance the harness applies to the slot color.
        [Fact]
        public void RegionDrawItemsCarryBlendModeAndTint()
        {
            const string rigId = "rig-blendmodes";
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            int comparisons = 0;
            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                scene.Sample(spec, sample, s);
                SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);

                foreach (SlotState expected in sample.Slots)
                {
                    int slotIndex = scene.SlotIndex(expected.Slot);
                    DrawItem item = FindItem(items, slotIndex);
                    Assert.Equal(expected.BlendMode, item.Blend);

                    // The attachment color for rig-blendmodes is opaque white, so tint rgb equals the pose slot
                    // color rgb and alpha equals the slot color alpha (both on the COLOR tolerance).
                    Assert.True(Tolerances.Color.Within(item.Tint.R, expected.Color[0]));
                    Assert.True(Tolerances.Color.Within(item.Tint.G, expected.Color[1]));
                    Assert.True(Tolerances.Color.Within(item.Tint.B, expected.Color[2]));
                    Assert.True(Tolerances.Color.Within(item.Alpha, expected.Color[3]));
                    comparisons += 1;
                }
            }

            Assert.True(comparisons > 0, $"[{rigId}] no region draw items were compared");
        }

        // rig-sequences: the region slot's draw item resolves its atlas region NAME through the sequence, so
        // the drawn region matches the fixture's resolved integer frame turned into a name (path + zero-padded
        // start+frame). The committed rig's atlas carries only the base region, so the numbered frame names
        // deliberately fall back to the white placeholder; the test asserts the NAMING, the renderer's job.
        [Fact]
        public void SequenceDrawItemsResolveTheFrameRegionName()
        {
            const string rigId = "rig-sequences";
            ViewScene scene = ViewScene.Load(rigId);
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            int comparisons = 0;
            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                scene.Sample(spec, sample, s);
                SkeletonDrawList items = scene.GatherDrawItems(spec.Animation, sample.Time);

                foreach (SequenceFrame expected in sample.Sequences)
                {
                    int slotIndex = scene.SlotIndex(expected.Slot);
                    DrawItem item = FindItem(items, slotIndex);

                    RenderSkin skin = scene.RenderModel.FindSkin(DefaultSkin)!;
                    string activeName = scene.Pose.SlotAttachment[slotIndex]!;
                    RenderAttachment attachment = skin.Find(expected.Slot, activeName)!;
                    RenderSequence sequence = attachment.Sequence!.Value;
                    string expectedName = DrawItemBuilder.RenderSequenceName(
                        attachment.Region!.Path, sequence, expected.Frame);

                    Assert.Equal(expectedName, item.RegionPath);
                    comparisons += 1;
                }
            }

            Assert.True(comparisons > 0, $"[{rigId}] no sequence draw items were compared");
        }

        private static DrawItem FindItem(SkeletonDrawList items, int slotIndex)
        {
            for (int i = 0; i < items.Count; i += 1)
            {
                if (items[i].SlotIndex == slotIndex)
                {
                    return items[i];
                }
            }

            Assert.Fail($"no draw item was gathered for slot index {slotIndex}");
            return null!;
        }
    }

    // A loaded, solvable view scene for one rig: the solve document, the render model, the atlas index, and a
    // reusable pose plus name-index maps. Sample() solves the pose at a fixture sample (mirroring the
    // conformance harness's sampling, including the physics frame delta), and GatherDrawItems runs the view
    // builder against the solved pose.
    public sealed class ViewScene
    {
        public SkeletonDocument Document { get; }
        public RenderModel RenderModel { get; }
        public AtlasIndex Atlas { get; }
        public Pose Pose { get; }

        private readonly Dictionary<string, int> _slotIndexByName = new Dictionary<string, int>();
        private readonly SkeletonDrawList _drawList = new SkeletonDrawList();

        private ViewScene(SkeletonDocument document, RenderModel renderModel, AtlasIndex atlas, Pose pose)
        {
            Document = document;
            RenderModel = renderModel;
            Atlas = atlas;
            Pose = pose;
            for (int i = 0; i < pose.SlotNames.Count; i += 1)
            {
                _slotIndexByName[pose.SlotNames[i]] = i;
            }
        }

        public static ViewScene Load(string rigId)
        {
            string json = File.ReadAllText(RepoPaths.RigJson(rigId));
            SkeletonDocument document = RigReader.Parse(json);
            RenderModel renderModel = RenderModelReader.Parse(json);
            var atlas = new AtlasIndex(renderModel.Atlas);
            Pose pose = BuildPose.Build(document);
            return new ViewScene(document, renderModel, atlas, pose);
        }

        public int SlotIndex(string name) => _slotIndexByName[name];

        public void Sample(SampleSpec spec, FixtureSample sample, int sampleIndex)
        {
            string? activeSkin = sampleIndex < spec.ActiveSkins.Count ? spec.ActiveSkins[sampleIndex] : null;
            double frameDt = sampleIndex == 0 ? 0 : spec.PoseTimes[sampleIndex] - spec.PoseTimes[sampleIndex - 1];
            Skeleton.Sample.SampleSkeleton(Document, spec.Animation, sample.Time, Pose, activeSkin, frameDt);
        }

        public SkeletonDrawList GatherDrawItems(string animationId, double sampleTime)
        {
            DrawItemBuilder.BuildInto(
                Document, RenderModel, Atlas, Pose, "default", animationId, sampleTime, _drawList);
            return _drawList;
        }
    }
}
