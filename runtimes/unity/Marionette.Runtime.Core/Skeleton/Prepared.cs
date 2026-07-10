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

        // Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3). Each is a single-lane scalar
        // track for one component. The format's coexistence ban means at most one of {Translate} /
        // {TranslateX, TranslateY} is non-null (likewise scale, shear), so applying all present is unambiguous.
        public PreparedTrack? TranslateX { get; }
        public PreparedTrack? TranslateY { get; }
        public PreparedTrack? ScaleX { get; }
        public PreparedTrack? ScaleY { get; }
        public PreparedTrack? ShearX { get; }
        public PreparedTrack? ShearY { get; }

        public PreparedBoneChannels(
            int boneIndex,
            PreparedTrack? rotate,
            PreparedTrack? translate,
            PreparedTrack? scale,
            PreparedTrack? shear,
            PreparedTrack? translateX,
            PreparedTrack? translateY,
            PreparedTrack? scaleX,
            PreparedTrack? scaleY,
            PreparedTrack? shearX,
            PreparedTrack? shearY)
        {
            BoneIndex = boneIndex;
            Rotate = rotate;
            Translate = translate;
            Scale = scale;
            Shear = shear;
            TranslateX = translateX;
            TranslateY = translateY;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearX = shearX;
            ShearY = shearY;
        }
    }

    public sealed class PreparedSlotChannels
    {
        public int SlotIndex { get; }
        public PreparedTrack? Color { get; }
        public PreparedAttachmentTrack? Attachment { get; }

        // Split color tracks (ADR-0009 section 4.2): Rgb is a 3-lane track, Alpha a 1-lane track. The joint
        // Color (RGBA) and the split Rgb/Alpha must not coexist on one slot (TIMELINE_COMPONENT_CONFLICT), so
        // at most one form is non-null. The keyable two-color Dark tint (ADR-0009 section 4.3, a 4-lane RGBA
        // track) is independent and blends into the pose's dark-color lane.
        public PreparedTrack? Rgb { get; }
        public PreparedTrack? Alpha { get; }
        public PreparedTrack? Dark { get; }

        public PreparedSlotChannels(
            int slotIndex,
            PreparedTrack? color,
            PreparedAttachmentTrack? attachment,
            PreparedTrack? rgb,
            PreparedTrack? alpha,
            PreparedTrack? dark)
        {
            SlotIndex = slotIndex;
            Color = color;
            Attachment = attachment;
            Rgb = rgb;
            Alpha = alpha;
            Dark = dark;
        }
    }

    public sealed class PreparedIkChannel
    {
        public int ConstraintIndex { get; }
        public PreparedTrack? Mix { get; }
        public PreparedStepBoolTrack? BendPositive { get; }

        // The optional keyable depth channels (ADR-0009 section 1.1, ADR-0010 section 2.4). Each is built
        // from ONLY the frames that key it, so a channel no frame keys is null and the constraint's base
        // value holds. Softness interpolates by its curve like Mix; Stretch/Compress are stepped booleans
        // resolved by the discrete greater-weight-wins rule, exactly like BendPositive.
        public PreparedTrack? Softness { get; }
        public PreparedStepBoolTrack? Stretch { get; }
        public PreparedStepBoolTrack? Compress { get; }

        public PreparedIkChannel(
            int constraintIndex,
            PreparedTrack? mix,
            PreparedStepBoolTrack? bendPositive,
            PreparedTrack? softness,
            PreparedStepBoolTrack? stretch,
            PreparedStepBoolTrack? compress)
        {
            ConstraintIndex = constraintIndex;
            Mix = mix;
            BendPositive = bendPositive;
            Softness = softness;
            Stretch = stretch;
            Compress = compress;
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

    // The timelines of one animated path constraint (ADR-0011 section 3, ADR-0013), resolved to the pose's
    // path-constraint index (mirrors PreparedPathChannel in prepared.ts). Each channel is prepared from ONLY
    // the keyframes that key it: a channel no keyframe keys is null and keeps the constraint base. Position and
    // Spacing are unbounded value tracks; the three mix channels are [0, 1] value tracks.
    public sealed class PreparedPathChannel
    {
        public int ConstraintIndex { get; }
        public PreparedTrack? Position { get; }
        public PreparedTrack? Spacing { get; }
        public PreparedTrack? MixRotate { get; }
        public PreparedTrack? MixX { get; }
        public PreparedTrack? MixY { get; }

        public PreparedPathChannel(
            int constraintIndex,
            PreparedTrack? position,
            PreparedTrack? spacing,
            PreparedTrack? mixRotate,
            PreparedTrack? mixX,
            PreparedTrack? mixY)
        {
            ConstraintIndex = constraintIndex;
            Position = position;
            Spacing = spacing;
            MixRotate = mixRotate;
            MixX = mixX;
            MixY = mixY;
        }
    }

    // The timelines of one animated physics constraint (ADR-0014 section 7, PP-B7), resolved to the pose's
    // physics-constraint index (mirrors PreparedPhysicsChannel in prepared.ts). Each of the six KEYABLE knobs
    // is prepared from ONLY the keyframes that key it: a channel no keyframe keys is null and holds the
    // constraint base. Step/Mass/Channels are NOT keyable and never appear here. Mix/Inertia/Damping are
    // [0, 1] value tracks, Strength is >= 0, and Wind/Gravity are unbounded finite value tracks.
    public sealed class PreparedPhysicsChannel
    {
        public int ConstraintIndex { get; }
        public PreparedTrack? Mix { get; }
        public PreparedTrack? Inertia { get; }
        public PreparedTrack? Strength { get; }
        public PreparedTrack? Damping { get; }
        public PreparedTrack? Wind { get; }
        public PreparedTrack? Gravity { get; }

        public PreparedPhysicsChannel(
            int constraintIndex,
            PreparedTrack? mix,
            PreparedTrack? inertia,
            PreparedTrack? strength,
            PreparedTrack? damping,
            PreparedTrack? wind,
            PreparedTrack? gravity)
        {
            ConstraintIndex = constraintIndex;
            Mix = mix;
            Inertia = inertia;
            Strength = strength;
            Damping = damping;
            Wind = wind;
            Gravity = gravity;
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

        // The path-constraint timelines (ADR-0011 section 3, ADR-0013), empty when the animation keys none.
        public IReadOnlyList<PreparedPathChannel> PathChannels { get; }

        // The physics-constraint timelines (ADR-0014 section 7, PP-B7), empty when the animation keys none.
        public IReadOnlyList<PreparedPhysicsChannel> PhysicsChannels { get; }
        public IReadOnlyList<PreparedDeformChannel> DeformChannels { get; }

        // The draw-order reorder timeline, or null when this animation never reorders (PP-B4).
        public PreparedDrawOrderTimeline? DrawOrder { get; }

        public PreparedAnimation(
            IReadOnlyList<PreparedBoneChannels> boneChannels,
            IReadOnlyList<PreparedSlotChannels> slotChannels,
            IReadOnlyList<PreparedIkChannel> ikChannels,
            IReadOnlyList<PreparedTransformChannel> transformChannels,
            IReadOnlyList<PreparedPathChannel> pathChannels,
            IReadOnlyList<PreparedPhysicsChannel> physicsChannels,
            IReadOnlyList<PreparedDeformChannel> deformChannels,
            PreparedDrawOrderTimeline? drawOrder)
        {
            BoneChannels = boneChannels;
            SlotChannels = slotChannels;
            IkChannels = ikChannels;
            TransformChannels = transformChannels;
            PathChannels = pathChannels;
            PhysicsChannels = physicsChannels;
            DeformChannels = deformChannels;
            DrawOrder = drawOrder;
        }
    }
}
