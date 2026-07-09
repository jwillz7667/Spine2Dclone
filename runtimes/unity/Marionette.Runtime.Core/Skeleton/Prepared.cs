using System.Collections.Generic;

namespace Marionette.Runtime.Core.Skeleton
{
    // Solve side, prebuilt representation of a format Animation (mirrors
    // packages/runtime-core/src/skeleton/prepared.ts). These types carry no logic: per track build and
    // evaluation live in Curve, per skeleton assembly in Sample. They exist so per frame sampling walks
    // flat arrays and so bezier control points become a sampled lookup table ONCE on build.
    public sealed class PreparedTrack
    {
        public int KeyCount { get; }
        public int ComponentCount { get; }
        public double[] Times { get; }
        public double[] Values { get; }
        public byte[] CurveKinds { get; }
        public int[] BezierBase { get; }
        public double[] BezierTable { get; }

        public PreparedTrack(
            int keyCount,
            int componentCount,
            double[] times,
            double[] values,
            byte[] curveKinds,
            int[] bezierBase,
            double[] bezierTable)
        {
            KeyCount = keyCount;
            ComponentCount = componentCount;
            Times = times;
            Values = values;
            CurveKinds = curveKinds;
            BezierBase = bezierBase;
            BezierTable = bezierTable;
        }
    }

    public sealed class PreparedAttachmentTrack
    {
        public int KeyCount { get; }
        public double[] Times { get; }
        public string?[] Names { get; }

        public PreparedAttachmentTrack(int keyCount, double[] times, string?[] names)
        {
            KeyCount = keyCount;
            Times = times;
            Names = names;
        }
    }

    public sealed class PreparedStepBoolTrack
    {
        public int KeyCount { get; }
        public double[] Times { get; }
        public byte[] Values { get; }

        public PreparedStepBoolTrack(int keyCount, double[] times, byte[] values)
        {
            KeyCount = keyCount;
            Times = times;
            Values = values;
        }
    }

    public sealed class PreparedBoneChannels
    {
        public int BoneIndex { get; }
        public PreparedTrack? Rotate { get; }
        public PreparedTrack? Translate { get; }
        public PreparedTrack? Scale { get; }
        public PreparedTrack? Shear { get; }

        public PreparedBoneChannels(
            int boneIndex,
            PreparedTrack? rotate,
            PreparedTrack? translate,
            PreparedTrack? scale,
            PreparedTrack? shear)
        {
            BoneIndex = boneIndex;
            Rotate = rotate;
            Translate = translate;
            Scale = scale;
            Shear = shear;
        }
    }

    public sealed class PreparedSlotChannels
    {
        public int SlotIndex { get; }
        public PreparedTrack? Color { get; }
        public PreparedAttachmentTrack? Attachment { get; }

        public PreparedSlotChannels(int slotIndex, PreparedTrack? color, PreparedAttachmentTrack? attachment)
        {
            SlotIndex = slotIndex;
            Color = color;
            Attachment = attachment;
        }
    }

    public sealed class PreparedIkChannel
    {
        public int ConstraintIndex { get; }
        public PreparedTrack? Mix { get; }
        public PreparedStepBoolTrack? BendPositive { get; }

        public PreparedIkChannel(int constraintIndex, PreparedTrack? mix, PreparedStepBoolTrack? bendPositive)
        {
            ConstraintIndex = constraintIndex;
            Mix = mix;
            BendPositive = bendPositive;
        }
    }

    public sealed class PreparedTransformChannel
    {
        public int ConstraintIndex { get; }
        public PreparedTrack? MixRotate { get; }
        public PreparedTrack? MixX { get; }
        public PreparedTrack? MixY { get; }
        public PreparedTrack? MixScaleX { get; }
        public PreparedTrack? MixScaleY { get; }
        public PreparedTrack? MixShearY { get; }

