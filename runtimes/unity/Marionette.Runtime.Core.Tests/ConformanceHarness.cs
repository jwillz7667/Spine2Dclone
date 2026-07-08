using System;
using System.Collections.Generic;
using System.IO;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.Json;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Tests
{
    // Loads a committed rig, its sample spec, and its expected fixture, runs the shared C# solve at the
    // spec times, and compares against the fixture using the exact A.5 tolerance policy. Integer/structural
    // quantities (sample count, per index time, animation id, bone set, mesh set, vertex count) compare
    // EXACT; the world affines and mesh vertices compare within tolerance.
    public sealed class ConformanceResult
    {
        public bool Ok => Failures.Count == 0;
        public List<string> Failures { get; } = new List<string>();
        public double MaxBasisError { get; set; }
        public double MaxTranslationError { get; set; }
        public double MaxVertexError { get; set; }
        public int LaneComparisons { get; set; }
    }

    public static class ConformanceHarness
    {
        public static ConformanceResult Run(string rigId)
        {
            var result = new ConformanceResult();

            SkeletonDocument document = RigReader.Parse(File.ReadAllText(RepoPaths.RigJson(rigId)));
            SampleSpec spec = SampleSpec.Load(RepoPaths.SampleSpec(rigId));
            Fixture fixture = Fixture.Load(RepoPaths.Fixture(rigId));

            if (spec.PoseTimes.Count != fixture.Samples.Count)
            {
                result.Failures.Add(
                    $"sample count mismatch: spec has {spec.PoseTimes.Count} poseTimes, "
                    + $"fixture has {fixture.Samples.Count} samples");
                return result;
            }

            Pose pose = BuildPose.Build(document);
            var boneIndexByName = new Dictionary<string, int>();
            for (int i = 0; i < pose.BoneNames.Count; i += 1)
            {
                boneIndexByName[pose.BoneNames[i]] = i;
            }

            int maxMeshLanes = MaxMeshLanes(fixture);
            float[]? vertexScratch = maxMeshLanes > 0 ? new float[maxMeshLanes] : null;

            for (int s = 0; s < fixture.Samples.Count; s += 1)
            {
                FixtureSample sample = fixture.Samples[s];
                if (sample.Time != spec.PoseTimes[s])
                {
                    result.Failures.Add(
                        $"sample {s} time mismatch: spec {spec.PoseTimes[s]}, fixture {sample.Time}");
                    continue;
                }

                if (sample.Animation != spec.Animation)
                {
                    result.Failures.Add(
                        $"sample at t={sample.Time} animation mismatch: spec '{spec.Animation}', "
                        + $"fixture '{sample.Animation}'");
                    continue;
                }

                Sample.SampleSkeleton(document, spec.Animation, sample.Time, pose);

                foreach (KeyValuePair<string, double[]> expectedBone in sample.Bones)
                {
                    if (!boneIndexByName.TryGetValue(expectedBone.Key, out int boneIndex))
                    {
                        result.Failures.Add(
                            $"bone '{expectedBone.Key}' at t={sample.Time} is not in the solved pose");
                        continue;
                    }

                    CompareAffine(result, rigId, sample.Time, expectedBone.Key, expectedBone.Value, pose, boneIndex);
                }

                CompareMeshes(result, document, spec, sample, pose, vertexScratch);
            }

            return result;
        }

        private static void CompareAffine(
            ConformanceResult result,
            string rigId,
            double time,
            string boneName,
            double[] expected,
            Pose pose,
            int boneIndex)
        {
            int worldOffset = boneIndex * Core.MathCore.Affine.Mat2x3Stride;
            for (int lane = 0; lane < 6; lane += 1)
            {
                double expectedValue = expected[lane];
                double actualValue = pose.World[worldOffset + lane];
                Tolerance tol = Tolerances.ForLane(lane);
                double delta = Math.Abs(actualValue - expectedValue);
                if (lane < 4)
                {
                    result.MaxBasisError = Math.Max(result.MaxBasisError, delta);
                }
                else
                {
                    result.MaxTranslationError = Math.Max(result.MaxTranslationError, delta);
                }

                result.LaneComparisons += 1;
                if (!tol.Within(actualValue, expectedValue))
                {
                    result.Failures.Add(
                        $"[{rigId}] bone '{boneName}' world lane {lane} at t={time} drifts: "
                        + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                }
            }
        }

        private static void CompareMeshes(
            ConformanceResult result,
            SkeletonDocument document,
            SampleSpec spec,
            FixtureSample sample,
            Pose pose,
            float[]? vertexScratch)
        {
            if (sample.Meshes.Count == 0)
            {
                return;
            }

            foreach (MeshVertices expectedMesh in sample.Meshes)
            {
                if (vertexScratch == null)
                {
                    result.Failures.Add("mesh present in fixture but no vertex scratch was allocated");
                    return;
                }

                int vertexCount = MeshSample.SampleMeshVertices(
                    document,
                    spec.Animation,
                    sample.Time,
                    pose,
                    expectedMesh.Skin,
                    expectedMesh.Slot,
                    expectedMesh.Attachment,
                    vertexScratch);

                if (vertexCount * 2 != expectedMesh.Positions.Count)
                {
                    result.Failures.Add(
                        $"mesh '{expectedMesh.Key}' at t={sample.Time} vertex count mismatch: "
                        + $"expected {expectedMesh.Positions.Count} lanes, actual {vertexCount * 2}");
                    continue;
                }

                for (int lane = 0; lane < expectedMesh.Positions.Count; lane += 1)
                {
                    double expectedValue = expectedMesh.Positions[lane];
                    double actualValue = vertexScratch[lane];
                    double delta = Math.Abs(actualValue - expectedValue);
                    result.MaxVertexError = Math.Max(result.MaxVertexError, delta);
                    result.LaneComparisons += 1;
                    if (!Tolerances.Vertex.Within(actualValue, expectedValue))
                    {
                        result.Failures.Add(
                            $"mesh '{expectedMesh.Key}' vertex lane {lane} at t={sample.Time} drifts: "
                            + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                    }
                }
            }
        }

        private static int MaxMeshLanes(Fixture fixture)
        {
            int max = 0;
            foreach (FixtureSample sample in fixture.Samples)
            {
                foreach (MeshVertices mesh in sample.Meshes)
                {
                    if (mesh.Positions.Count > max)
                    {
                        max = mesh.Positions.Count;
                    }
                }
            }

            return max;
        }
    }

    // A minimal reader for the committed sample spec (packages/conformance/src/sample-spec/*.json), using
    // the core's dependency free JSON parser. Reads only the fields the harness consumes.
    public sealed class SampleSpec
    {
        public string RigId { get; }
        public string Animation { get; }
        public bool Loop { get; }
        public IReadOnlyList<double> PoseTimes { get; }

        private SampleSpec(string rigId, string animation, bool loop, IReadOnlyList<double> poseTimes)
        {
            RigId = rigId;
            Animation = animation;
            Loop = loop;
            PoseTimes = poseTimes;
        }

        public static SampleSpec Load(string path)
        {
            JsonValue root = JsonParser.Parse(File.ReadAllText(path));
            var poseTimes = new List<double>();
            foreach (JsonValue time in root.Member("poseTimes")!.AsArray())
            {
                poseTimes.Add(time.AsNumber());
            }

            return new SampleSpec(
                root.Member("rigId")!.AsString(),
                root.Member("animation")!.AsString(),
                root.Member("loop")!.AsBool(),
                poseTimes);
        }
    }

    public sealed class MeshVertices
    {
        public string Skin { get; }
        public string Slot { get; }
        public string Attachment { get; }
        public IReadOnlyList<double> Positions { get; }

        public string Key => $"{Skin}/{Slot}/{Attachment}";

        public MeshVertices(string skin, string slot, string attachment, IReadOnlyList<double> positions)
        {
            Skin = skin;
            Slot = slot;
            Attachment = attachment;
            Positions = positions;
        }
    }

    public sealed class FixtureSample
    {
        public double Time { get; }
        public string Animation { get; }

        // Bone world affines, in document order (insertion order preserved by the parser).
        public IReadOnlyList<KeyValuePair<string, double[]>> Bones { get; }
        public IReadOnlyList<MeshVertices> Meshes { get; }

        public FixtureSample(
            double time,
            string animation,
            IReadOnlyList<KeyValuePair<string, double[]>> bones,
            IReadOnlyList<MeshVertices> meshes)
        {
            Time = time;
            Animation = animation;
            Bones = bones;
            Meshes = meshes;
        }
    }

    // A minimal reader for the committed expected fixture (packages/conformance/src/fixtures/*.json).
    public sealed class Fixture
    {
        public string RigId { get; }
        public IReadOnlyList<FixtureSample> Samples { get; }

        private Fixture(string rigId, IReadOnlyList<FixtureSample> samples)
        {
            RigId = rigId;
            Samples = samples;
        }

        public static Fixture Load(string path)
        {
            JsonValue root = JsonParser.Parse(File.ReadAllText(path));
            var samples = new List<FixtureSample>();
            foreach (JsonValue sample in root.Member("samples")!.AsArray())
            {
                var bones = new List<KeyValuePair<string, double[]>>();
                foreach (KeyValuePair<string, JsonValue> boneEntry in sample.Member("bones")!.Members())
                {
                    IReadOnlyList<JsonValue> lanes = boneEntry.Value.AsArray();
                    var affine = new double[lanes.Count];
                    for (int i = 0; i < lanes.Count; i += 1)
                    {
                        affine[i] = lanes[i].AsNumber();
                    }

                    bones.Add(new KeyValuePair<string, double[]>(boneEntry.Key, affine));
                }

                var meshes = new List<MeshVertices>();
                JsonValue? meshesValue = sample.Member("meshes");
                if (meshesValue != null && meshesValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue mesh in meshesValue.AsArray())
                    {
                        var positions = new List<double>();
                        foreach (JsonValue lane in mesh.Member("positions")!.AsArray())
                        {
                            positions.Add(lane.AsNumber());
                        }

                        meshes.Add(new MeshVertices(
                            mesh.Member("skin")!.AsString(),
                            mesh.Member("slot")!.AsString(),
                            mesh.Member("attachment")!.AsString(),
                            positions));
                    }
                }

                samples.Add(new FixtureSample(
                    sample.Member("time")!.AsNumber(),
                    sample.Member("animation")!.AsString(),
                    bones,
                    meshes));
            }

            return new Fixture(root.Member("rigId")!.AsString(), samples);
        }
    }
}
