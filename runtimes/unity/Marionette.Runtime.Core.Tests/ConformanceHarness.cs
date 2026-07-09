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
        public double MaxColorError { get; set; }
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

            var slotIndexByName = new Dictionary<string, int>();
            for (int i = 0; i < pose.SlotNames.Count; i += 1)
            {
                slotIndexByName[pose.SlotNames[i]] = i;
            }

            var blendModeByName = new Dictionary<string, string>();
            foreach (Slot slot in document.Slots)
            {
                blendModeByName[slot.Name] = slot.BlendMode;
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
                CompareSlots(result, rigId, sample, pose, slotIndexByName, blendModeByName);
                CompareDrawOrder(result, rigId, sample, pose);
                CompareSequences(result, rigId, document, spec, sample, pose);
            }

            CompareEvents(result, rigId, document, spec, fixture);

            return result;
        }

        // Compare one sample's per-slot presentation state (PP-B1, rig-blendmodes, solve-order step 6): the
        // static blendMode compares EXACT, the resolved color rides the COLOR tolerance. Present only on
        // rigs whose sample-spec captures slots; absent samples short-circuit.
        private static void CompareSlots(
            ConformanceResult result,
            string rigId,
            FixtureSample sample,
            Pose pose,
            Dictionary<string, int> slotIndexByName,
            Dictionary<string, string> blendModeByName)
        {
            if (sample.Slots.Count == 0)
            {
                return;
            }

            foreach (SlotState expectedSlot in sample.Slots)
            {
                if (!slotIndexByName.TryGetValue(expectedSlot.Slot, out int slotIndex))
                {
                    result.Failures.Add(
                        $"[{rigId}] slot '{expectedSlot.Slot}' at t={sample.Time} is not in the solved pose");
                    continue;
                }

                blendModeByName.TryGetValue(expectedSlot.Slot, out string? actualBlend);
                if (actualBlend != expectedSlot.BlendMode)
                {
                    result.Failures.Add(
                        $"[{rigId}] slot '{expectedSlot.Slot}' at t={sample.Time} blend mode mismatch: "
                        + $"expected '{expectedSlot.BlendMode}', actual '{actualBlend}'");
                }

                int colorBase = slotIndex * Pose.SlotColorStride;
                for (int k = 0; k < Pose.SlotColorStride; k += 1)
                {
                    double expectedValue = expectedSlot.Color[k];
                    double actualValue = pose.SlotColor[colorBase + k];
                    double delta = Math.Abs(actualValue - expectedValue);
                    result.MaxColorError = Math.Max(result.MaxColorError, delta);
                    result.LaneComparisons += 1;
                    if (!Tolerances.Color.Within(actualValue, expectedValue))
                    {
                        result.Failures.Add(
                            $"[{rigId}] slot '{expectedSlot.Slot}' color lane {k} at t={sample.Time} drifts: "
                            + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                    }
                }

                // The resolved two-color dark tint (ADR-0009 section 4.3, ADR-0011 section 3). The fixture
                // carries a `dark` array ONLY for a slot with a setup darkColor; the pose records that in
                // SlotHasDarkColor. Compare presence structurally (a fixture `dark` must line up with the flag),
                // then each RGBA lane on the COLOR tolerance, exactly like the slot color.
                bool expectedHasDark = expectedSlot.Dark != null;
                bool actualHasDark = pose.SlotHasDarkColor[slotIndex] == 1;
                if (expectedHasDark != actualHasDark)
                {
                    result.Failures.Add(
                        $"[{rigId}] slot '{expectedSlot.Slot}' at t={sample.Time} dark presence mismatch: "
                        + $"fixture {(expectedHasDark ? "has" : "omits")} a dark lane, pose "
                        + $"{(actualHasDark ? "has" : "omits")} a setup dark color");
                }
                else if (expectedHasDark)
                {
                    int darkBase = slotIndex * Pose.SlotColorStride;
                    for (int k = 0; k < Pose.SlotColorStride; k += 1)
                    {
                        double expectedValue = expectedSlot.Dark![k];
                        double actualValue = pose.SlotDarkColor[darkBase + k];
                        double delta = Math.Abs(actualValue - expectedValue);
                        result.MaxColorError = Math.Max(result.MaxColorError, delta);
                        result.LaneComparisons += 1;
                        if (!Tolerances.Color.Within(actualValue, expectedValue))
                        {
                            result.Failures.Add(
                                $"[{rigId}] slot '{expectedSlot.Slot}' dark lane {k} at t={sample.Time} drifts: "
                                + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                        }
                    }
                }
            }
        }

        // Compare one sample's resolved sequence frames (ADR-0011 section 2): for each per-slot { slot, frame }
        // the fixture records, resolve the discrete integer frame from the solved pose and compare EXACT (slot
        // name + integer frame, index by index). Present only on rigs whose sample-spec sets captureSequences
        // (the fixture then carries the sequences lane); absent samples short-circuit. Cross-checks the fixture
        // lane length against the spec's captureSequences so a dropped slot fails loudly rather than silently.
        private static void CompareSequences(
            ConformanceResult result,
            string rigId,
            SkeletonDocument document,
            SampleSpec spec,
            FixtureSample sample,
            Pose pose)
        {
            if (sample.Sequences.Count == 0)
            {
                return;
            }

            if (spec.CaptureSequences.Count != sample.Sequences.Count)
            {
                result.Failures.Add(
                    $"[{rigId}] sequence lane length mismatch at t={sample.Time}: spec captureSequences has "
                    + $"{spec.CaptureSequences.Count}, fixture has {sample.Sequences.Count}");
                return;
            }

            for (int i = 0; i < sample.Sequences.Count; i += 1)
            {
                SequenceFrame expected = sample.Sequences[i];
                if (expected.Slot != spec.CaptureSequences[i])
                {
                    result.Failures.Add(
                        $"[{rigId}] sequence slot mismatch at t={sample.Time}, index {i}: spec "
                        + $"'{spec.CaptureSequences[i]}', fixture '{expected.Slot}'");
                    continue;
                }

                int actual = Sequence.SampleSlotSequenceFrame(document, spec.Animation, sample.Time, pose, expected.Slot);
                result.LaneComparisons += 1;
                if (actual != expected.Frame)
                {
                    result.Failures.Add(
                        $"[{rigId}] sequence frame mismatch for slot '{expected.Slot}' at t={sample.Time}: "
                        + $"expected {expected.Frame}, actual {actual}");
                }
            }
        }

        // Compare the resolved render order of one sample (ADR-0008, PP-B4): an integer permutation, EXACT.
        private static void CompareDrawOrder(ConformanceResult result, string rigId, FixtureSample sample, Pose pose)
        {
            if (sample.DrawOrder == null)
            {
                return;
            }

            if (sample.DrawOrder.Count != pose.SlotCount)
            {
                result.Failures.Add(
                    $"[{rigId}] draw order length mismatch at t={sample.Time}: "
                    + $"expected {sample.DrawOrder.Count}, actual {pose.SlotCount}");
                return;
            }

            for (int i = 0; i < sample.DrawOrder.Count; i += 1)
            {
                result.LaneComparisons += 1;
                if (pose.DrawOrder[i] != sample.DrawOrder[i])
                {
                    result.Failures.Add(
                        $"[{rigId}] draw order mismatch at t={sample.Time}, position {i}: "
                        + $"expected {sample.DrawOrder[i]}, actual {pose.DrawOrder[i]}");
                }
            }
        }

        // Sweep the sample-spec eventStep and compare the fired-event log to the committed fixture
        // (ADR-0008, PP-B4). Name/int/string/time are EXACT; the float payload rides the EVENT_FLOAT
        // tolerance. The log is ordered, so entries are matched index by index.
        private static void CompareEvents(
            ConformanceResult result,
            string rigId,
            SkeletonDocument document,
            SampleSpec spec,
            Fixture fixture)
        {
            if (spec.EventStep == null)
            {
                return;
            }

            Animation? animation = document.FindAnimation(spec.Animation);
            if (animation == null)
            {
                result.Failures.Add($"[{rigId}] event sweep animation '{spec.Animation}' not found");
                return;
            }

            PreparedEventTimeline? timeline = EventFire.PrepareEventTimeline(animation, document.Events);
            EventQueue queue = EventFire.MakeEventQueue();
            if (timeline != null)
            {
                EventFire.CollectFiredEvents(
                    timeline,
                    spec.EventStep.From,
                    spec.EventStep.To,
                    spec.EventStep.Dt,
                    spec.Loop,
                    spec.Duration,
                    queue);
            }

            if (queue.Count != fixture.Events.Count)
            {
                result.Failures.Add(
                    $"[{rigId}] fired-event count mismatch: expected {fixture.Events.Count}, actual {queue.Count}");
                return;
            }

            for (int i = 0; i < fixture.Events.Count; i += 1)
            {
                FiredEventRecord expected = fixture.Events[i];
                FiredEvent actual = queue.Events[i];
                string where = $"[{rigId}] event {i} ('{expected.Name}' at t={expected.Time})";
                result.LaneComparisons += 1;

                if (actual.Name != expected.Name)
                {
                    result.Failures.Add($"{where} name mismatch: expected '{expected.Name}', actual '{actual.Name}'");
                }

                if (actual.Time != expected.Time)
                {
                    result.Failures.Add($"{where} time mismatch: expected {expected.Time:R}, actual {actual.Time:R}");
                }

                if (actual.HasInt != expected.HasInt || (actual.HasInt && (int)actual.IntValue != expected.Int))
                {
                    result.Failures.Add($"{where} int payload mismatch");
                }

                if (actual.HasString != expected.HasString || (actual.HasString && actual.StringValue != expected.String))
                {
                    result.Failures.Add($"{where} string payload mismatch");
                }

                if (actual.HasFloat != expected.HasFloat)
                {
                    result.Failures.Add($"{where} float presence mismatch");
                }
                else if (actual.HasFloat && !Tolerances.EventFloat.Within(actual.FloatValue, expected.Float))
                {
                    result.Failures.Add(
                        $"{where} float payload drifts: expected {expected.Float:R}, actual {actual.FloatValue:R}");
                }
            }
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
    // The deterministic event-step sweep window (ADR-0008, PP-B4): advance from From to To in Dt frame
    // steps, firing events at each step. Present only when the sample-spec sets eventStep.
    public sealed class EventStep
    {
        public double Dt { get; }
        public double From { get; }
        public double To { get; }

        public EventStep(double dt, double from, double to)
        {
            Dt = dt;
            From = from;
            To = to;
        }
    }

    public sealed class SampleSpec
    {
        public string RigId { get; }
        public string Animation { get; }
        public bool Loop { get; }
        public double Duration { get; }
        public IReadOnlyList<double> PoseTimes { get; }
        public bool CaptureDrawOrder { get; }

        // The slot names whose sequence frame the fixture captures per sample (ADR-0011 section 2). Empty
        // when the sample-spec omits captureSequences, in which case the sequences lane is absent and the
        // harness compares nothing new, mirroring the drawOrder opt-in.
        public IReadOnlyList<string> CaptureSequences { get; }
        public EventStep? EventStep { get; }

        private SampleSpec(
            string rigId,
            string animation,
            bool loop,
            double duration,
            IReadOnlyList<double> poseTimes,
            bool captureDrawOrder,
            IReadOnlyList<string> captureSequences,
            EventStep? eventStep)
        {
            RigId = rigId;
            Animation = animation;
            Loop = loop;
            Duration = duration;
            PoseTimes = poseTimes;
            CaptureDrawOrder = captureDrawOrder;
            CaptureSequences = captureSequences;
            EventStep = eventStep;
        }

        public static SampleSpec Load(string path)
        {
            JsonValue root = JsonParser.Parse(File.ReadAllText(path));
            var poseTimes = new List<double>();
            foreach (JsonValue time in root.Member("poseTimes")!.AsArray())
            {
                poseTimes.Add(time.AsNumber());
            }

            JsonValue? captureValue = root.Member("captureDrawOrder");
            bool captureDrawOrder = captureValue != null
                && captureValue.Kind == JsonKind.Bool
                && captureValue.AsBool();

            var captureSequences = new List<string>();
            JsonValue? captureSequencesValue = root.Member("captureSequences");
            if (captureSequencesValue != null && captureSequencesValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue slot in captureSequencesValue.AsArray())
                {
                    captureSequences.Add(slot.AsString());
                }
            }

            EventStep? eventStep = null;
            JsonValue? eventStepValue = root.Member("eventStep");
            if (eventStepValue != null && eventStepValue.Kind == JsonKind.Object)
            {
                eventStep = new EventStep(
                    eventStepValue.Member("dt")!.AsNumber(),
                    eventStepValue.Member("from")!.AsNumber(),
                    eventStepValue.Member("to")!.AsNumber());
            }

            return new SampleSpec(
                root.Member("rigId")!.AsString(),
                root.Member("animation")!.AsString(),
                root.Member("loop")!.AsBool(),
                root.Member("duration")!.AsNumber(),
                poseTimes,
                captureDrawOrder,
                captureSequences,
                eventStep);
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

    // One slot's resolved presentation state at a sample time (PP-B1, rig-blendmodes): its static
    // blendMode (compared EXACT) and the color the animation resolved to (compared within the COLOR
    // tolerance). Mirrors slotStateSchema in schema/fixture.ts.
    public sealed class SlotState
    {
        public string Slot { get; }
        public string BlendMode { get; }
        public IReadOnlyList<double> Color { get; }

        // The resolved two-color DARK tint (ADR-0009 section 4.3, ADR-0011 section 3), RGBA, compared within
        // the COLOR tolerance. Present ONLY for a slot with a setup darkColor; null when the fixture entry
        // omits the `dark` lane (a slot with no two-color tinting), which the harness compares structurally
        // against the pose's SlotHasDarkColor flag.
        public IReadOnlyList<double>? Dark { get; }

        public SlotState(string slot, string blendMode, IReadOnlyList<double> color, IReadOnlyList<double>? dark)
        {
            Slot = slot;
            BlendMode = blendMode;
            Color = color;
            Dark = dark;
        }
    }

    // One slot's resolved sequence frame at a sample time (ADR-0011 section 2): the slot name and the
    // discrete integer frame the sequence solve resolves to, compared EXACT. Mirrors the { slot, frame }
    // entries in the fixture's per-sample sequences lane.
    public sealed class SequenceFrame
    {
        public string Slot { get; }
        public int Frame { get; }

        public SequenceFrame(string slot, int frame)
        {
            Slot = slot;
            Frame = frame;
        }
    }

    public sealed class FixtureSample
    {
        public double Time { get; }
        public string Animation { get; }

        // Bone world affines, in document order (insertion order preserved by the parser).
        public IReadOnlyList<KeyValuePair<string, double[]>> Bones { get; }
        public IReadOnlyList<MeshVertices> Meshes { get; }

        // Per-slot blend mode + resolved color (PP-B1), present only when the sample-spec captures slots.
        // Empty list when absent, so bone-only and mesh-only samples add no slot comparisons.
        public IReadOnlyList<SlotState> Slots { get; }

        // The resolved render order (ADR-0008, PP-B4): an integer permutation, present only when the
        // sample-spec captures it. Null otherwise.
        public IReadOnlyList<int>? DrawOrder { get; }

        // Per-slot resolved sequence frames (ADR-0011 section 2), present only when the sample-spec sets
        // captureSequences. Empty list when absent, so samples without a sequences lane add no comparisons.
        public IReadOnlyList<SequenceFrame> Sequences { get; }

        public FixtureSample(
            double time,
            string animation,
            IReadOnlyList<KeyValuePair<string, double[]>> bones,
            IReadOnlyList<MeshVertices> meshes,
            IReadOnlyList<SlotState> slots,
            IReadOnlyList<int>? drawOrder,
            IReadOnlyList<SequenceFrame> sequences)
        {
            Time = time;
            Animation = animation;
            Bones = bones;
            Meshes = meshes;
            Slots = slots;
            DrawOrder = drawOrder;
            Sequences = sequences;
        }
    }

    // One committed fired-event record (ADR-0008, PP-B4): name + fire time + resolved payload presence.
    public sealed class FiredEventRecord
    {
        public string Name { get; }
        public double Time { get; }
        public bool HasInt { get; }
        public int Int { get; }
        public bool HasFloat { get; }
        public double Float { get; }
        public bool HasString { get; }
        public string? String { get; }

        public FiredEventRecord(
            string name,
            double time,
            bool hasInt,
            int intValue,
            bool hasFloat,
            double floatValue,
            bool hasString,
            string? stringValue)
        {
            Name = name;
            Time = time;
            HasInt = hasInt;
            Int = intValue;
            HasFloat = hasFloat;
            Float = floatValue;
            HasString = hasString;
            String = stringValue;
        }
    }

    // A minimal reader for the committed expected fixture (packages/conformance/src/fixtures/*.json).
    public sealed class Fixture
    {
        public string RigId { get; }
        public IReadOnlyList<FixtureSample> Samples { get; }

        // The fixture-level fired-event log (ADR-0008, PP-B4), present only when the sample-spec set an
        // eventStep. Empty list when absent.
        public IReadOnlyList<FiredEventRecord> Events { get; }

        private Fixture(string rigId, IReadOnlyList<FixtureSample> samples, IReadOnlyList<FiredEventRecord> events)
        {
            RigId = rigId;
            Samples = samples;
            Events = events;
        }

        // The exhaustive member allowlists (mirror the .strict() fixtureSchema in schema/fixture.ts). A
        // fixture or sample carrying any member outside these sets is rejected: a NEW capture lane (a
        // future corpus growth) then fails LOUDLY here instead of being silently skipped, forcing the
        // native harness to grow a comparison for it.
        private static readonly HashSet<string> AllowedTopLevel = new HashSet<string>
        {
            "rigId", "rigHash", "specHash", "coreVersion", "toolchain", "generatedBy", "samples", "events",
        };

        private static readonly HashSet<string> AllowedSample = new HashSet<string>
        {
            "time", "animation", "loop", "bones", "meshes", "slots", "drawOrder", "sequences",
        };

        // The exhaustive member allowlist for a captured slot entry (mirrors the .strict() slotStateSchema in
        // schema/fixture.ts). `dark` is the optional two-color tint lane (ADR-0011 section 3); any member
        // outside this set fails loudly so a future capture lane forces a comparison rather than being skipped.
        private static readonly HashSet<string> AllowedSlot = new HashSet<string>
        {
            "slot", "blendMode", "color", "dark",
        };

        private static void RequireKnownMembers(JsonValue obj, HashSet<string> allowed, string context)
        {
            foreach (KeyValuePair<string, JsonValue> member in obj.Members())
            {
                if (!allowed.Contains(member.Key))
                {
                    throw new InvalidDataException(
                        $"fixture {context} has unknown member '{member.Key}'; the native harness has no "
                        + "comparison for it (add one rather than skipping the lane)");
                }
            }
        }

        public static Fixture Load(string path)
        {
            JsonValue root = JsonParser.Parse(File.ReadAllText(path));
            RequireKnownMembers(root, AllowedTopLevel, "root");
            var samples = new List<FixtureSample>();
            foreach (JsonValue sample in root.Member("samples")!.AsArray())
            {
                RequireKnownMembers(sample, AllowedSample, "sample");
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

                var slots = new List<SlotState>();
                JsonValue? slotsValue = sample.Member("slots");
                if (slotsValue != null && slotsValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue slot in slotsValue.AsArray())
                    {
                        RequireKnownMembers(slot, AllowedSlot, "slot");
                        var color = new List<double>();
                        foreach (JsonValue channel in slot.Member("color")!.AsArray())
                        {
                            color.Add(channel.AsNumber());
                        }

                        // The optional resolved dark tint (ADR-0009 section 4.3, ADR-0011 section 3), present
                        // only for a slot with a setup darkColor. Null when absent (compared structurally).
                        List<double>? dark = null;
                        JsonValue? darkValue = slot.Member("dark");
                        if (darkValue != null && darkValue.Kind == JsonKind.Array)
                        {
                            dark = new List<double>();
                            foreach (JsonValue channel in darkValue.AsArray())
                            {
                                dark.Add(channel.AsNumber());
                            }
                        }

                        slots.Add(new SlotState(
                            slot.Member("slot")!.AsString(),
                            slot.Member("blendMode")!.AsString(),
                            color,
                            dark));
                    }
                }

                List<int>? drawOrder = null;
                JsonValue? drawOrderValue = sample.Member("drawOrder");
                if (drawOrderValue != null && drawOrderValue.Kind == JsonKind.Array)
                {
                    drawOrder = new List<int>();
                    foreach (JsonValue slotIndex in drawOrderValue.AsArray())
                    {
                        drawOrder.Add((int)slotIndex.AsNumber());
                    }
                }

                var sequences = new List<SequenceFrame>();
                JsonValue? sequencesValue = sample.Member("sequences");
                if (sequencesValue != null && sequencesValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue sequence in sequencesValue.AsArray())
                    {
                        sequences.Add(new SequenceFrame(
                            sequence.Member("slot")!.AsString(),
                            (int)sequence.Member("frame")!.AsNumber()));
                    }
                }

                samples.Add(new FixtureSample(
                    sample.Member("time")!.AsNumber(),
                    sample.Member("animation")!.AsString(),
                    bones,
                    meshes,
                    slots,
                    drawOrder,
                    sequences));
            }

            var events = new List<FiredEventRecord>();
            JsonValue? eventsValue = root.Member("events");
            if (eventsValue != null && eventsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue ev in eventsValue.AsArray())
                {
                    JsonValue? intValue = ev.Member("int");
                    JsonValue? floatValue = ev.Member("float");
                    JsonValue? stringValue = ev.Member("string");
                    events.Add(new FiredEventRecord(
                        ev.Member("name")!.AsString(),
                        ev.Member("time")!.AsNumber(),
                        intValue != null && intValue.Kind == JsonKind.Number,
                        intValue != null && intValue.Kind == JsonKind.Number ? (int)intValue.AsNumber() : 0,
                        floatValue != null && floatValue.Kind == JsonKind.Number,
                        floatValue != null && floatValue.Kind == JsonKind.Number ? floatValue.AsNumber() : 0,
                        stringValue != null && stringValue.Kind == JsonKind.String,
                        stringValue != null && stringValue.Kind == JsonKind.String ? stringValue.AsString() : null));
                }
            }

            return new Fixture(root.Member("rigId")!.AsString(), samples, events);
        }
    }
}