        public PreparedTransformChannel(
            int constraintIndex,
            PreparedTrack? mixRotate,
            PreparedTrack? mixX,
            PreparedTrack? mixY,
            PreparedTrack? mixScaleX,
            PreparedTrack? mixScaleY,
            PreparedTrack? mixShearY)
        {
            ConstraintIndex = constraintIndex;
            MixRotate = mixRotate;
            MixX = mixX;
            MixY = mixY;
            MixScaleX = mixScaleX;
            MixScaleY = mixScaleY;
            MixShearY = mixShearY;
        }
    }

    public sealed class PreparedDeformChannel
    {
        public string Skin { get; }
        public string Slot { get; }
        public string Attachment { get; }
        public PreparedTrack Track { get; }

        public PreparedDeformChannel(string skin, string slot, string attachment, PreparedTrack track)
        {
            Skin = skin;
            Slot = slot;
            Attachment = attachment;
            Track = track;
        }
    }

    // A prepared per-animation draw-order timeline (ADR-0008 section 3, PP-B4). Each key's compact offset
    // diff is derived ONCE at build time into a FULL render-order permutation Orders[k], where
    // Orders[k][renderPosition] = slotIndex. Mirrors PreparedDrawOrderTimeline in prepared.ts.
    public sealed class PreparedDrawOrderTimeline
    {
        public int KeyCount { get; }
        public double[] Times { get; }
        public int[][] Orders { get; }

        public PreparedDrawOrderTimeline(int keyCount, double[] times, int[][] orders)
        {
            KeyCount = keyCount;
            Times = times;
            Orders = orders;
        }
    }

    // A prepared per-animation event timeline (ADR-0008 section 2, PP-B4). Payloads are resolved ONCE at
    // build time (EventDef default overridden by the key) into parallel value + presence lanes. Times are
    // NON-DECREASING. Mirrors PreparedEventTimeline in prepared.ts.
    public sealed class PreparedEventTimeline
    {
        public int KeyCount { get; }
        public double[] Times { get; }
        public string[] Names { get; }
        public double[] IntValues { get; }
        public bool[] HasInt { get; }
        public double[] FloatValues { get; }
        public bool[] HasFloat { get; }
        public string?[] StringValues { get; }
        public bool[] HasString { get; }

        public PreparedEventTimeline(
            int keyCount,
            double[] times,
            string[] names,
            double[] intValues,
            bool[] hasInt,
            double[] floatValues,
            bool[] hasFloat,
            string?[] stringValues,
            bool[] hasString)
        {
            KeyCount = keyCount;
            Times = times;
            Names = names;
            IntValues = intValues;
            HasInt = hasInt;
            FloatValues = floatValues;
            HasFloat = hasFloat;
            StringValues = stringValues;
            HasString = hasString;
        }
    }

    public sealed class PreparedAnimation
    {
        public IReadOnlyList<PreparedBoneChannels> BoneChannels { get; }
        public IReadOnlyList<PreparedSlotChannels> SlotChannels { get; }
        public IReadOnlyList<PreparedIkChannel> IkChannels { get; }
        public IReadOnlyList<PreparedTransformChannel> TransformChannels { get; }
        public IReadOnlyList<PreparedDeformChannel> DeformChannels { get; }

        // The draw-order reorder timeline, or null when this animation never reorders (PP-B4).
        public PreparedDrawOrderTimeline? DrawOrder { get; }

        public PreparedAnimation(
            IReadOnlyList<PreparedBoneChannels> boneChannels,
            IReadOnlyList<PreparedSlotChannels> slotChannels,
            IReadOnlyList<PreparedIkChannel> ikChannels,
            IReadOnlyList<PreparedTransformChannel> transformChannels,
            IReadOnlyList<PreparedDeformChannel> deformChannels,
            PreparedDrawOrderTimeline? drawOrder)
        {
            BoneChannels = boneChannels;
            SlotChannels = slotChannels;
            IkChannels = ikChannels;
            TransformChannels = transformChannels;
            DeformChannels = deformChannels;
            DrawOrder = drawOrder;
        }
    }
}
