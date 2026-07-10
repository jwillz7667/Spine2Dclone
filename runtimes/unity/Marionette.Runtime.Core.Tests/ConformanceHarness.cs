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

            // PP-B2 geometry-attachment capture targets (ADR-0012), resolved once from the sample-spec (like
            // build-fixture.ts). Each is empty unless the spec opts in, so non-PP-B2 rigs add no comparisons.
            List<ClipTarget> clipTargets = ResolveClipTargets(result, rigId, document, spec, slotIndexByName);
            List<BoxTarget> boxTargets = ResolveBoxTargets(result, rigId, document, spec, slotIndexByName);
            List<PointTarget> pointTargets = ResolvePointTargets(result, rigId, document, spec, slotIndexByName);
            var clippedSlotScratch = new int[pose.SlotCount];

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

                // The active skin for this sample (ADR-0011 section 4): activeSkins is parallel to poseTimes,
                // each entry a skin name or null. A spec without activeSkins samples with null everywhere, so
                // pre-scoping rigs are unaffected.
                string? activeSkin = s < spec.ActiveSkins.Count ? spec.ActiveSkins[s] : null;

                // The frame delta time (ADR-0014 section 2.2, PP-B7): 0 on the first sample, then the gap to the
                // previous pose time. Physics carries velocity across frames, so the pose is sampled SEQUENTIALLY
                // over poseTimes (it already is) and the physics clock advances by this dt. Mirrors build-fixture.ts.
                double frameDt = s == 0 ? 0 : spec.PoseTimes[s] - spec.PoseTimes[s - 1];
                Sample.SampleSkeleton(document, spec.Animation, sample.Time, pose, activeSkin, frameDt);

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
                CompareClips(result, rigId, sample, pose, clipTargets, clippedSlotScratch);
                CompareBoxes(result, rigId, sample, pose, boxTargets, spec.HitProbes);
                ComparePoints(result, rigId, sample, pose, pointTargets);
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

        // A resolved clip-capture target (PP-B2): the clipping attachment plus its slot index and its `end` slot
        // index, with a reused world-polygon scratch sized to the polygon (2 * V lanes). Mirrors
        // ClipCaptureTarget in build-fixture.ts.
        private sealed class ClipTarget
        {
            public string Slot { get; }
            public string Attachment { get; }
            public ClippingAttachment Clip { get; }
            public int ClipSlotIndex { get; }
            public int EndSlotIndex { get; }
            public double[] PolygonScratch { get; }

            public ClipTarget(
                string slot,
                string attachment,
                ClippingAttachment clip,
                int clipSlotIndex,
                int endSlotIndex)
            {
                Slot = slot;
                Attachment = attachment;
                Clip = clip;
                ClipSlotIndex = clipSlotIndex;
                EndSlotIndex = endSlotIndex;
                PolygonScratch = new double[clip.Vertices.Length];
            }
        }

        private sealed class BoxTarget
        {
            public string Slot { get; }
            public string Attachment { get; }
            public BoundingBoxAttachment Box { get; }
            public int SlotIndex { get; }
            public double[] VertexScratch { get; }

            public BoxTarget(string slot, string attachment, BoundingBoxAttachment box, int slotIndex)
            {
                Slot = slot;
                Attachment = attachment;
                Box = box;
                SlotIndex = slotIndex;
                VertexScratch = new double[box.Vertices.Length];
            }
        }

        private sealed class PointTarget
        {
            public string Slot { get; }
            public string Attachment { get; }
            public PointAttachment Point { get; }
            public int SlotIndex { get; }

            public PointTarget(string slot, string attachment, PointAttachment point, int slotIndex)
            {
                Slot = slot;
                Attachment = attachment;
                Point = point;
                SlotIndex = slotIndex;
            }
        }

        // Look up an attachment by (skin, slot, attachment) in the document, or null when absent. Mirrors the
        // build-fixture.ts lookupCaptureAttachment traversal over the ordered skin members.
        private static Attachment? LookupCaptureAttachment(
            SkeletonDocument document,
            string skinName,
            string slotName,
            string attachmentName)
        {
            foreach (Skin skin in document.Skins)
            {
                if (skin.Name != skinName)
                {
                    continue;
                }

                foreach (KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>> slotEntry in skin.Attachments)
                {
                    if (slotEntry.Key != slotName)
                    {
                        continue;
                    }

                    foreach (KeyValuePair<string, Attachment> attachmentEntry in slotEntry.Value)
                    {
                        if (attachmentEntry.Key == attachmentName)
                        {
                            return attachmentEntry.Value;
                        }
                    }
                }
            }

            return null;
        }

        private static List<ClipTarget> ResolveClipTargets(
            ConformanceResult result,
            string rigId,
            SkeletonDocument document,
            SampleSpec spec,
            Dictionary<string, int> slotIndexByName)
        {
            var targets = new List<ClipTarget>();
            foreach (CaptureTarget target in spec.Clips)
            {
                Attachment? attachment = LookupCaptureAttachment(document, target.Skin, target.Slot, target.Attachment);
                if (attachment == null || attachment.Type != "clipping" || attachment.Clipping == null)
                {
                    result.Failures.Add(
                        $"[{rigId}] sample-spec captures clip '{target.Skin}/{target.Slot}/{target.Attachment}', "
                        + "but the rig has no such clipping attachment");
                    continue;
                }

                if (!slotIndexByName.TryGetValue(target.Slot, out int clipSlotIndex)
                    || !slotIndexByName.TryGetValue(attachment.Clipping.End, out int endSlotIndex))
                {
                    result.Failures.Add(
                        $"[{rigId}] clip '{target.Slot}/{target.Attachment}' names a slot the rig does not define "
                        + $"(slot '{target.Slot}' or end '{attachment.Clipping.End}')");
                    continue;
                }

                targets.Add(new ClipTarget(
                    target.Slot,
                    target.Attachment,
                    attachment.Clipping,
                    clipSlotIndex,
                    endSlotIndex));
            }

            return targets;
        }

        private static List<BoxTarget> ResolveBoxTargets(
            ConformanceResult result,
            string rigId,
            SkeletonDocument document,
            SampleSpec spec,
            Dictionary<string, int> slotIndexByName)
        {
            var targets = new List<BoxTarget>();
            foreach (CaptureTarget target in spec.Boxes)
            {
                Attachment? attachment = LookupCaptureAttachment(document, target.Skin, target.Slot, target.Attachment);
                if (attachment == null || attachment.Type != "boundingbox" || attachment.BoundingBox == null)
                {
                    result.Failures.Add(
                        $"[{rigId}] sample-spec captures box '{target.Skin}/{target.Slot}/{target.Attachment}', "
                        + "but the rig has no such boundingbox attachment");
                    continue;
                }

                if (!slotIndexByName.TryGetValue(target.Slot, out int slotIndex))
                {
                    result.Failures.Add(
                        $"[{rigId}] box '{target.Slot}/{target.Attachment}' names a slot the rig does not define");
                    continue;
                }

                targets.Add(new BoxTarget(target.Slot, target.Attachment, attachment.BoundingBox, slotIndex));
            }

            return targets;
        }

        private static List<PointTarget> ResolvePointTargets(
            ConformanceResult result,
            string rigId,
            SkeletonDocument document,
            SampleSpec spec,
            Dictionary<string, int> slotIndexByName)
        {
            var targets = new List<PointTarget>();
            foreach (CaptureTarget target in spec.Points)
            {
                Attachment? attachment = LookupCaptureAttachment(document, target.Skin, target.Slot, target.Attachment);
                if (attachment == null || attachment.Type != "point" || attachment.Point == null)
                {
                    result.Failures.Add(
                        $"[{rigId}] sample-spec captures point '{target.Skin}/{target.Slot}/{target.Attachment}', "
                        + "but the rig has no such point attachment");
                    continue;
                }

                if (!slotIndexByName.TryGetValue(target.Slot, out int slotIndex))
                {
                    result.Failures.Add(
                        $"[{rigId}] point '{target.Slot}/{target.Attachment}' names a slot the rig does not define");
                    continue;
                }

                targets.Add(new PointTarget(target.Slot, target.Attachment, attachment.Point, slotIndex));
            }

            return targets;
        }

        // Compare one sample's resolved clip state (PP-B2, ADR-0012 section 3): the world polygon rides the
        // VERTEX tolerance; the clipped-slot name list is DISCRETE, compared EXACT in render-position order.
        // Present only on rigs whose sample-spec captures clips; absent samples short-circuit.
        private static void CompareClips(
            ConformanceResult result,
            string rigId,
            FixtureSample sample,
            Pose pose,
            List<ClipTarget> clipTargets,
            int[] clippedSlotScratch)
        {
            if (clipTargets.Count == 0 && sample.Clips.Count == 0)
            {
                return;
            }

            if (clipTargets.Count != sample.Clips.Count)
            {
                result.Failures.Add(
                    $"[{rigId}] clip lane length mismatch at t={sample.Time}: spec has {clipTargets.Count} "
                    + $"clip targets, fixture has {sample.Clips.Count}");
                return;
            }

            for (int i = 0; i < clipTargets.Count; i += 1)
            {
                ClipTarget target = clipTargets[i];
                ClipState expected = sample.Clips[i];
                if (expected.Slot != target.Slot || expected.Attachment != target.Attachment)
                {
                    result.Failures.Add(
                        $"[{rigId}] clip key mismatch at t={sample.Time}, index {i}: spec "
                        + $"'{target.Slot}/{target.Attachment}', fixture '{expected.Key}'");
                    continue;
                }

                int vertexCount = AttachmentGeometry.ResolveClipWorldPolygonForSlot(
                    pose, target.ClipSlotIndex, target.Clip, target.PolygonScratch);
                int clippedCount = AttachmentGeometry.ComputeClippedSlotRange(
                    pose, target.ClipSlotIndex, target.EndSlotIndex, clippedSlotScratch);

                // Clipped-slot membership: a discrete draw-order decision, compared EXACT in order.
                if (expected.ClippedSlots.Count != clippedCount)
                {
                    result.Failures.Add(
                        $"[{rigId}] clip '{expected.Key}' at t={sample.Time} clipped-slot count mismatch: "
                        + $"expected {expected.ClippedSlots.Count}, actual {clippedCount}");
                }
                else
                {
                    for (int k = 0; k < clippedCount; k += 1)
                    {
                        string actualSlot = pose.SlotNames[clippedSlotScratch[k]];
                        result.LaneComparisons += 1;
                        if (actualSlot != expected.ClippedSlots[k])
                        {
                            result.Failures.Add(
                                $"[{rigId}] clip '{expected.Key}' at t={sample.Time} clipped-slot {k} mismatch: "
                                + $"expected '{expected.ClippedSlots[k]}', actual '{actualSlot}'");
                        }
                    }
                }

                if (vertexCount * 2 != expected.WorldPolygon.Count)
                {
                    result.Failures.Add(
                        $"[{rigId}] clip '{expected.Key}' at t={sample.Time} world-polygon length mismatch: "
                        + $"expected {expected.WorldPolygon.Count} lanes, actual {vertexCount * 2}");
                    continue;
                }

                for (int lane = 0; lane < expected.WorldPolygon.Count; lane += 1)
                {
                    double expectedValue = expected.WorldPolygon[lane];
                    double actualValue = target.PolygonScratch[lane];
                    double delta = Math.Abs(actualValue - expectedValue);
                    result.MaxVertexError = Math.Max(result.MaxVertexError, delta);
                    result.LaneComparisons += 1;
                    if (!Tolerances.Vertex.Within(actualValue, expectedValue))
                    {
                        result.Failures.Add(
                            $"[{rigId}] clip '{expected.Key}' world-polygon lane {lane} at t={sample.Time} drifts: "
                            + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                    }
                }
            }
        }

        // Compare one sample's resolved bounding-box state (PP-B2, ADR-0012 section 4): world vertices ride the
        // VERTEX tolerance; the per-probe even-odd hit booleans are DISCRETE, compared EXACT. Present only on
        // rigs whose sample-spec captures boxes; absent samples short-circuit.
        private static void CompareBoxes(
            ConformanceResult result,
            string rigId,
            FixtureSample sample,
            Pose pose,
            List<BoxTarget> boxTargets,
            IReadOnlyList<HitProbe> hitProbes)
        {
            if (boxTargets.Count == 0 && sample.Boxes.Count == 0)
            {
                return;
            }

            if (boxTargets.Count != sample.Boxes.Count)
            {
                result.Failures.Add(
                    $"[{rigId}] box lane length mismatch at t={sample.Time}: spec has {boxTargets.Count} "
                    + $"box targets, fixture has {sample.Boxes.Count}");
                return;
            }

            for (int i = 0; i < boxTargets.Count; i += 1)
            {
                BoxTarget target = boxTargets[i];
                BoundingBoxState expected = sample.Boxes[i];
                if (expected.Slot != target.Slot || expected.Attachment != target.Attachment)
                {
                    result.Failures.Add(
                        $"[{rigId}] box key mismatch at t={sample.Time}, index {i}: spec "
                        + $"'{target.Slot}/{target.Attachment}', fixture '{expected.Key}'");
                    continue;
                }

                int vertexCount = AttachmentGeometry.BoundingBoxWorldVerticesForSlot(
                    pose, target.SlotIndex, target.Box, target.VertexScratch);

                // Per-probe even-odd hit results: a hit is a hit, compared EXACT.
                if (expected.Hits.Count != hitProbes.Count)
                {
                    result.Failures.Add(
                        $"[{rigId}] box '{expected.Key}' at t={sample.Time} hit-probe count mismatch: "
                        + $"expected {expected.Hits.Count}, spec has {hitProbes.Count} probes");
                }
                else
                {
                    for (int k = 0; k < hitProbes.Count; k += 1)
                    {
                        bool actualHit = AttachmentGeometry.HitTestPolygon(
                            target.VertexScratch, vertexCount, hitProbes[k].X, hitProbes[k].Y);
                        result.LaneComparisons += 1;
                        if (actualHit != expected.Hits[k])
                        {
                            result.Failures.Add(
                                $"[{rigId}] box '{expected.Key}' at t={sample.Time} hit probe {k} mismatch: "
                                + $"expected {expected.Hits[k]}, actual {actualHit}");
                        }
                    }
                }

                if (vertexCount * 2 != expected.WorldVertices.Count)
                {
                    result.Failures.Add(
                        $"[{rigId}] box '{expected.Key}' at t={sample.Time} world-vertex length mismatch: "
                        + $"expected {expected.WorldVertices.Count} lanes, actual {vertexCount * 2}");
                    continue;
                }

                for (int lane = 0; lane < expected.WorldVertices.Count; lane += 1)
                {
                    double expectedValue = expected.WorldVertices[lane];
                    double actualValue = target.VertexScratch[lane];
                    double delta = Math.Abs(actualValue - expectedValue);
                    result.MaxVertexError = Math.Max(result.MaxVertexError, delta);
                    result.LaneComparisons += 1;
                    if (!Tolerances.Vertex.Within(actualValue, expectedValue))
                    {
                        result.Failures.Add(
                            $"[{rigId}] box '{expected.Key}' world-vertex lane {lane} at t={sample.Time} drifts: "
                            + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
                    }
                }
            }
        }

        // Compare one sample's resolved point world state (PP-B2, ADR-0012 section 2): x/y ride the VERTEX
        // tolerance, rotation rides the ANGLE tolerance. Present only on rigs whose sample-spec captures points.
        private static void ComparePoints(
            ConformanceResult result,
            string rigId,
            FixtureSample sample,
            Pose pose,
            List<PointTarget> pointTargets)
        {
            if (pointTargets.Count == 0 && sample.Points.Count == 0)
            {
                return;
            }

            if (pointTargets.Count != sample.Points.Count)
            {
                result.Failures.Add(
                    $"[{rigId}] point lane length mismatch at t={sample.Time}: spec has {pointTargets.Count} "
                    + $"point targets, fixture has {sample.Points.Count}");
                return;
            }

            for (int i = 0; i < pointTargets.Count; i += 1)
            {
                PointTarget target = pointTargets[i];
                PointState expected = sample.Points[i];
                if (expected.Slot != target.Slot || expected.Attachment != target.Attachment)
                {
                    result.Failures.Add(
                        $"[{rigId}] point key mismatch at t={sample.Time}, index {i}: spec "
                        + $"'{target.Slot}/{target.Attachment}', fixture '{expected.Key}'");
                    continue;
                }

                if (!AttachmentGeometry.ResolvePointWorldForSlot(
                    pose, target.SlotIndex, target.Point, out AttachmentGeometry.PointWorld world))
                {
                    result.Failures.Add(
                        $"[{rigId}] point '{expected.Key}' at t={sample.Time} has no resolvable slot bone");
                    continue;
                }

                ComparePointLane(result, rigId, sample.Time, expected.Key, "x", world.X, expected.X, Tolerances.Vertex);
                ComparePointLane(result, rigId, sample.Time, expected.Key, "y", world.Y, expected.Y, Tolerances.Vertex);
                ComparePointLane(
                    result, rigId, sample.Time, expected.Key, "rotation", world.RotationDeg, expected.Rotation, Tolerances.Angle);
            }
        }

        private static void ComparePointLane(
            ConformanceResult result,
            string rigId,
            double time,
            string key,
            string lane,
            double actualValue,
            double expectedValue,
            Tolerance tol)
        {
            double delta = Math.Abs(actualValue - expectedValue);
            result.MaxVertexError = Math.Max(result.MaxVertexError, delta);
            result.LaneComparisons += 1;
            if (!tol.Within(actualValue, expectedValue))
            {
                result.Failures.Add(
                    $"[{rigId}] point '{key}' world {lane} at t={time} drifts: "
                    + $"expected {expectedValue:R}, actual {actualValue:R}, delta {delta:R}");
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

    // A (skin, slot, attachment) capture target named by the sample-spec (PP-B2 clips/boxes/points, PP-B2
    // hit-test boxes). Mirrors the { skin, slot, attachment } objects in sampleSpecSchema.
    public sealed class CaptureTarget
    {
        public string Skin { get; }
        public string Slot { get; }
        public string Attachment { get; }

        public CaptureTarget(string skin, string slot, string attachment)
        {
            Skin = skin;
            Slot = slot;
            Attachment = attachment;
        }
    }

    // A world-space probe point a bounding box is hit-tested against (PP-B2). Mirrors a [x, y] tuple in the
    // spec's hitProbes.
    public readonly struct HitProbe
    {
        public readonly double X;
        public readonly double Y;

        public HitProbe(double x, double y)
        {
            X = x;
            Y = y;
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

        // The active skin per sample (ADR-0011 section 4), parallel to PoseTimes; each entry is a skin name or
        // null (unscoped sampling). Empty when the sample-spec omits activeSkins, so the harness samples with
        // null everywhere, mirroring the drawOrder / captureSequences opt-in.
        public IReadOnlyList<string?> ActiveSkins { get; }

        // The slot names whose sequence frame the fixture captures per sample (ADR-0011 section 2). Empty
        // when the sample-spec omits captureSequences, in which case the sequences lane is absent and the
        // harness compares nothing new, mirroring the drawOrder opt-in.
        public IReadOnlyList<string> CaptureSequences { get; }

        // The PP-B2 geometry-attachment capture targets (ADR-0012), in spec order. Empty when the sample-spec
        // omits the lane. `HitProbes` is the world-space probe list every captured box is hit-tested against.
        public IReadOnlyList<CaptureTarget> Clips { get; }
        public IReadOnlyList<CaptureTarget> Boxes { get; }
        public IReadOnlyList<HitProbe> HitProbes { get; }
        public IReadOnlyList<CaptureTarget> Points { get; }
        public EventStep? EventStep { get; }

        private SampleSpec(
            string rigId,
            string animation,
            bool loop,
            double duration,
            IReadOnlyList<double> poseTimes,
            bool captureDrawOrder,
            IReadOnlyList<string> captureSequences,
            IReadOnlyList<string?> activeSkins,
            IReadOnlyList<CaptureTarget> clips,
            IReadOnlyList<CaptureTarget> boxes,
            IReadOnlyList<HitProbe> hitProbes,
            IReadOnlyList<CaptureTarget> points,
            EventStep? eventStep)
        {
            RigId = rigId;
            Animation = animation;
            Loop = loop;
            Duration = duration;
            PoseTimes = poseTimes;
            CaptureDrawOrder = captureDrawOrder;
            CaptureSequences = captureSequences;
            ActiveSkins = activeSkins;
            Clips = clips;
            Boxes = boxes;
            HitProbes = hitProbes;
            Points = points;
            EventStep = eventStep;
        }

        // Read an array of { skin, slot, attachment } capture targets, or empty when the member is absent.
        private static List<CaptureTarget> ReadCaptureTargets(JsonValue root, string member)
        {
            var targets = new List<CaptureTarget>();
            JsonValue? value = root.Member(member);
            if (value != null && value.Kind == JsonKind.Array)
            {
                foreach (JsonValue target in value.AsArray())
                {
                    targets.Add(new CaptureTarget(
                        target.Member("skin")!.AsString(),
                        target.Member("slot")!.AsString(),
                        target.Member("attachment")!.AsString()));
                }
            }

            return targets;
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

            List<CaptureTarget> clips = ReadCaptureTargets(root, "clips");
            List<CaptureTarget> boxes = ReadCaptureTargets(root, "boxes");
            List<CaptureTarget> points = ReadCaptureTargets(root, "points");

            var hitProbes = new List<HitProbe>();
            JsonValue? hitProbesValue = root.Member("hitProbes");
            if (hitProbesValue != null && hitProbesValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue probe in hitProbesValue.AsArray())
                {
                    IReadOnlyList<JsonValue> pair = probe.AsArray();
                    hitProbes.Add(new HitProbe(pair[0].AsNumber(), pair[1].AsNumber()));
                }
            }

            // The optional per-sample active skin knob (ADR-0011 section 4), parallel to poseTimes. Each entry
            // is a skin name string or JSON null (sample with no active skin). Absent => empty list.
            var activeSkins = new List<string?>();
            JsonValue? activeSkinsValue = root.Member("activeSkins");
            if (activeSkinsValue != null && activeSkinsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue skin in activeSkinsValue.AsArray())
                {
                    activeSkins.Add(skin.IsNull ? null : skin.AsString());
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
                activeSkins,
                clips,
                boxes,
                hitProbes,
                points,
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

    // One clip attachment's resolved clip state at a sample (PP-B2, ADR-0012 section 3): the world polygon
    // (VERTEX class) and the clipped-slot name list (draw-order membership, EXACT). Mirrors clipStateSchema.
    public sealed class ClipState
    {
        public string Slot { get; }
        public string Attachment { get; }
        public IReadOnlyList<double> WorldPolygon { get; }
        public IReadOnlyList<string> ClippedSlots { get; }

        public string Key => $"{Slot}/{Attachment}";

        public ClipState(
            string slot,
            string attachment,
            IReadOnlyList<double> worldPolygon,
            IReadOnlyList<string> clippedSlots)
        {
            Slot = slot;
            Attachment = attachment;
            WorldPolygon = worldPolygon;
            ClippedSlots = clippedSlots;
        }
    }

    // One bounding-box attachment's resolved hit-test state at a sample (PP-B2, ADR-0012 section 4): world
    // vertices (VERTEX class) and one even-odd hit boolean per committed probe (EXACT). Mirrors
    // boundingBoxStateSchema.
    public sealed class BoundingBoxState
    {
        public string Slot { get; }
        public string Attachment { get; }
        public IReadOnlyList<double> WorldVertices { get; }
        public IReadOnlyList<bool> Hits { get; }

        public string Key => $"{Slot}/{Attachment}";

        public BoundingBoxState(
            string slot,
            string attachment,
            IReadOnlyList<double> worldVertices,
            IReadOnlyList<bool> hits)
        {
            Slot = slot;
            Attachment = attachment;
            WorldVertices = worldVertices;
            Hits = hits;
        }
    }

    // One point attachment's resolved world state at a sample (PP-B2, ADR-0012 section 2): world position (x, y
    // on the VERTEX class) and world rotation degrees (the ANGLE class). Mirrors pointStateSchema.
    public sealed class PointState
    {
        public string Slot { get; }
        public string Attachment { get; }
        public double X { get; }
        public double Y { get; }
        public double Rotation { get; }

        public string Key => $"{Slot}/{Attachment}";

        public PointState(string slot, string attachment, double x, double y, double rotation)
        {
            Slot = slot;
            Attachment = attachment;
            X = x;
            Y = y;
            Rotation = rotation;
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

        // The PP-B2 geometry-attachment lanes (ADR-0012), present only when the sample-spec opts in via
        // clips/boxes/points. Empty list when absent, so pre-PP-B2 samples add no comparisons.
        public IReadOnlyList<ClipState> Clips { get; }
        public IReadOnlyList<BoundingBoxState> Boxes { get; }
        public IReadOnlyList<PointState> Points { get; }

        public FixtureSample(
            double time,
            string animation,
            IReadOnlyList<KeyValuePair<string, double[]>> bones,
            IReadOnlyList<MeshVertices> meshes,
            IReadOnlyList<SlotState> slots,
            IReadOnlyList<int>? drawOrder,
            IReadOnlyList<SequenceFrame> sequences,
            IReadOnlyList<ClipState> clips,
            IReadOnlyList<BoundingBoxState> boxes,
            IReadOnlyList<PointState> points)
        {
            Time = time;
            Animation = animation;
            Bones = bones;
            Meshes = meshes;
            Slots = slots;
            DrawOrder = drawOrder;
            Sequences = sequences;
            Clips = clips;
            Boxes = boxes;
            Points = points;
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
            "clips", "boxes", "points",
        };

        // The exhaustive member allowlist for a captured slot entry (mirrors the .strict() slotStateSchema in
        // schema/fixture.ts). `dark` is the optional two-color tint lane (ADR-0011 section 3); any member
        // outside this set fails loudly so a future capture lane forces a comparison rather than being skipped.
        private static readonly HashSet<string> AllowedSlot = new HashSet<string>
        {
            "slot", "blendMode", "color", "dark",
        };

        // The exhaustive member allowlists for the PP-B2 geometry-attachment lanes (mirror clipStateSchema,
        // boundingBoxStateSchema, pointStateSchema in schema/fixture.ts). Any member outside a set fails loudly.
        private static readonly HashSet<string> AllowedClip = new HashSet<string>
        {
            "slot", "attachment", "worldPolygon", "clippedSlots",
        };

        private static readonly HashSet<string> AllowedBox = new HashSet<string>
        {
            "slot", "attachment", "worldVertices", "hits",
        };

        private static readonly HashSet<string> AllowedPoint = new HashSet<string>
        {
            "slot", "attachment", "x", "y", "rotation",
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

                // The PP-B2 clip state lane (ADR-0012 section 3): world polygon + clipped-slot name list.
                var clips = new List<ClipState>();
                JsonValue? clipsValue = sample.Member("clips");
                if (clipsValue != null && clipsValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue clip in clipsValue.AsArray())
                    {
                        RequireKnownMembers(clip, AllowedClip, "clip");
                        var worldPolygon = new List<double>();
                        foreach (JsonValue lane in clip.Member("worldPolygon")!.AsArray())
                        {
                            worldPolygon.Add(lane.AsNumber());
                        }

                        var clippedSlots = new List<string>();
                        foreach (JsonValue name in clip.Member("clippedSlots")!.AsArray())
                        {
                            clippedSlots.Add(name.AsString());
                        }

                        clips.Add(new ClipState(
                            clip.Member("slot")!.AsString(),
                            clip.Member("attachment")!.AsString(),
                            worldPolygon,
                            clippedSlots));
                    }
                }

                // The PP-B2 bounding-box hit-test lane (ADR-0012 section 4): world vertices + per-probe hits.
                var boxes = new List<BoundingBoxState>();
                JsonValue? boxesValue = sample.Member("boxes");
                if (boxesValue != null && boxesValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue box in boxesValue.AsArray())
                    {
                        RequireKnownMembers(box, AllowedBox, "box");
                        var worldVertices = new List<double>();
                        foreach (JsonValue lane in box.Member("worldVertices")!.AsArray())
                        {
                            worldVertices.Add(lane.AsNumber());
                        }

                        var hits = new List<bool>();
                        foreach (JsonValue hit in box.Member("hits")!.AsArray())
                        {
                            hits.Add(hit.AsBool());
                        }

                        boxes.Add(new BoundingBoxState(
                            box.Member("slot")!.AsString(),
                            box.Member("attachment")!.AsString(),
                            worldVertices,
                            hits));
                    }
                }

                // The PP-B2 point world-state lane (ADR-0012 section 2): world x/y + rotation degrees.
                var points = new List<PointState>();
                JsonValue? pointsValue = sample.Member("points");
                if (pointsValue != null && pointsValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue point in pointsValue.AsArray())
                    {
                        RequireKnownMembers(point, AllowedPoint, "point");
                        points.Add(new PointState(
                            point.Member("slot")!.AsString(),
                            point.Member("attachment")!.AsString(),
                            point.Member("x")!.AsNumber(),
                            point.Member("y")!.AsNumber(),
                            point.Member("rotation")!.AsNumber()));
                    }
                }

                samples.Add(new FixtureSample(
                    sample.Member("time")!.AsNumber(),
                    sample.Member("animation")!.AsString(),
                    bones,
                    meshes,
                    slots,
                    drawOrder,
                    sequences,
                    clips,
                    boxes,
                    points));
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
