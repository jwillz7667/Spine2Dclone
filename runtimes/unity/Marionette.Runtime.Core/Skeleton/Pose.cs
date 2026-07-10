using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Solve;

namespace Marionette.Runtime.Core.Skeleton
{
    // An IK constraint resolved against the pose (mirrors ResolvedIkConstraint in pose.ts). Chain bones
    // and target are stored as BONE INDICES so step 3 never re resolves names per frame. SampledMix and
    // SampledBendPositive are the per frame scratch step 2 writes and step 3 reads; the object is built
    // once and mutated in place, so the per frame solve allocates none.
    public sealed class ResolvedIkConstraint
    {
        public string Name { get; }
        public int[] BoneIndices { get; }
        public int TargetIndex { get; }
        public double BaseMix { get; }
        public bool BaseBendPositive { get; }

        // Depth controls from the constraint definition (ADR-0009 section 1.1, ADR-0010 section 2). Base*
        // are the definition values; the Sampled* scratch carries the per-frame values (softness/stretch/
        // compress may be keyed, Uniform is static). Defaults (softness 0, all false) reproduce the ADR-0003
        // hard solve. Order is the explicit combined-set solve order (ADR-0009 section 1.3), or -1 for none.
        public double BaseSoftness { get; }
        public bool BaseStretch { get; }
        public bool BaseCompress { get; }
        public bool Uniform { get; }
        public int Order { get; }

        // The names of the skins that SCOPE this constraint (ADR-0009 section 5, ADR-0011 section 4), or null
        // when no skin lists it (unscoped, always active). A scoped constraint solves only when one of these
        // skins is active (the 'default' skin is always active). Captured once at build; mirrors pose.ts.
        public IReadOnlyList<string>? ScopeSkins { get; }

        public double SampledMix;
        public bool SampledBendPositive;
        public double SampledSoftness;
        public bool SampledStretch;
        public bool SampledCompress;

        public ResolvedIkConstraint(
            string name,
            int[] boneIndices,
            int targetIndex,
            double baseMix,
            bool baseBendPositive,
            double baseSoftness,
            bool baseStretch,
            bool baseCompress,
            bool uniform,
            int order,
            IReadOnlyList<string>? scopeSkins)
        {
            Name = name;
            BoneIndices = boneIndices;
            TargetIndex = targetIndex;
            BaseMix = baseMix;
            BaseBendPositive = baseBendPositive;
            BaseSoftness = baseSoftness;
            BaseStretch = baseStretch;
            BaseCompress = baseCompress;
            Uniform = uniform;
            Order = order;
            ScopeSkins = scopeSkins;
            SampledMix = baseMix;
            SampledBendPositive = baseBendPositive;
            SampledSoftness = baseSoftness;
            SampledStretch = baseStretch;
            SampledCompress = baseCompress;
        }
    }

    // A transform constraint resolved against the pose (mirrors ResolvedTransformConstraint in pose.ts).
    public sealed class ResolvedTransformConstraint
    {
        public string Name { get; }
        public int[] BoneIndices { get; }
        public int TargetIndex { get; }
        public TransformMix BaseMix { get; }
        public TransformOffset Offset { get; }

        // Variant flags (ADR-0009 section 1.2); default false/false is the ADR-0003 world absolute blend.
        // Order is the explicit combined-set solve order (ADR-0009 section 1.3), or -1 when none is carried.
        public bool Local { get; }
        public bool Relative { get; }
        public int Order { get; }

        // The names of the skins that SCOPE this constraint (ADR-0009 section 5), or null when unscoped.
        // Captured once at build; mirrors ResolvedTransformConstraint.scopeSkins in pose.ts.
        public IReadOnlyList<string>? ScopeSkins { get; }

        public TransformMix SampledMix { get; }

        public ResolvedTransformConstraint(
            string name,
            int[] boneIndices,
            int targetIndex,
            TransformMix baseMix,
            TransformOffset offset,
            bool local,
            bool relative,
            int order,
            IReadOnlyList<string>? scopeSkins)
        {
            Name = name;
            BoneIndices = boneIndices;
            TargetIndex = targetIndex;
            BaseMix = baseMix;
            Offset = offset;
            Local = local;
            Relative = relative;
            Order = order;
            ScopeSkins = scopeSkins;
            SampledMix = new TransformMix(
                baseMix.Rotate,
                baseMix.X,
                baseMix.Y,
                baseMix.ScaleX,
                baseMix.ScaleY,
                baseMix.ShearY);
        }
    }

    // A path constraint resolved against the pose (mirrors ResolvedPathConstraint in pose.ts, ADR-0013,
    // PP-B6). BoneIndices are the bones distributed along the path (document/list order == along-path order).
    // Path is the prepared spline GEOMETRY built once from the target slot's setup default-skin path
    // attachment, or null when no path is resolvable (the constraint is then a no-op). The mode enums, base
    // channel values, and OffsetRotation come from the constraint definition; the Sampled* scratch is the per
    // frame values step 2 writes (from the path timeline, else reset to base) and step 3 reads. Built once and
    // mutated in place, so the per frame solve allocates nothing.
    public sealed class ResolvedPathConstraint
    {
        public string Name { get; }
        public int[] BoneIndices { get; }
        public PathPositionMode PositionMode { get; }
        public PathSpacingMode SpacingMode { get; }
        public PathRotateMode RotateMode { get; }
        public double OffsetRotation { get; }
        public double BasePosition { get; }
        public double BaseSpacing { get; }
        public double BaseMixRotate { get; }
        public double BaseMixX { get; }
        public double BaseMixY { get; }

        // The prepared spline geometry (control points, curve count, committed lengths, world scratch), or null
        // when the target slot has no resolvable setup path attachment (ADR-0013 section 7).
        public PreparedPathGeometry? Path { get; }

        // The explicit combined-set solve order (ADR-0011 section 2.3), or -1 when this constraint carries none.
        public int Order { get; }

        // The skins that SCOPE this constraint (ADR-0011 section 4), or null when unscoped.
        public IReadOnlyList<string>? ScopeSkins { get; }

        public double SampledPosition;
        public double SampledSpacing;
        public double SampledMixRotate;
        public double SampledMixX;
        public double SampledMixY;

        public ResolvedPathConstraint(
            string name,
            int[] boneIndices,
            PathPositionMode positionMode,
            PathSpacingMode spacingMode,
            PathRotateMode rotateMode,
            double offsetRotation,
            double basePosition,
            double baseSpacing,
            double baseMixRotate,
            double baseMixX,
            double baseMixY,
            PreparedPathGeometry? path,
            int order,
            IReadOnlyList<string>? scopeSkins)
        {
            Name = name;
            BoneIndices = boneIndices;
            PositionMode = positionMode;
            SpacingMode = spacingMode;
            RotateMode = rotateMode;
            OffsetRotation = offsetRotation;
            BasePosition = basePosition;
            BaseSpacing = baseSpacing;
            BaseMixRotate = baseMixRotate;
            BaseMixX = baseMixX;
            BaseMixY = baseMixY;
            Path = path;
            Order = order;
            ScopeSkins = scopeSkins;
            SampledPosition = basePosition;
            SampledSpacing = baseSpacing;
            SampledMixRotate = baseMixRotate;
            SampledMixX = baseMixX;
            SampledMixY = baseMixY;
        }
    }

    // A physics constraint resolved against the pose (mirrors ResolvedPhysicsConstraint in pose.ts, ADR-0014,
    // PP-B7). Physics binds to ONE BoneIndex (both the driven bone and its own setpoint reference) and
    // simulates a subset of that bone's LOCAL channels as independent damped-driven springs. ChannelCodes
    // holds one code per simulated channel (PhysicsConstraintSolve.PhysicsChannel*), document order; ChannelX/
    // ChannelY are the array positions of the x/y channels (or -1) so the force projection and teleport measure
    // read them without a scan. Base* are the constraint definition's values; the Sampled* fields are the
    // per-frame scratch step 2 writes (from the physics timeline, else reset to base) and step 3 reads (step/
    // mass are static, not keyable). The (P, V, TargetPrev) simulation state and AccFixed/Initialized are
    // pre-allocated ONCE here and MUTATE ACROSS FRAMES (physics carries velocity), so the per-frame solve
    // allocates nothing; they are reset by ResetPhysics.
    public sealed class ResolvedPhysicsConstraint
    {
        public string Name { get; }
        public int BoneIndex { get; }

        // One channel code per simulated channel, document order (PhysicsConstraintSolve.PhysicsChannel*).
        public sbyte[] ChannelCodes { get; }
        public bool SimulatesX { get; }
        public bool SimulatesY { get; }

        // The array position of the x / y channel within ChannelCodes (or -1 when not simulated), so the force
        // projection and the teleport translation-jump measure index the state arrays directly.
        public int ChannelX { get; }
        public int ChannelY { get; }

        // Static (non-keyable) model parameters (ADR-0014 section 7): the fixed timestep and the inertial mass.
        public double BaseStep { get; }
        public double BaseMass { get; }

        // The definition base values for the keyable knobs, the reset target for ResetConstraintsToBase.
        public double BaseInertia { get; }
        public double BaseStrength { get; }
        public double BaseDamping { get; }
        public double BaseWind { get; }
        public double BaseGravity { get; }
        public double BaseMix { get; }

        // The explicit combined-set solve order (ADR-0014 section 4), or -1 when this constraint carries none.
        public int Order { get; }

        // The skins that SCOPE this constraint (ADR-0009 section 5), or null when unscoped.
        public IReadOnlyList<string>? ScopeSkins { get; }

        // Per-frame sampled scratch (the keyable knobs), reset to base each frame and overlaid by the timeline.
        public double SampledInertia;
        public double SampledStrength;
        public double SampledDamping;
        public double SampledWind;
        public double SampledGravity;
        public double SampledMix;

        // Simulation state, one lane per simulated channel, persisting across frames (mutated in place).
        public double[] P { get; }
        public double[] V { get; }
        public double[] TargetPrev { get; }

        // The integer fixed-point step accumulator (ADR-0014 section 2.2) and the first-evaluation flag (false
        // means "initialize to rest on the pose on the next active solve", which is also the skin-change /
        // activation reset edge). Mutable: the solve advances them every frame. AccFixed is a 32-bit int so its
        // >> 16 / << 16 match the TS bitwise coercion exactly.
        public int AccFixed;
        public bool Initialized;

        public ResolvedPhysicsConstraint(
            string name,
            int boneIndex,
            sbyte[] channelCodes,
            bool simulatesX,
            bool simulatesY,
            int channelX,
            int channelY,
            double baseStep,
            double baseMass,
            double baseInertia,
            double baseStrength,
            double baseDamping,
            double baseWind,
            double baseGravity,
            double baseMix,
            int order,
            IReadOnlyList<string>? scopeSkins)
        {
            Name = name;
            BoneIndex = boneIndex;
            ChannelCodes = channelCodes;
            SimulatesX = simulatesX;
            SimulatesY = simulatesY;
            ChannelX = channelX;
            ChannelY = channelY;
            BaseStep = baseStep;
            BaseMass = baseMass;
            BaseInertia = baseInertia;
            BaseStrength = baseStrength;
            BaseDamping = baseDamping;
            BaseWind = baseWind;
            BaseGravity = baseGravity;
            BaseMix = baseMix;
            Order = order;
            ScopeSkins = scopeSkins;
            SampledInertia = baseInertia;
            SampledStrength = baseStrength;
            SampledDamping = baseDamping;
            SampledWind = baseWind;
            SampledGravity = baseGravity;
            SampledMix = baseMix;
            P = new double[channelCodes.Length];
            V = new double[channelCodes.Length];
            TargetPrev = new double[channelCodes.Length];
            AccFixed = 0;
            Initialized = false;
        }
    }

    // Pre allocated, index addressed storage for a skeleton solve (mirrors pose.ts). Every buffer is
    // sized once and reused across solves, so the per frame solve allocates nothing. Bones are stored in
    // document order, which the format validator guarantees is parent before child.
    public sealed class Pose
    {
        // The number of f64 lanes one bone's setup transform occupies: x, y, rotation, scaleX, scaleY,
        // shearX, shearY (degrees for the angles), in document bone order.
        public const int SetupStride = 7;

        // The number of f64 lanes one slot's color occupies: r, g, b, a in [0, 1].
        public const int SlotColorStride = 4;

        public int BoneCount { get; }
        public IReadOnlyList<string> BoneNames { get; }
        public int[] ParentIndices { get; }
        public sbyte[] TransformModes { get; }
        public double[] Setup { get; }
        public double[] Local { get; }
        public double[] BlendLocal { get; }
        public byte[] BoneTouched { get; }
        public double[] World { get; }
        public double[] BoneLength { get; }

        public int SlotCount { get; }
        public IReadOnlyList<string> SlotNames { get; }
        public int[] SlotBoneIndices { get; }
        public double[] SlotSetupColor { get; }
        public double[] SlotColor { get; }

        // SlotColorStride lanes per slot: the setup two-color DARK tint (ADR-0009 section 4.3, ADR-0011
        // section 3), the reset source for the keyable dark color. A slot with no setup darkColor keeps
        // (0, 0, 0, 1) here (inert). SlotHasDarkColor records which slots declared one, so a renderer /
        // fixture reads the dark lane only where two-color tinting is enabled.
        public double[] SlotSetupDarkColor { get; }

        // SlotColorStride lanes per slot: the resolved dark tint written by the sampler (reset to
        // SlotSetupDarkColor each frame in step 1, blended by the `dark` timeline in step 2).
        public double[] SlotDarkColor { get; }

        // One flag per slot: 1 when the slot declared a setup darkColor (two-color tinting enabled). The
        // format guarantees a slot that keys a `dark` timeline has a setup darkColor (ANIM_DARK_NO_SETUP).
        public byte[] SlotHasDarkColor { get; }
        public double[] SlotAttachmentWinWeight { get; }
        public double[] IkBendWinWeight { get; }

        // One f64 per IK constraint each: the discrete greater-weight-wins winner weights for that
        // constraint's sampled stretch and compress depth flags this frame (ADR-0010 section 2.4), reset to
        // -1 by BeginBlend, exactly like IkBendWinWeight.
        public double[] IkStretchWinWeight { get; }
        public double[] IkCompressWinWeight { get; }
        public string?[] SlotSetupAttachment { get; }
        public string?[] SlotAttachment { get; }

        // The resolved render order (ADR-0008 draw order, PP-B4): DrawOrder[renderPosition] = slotIndex.
        // Reset to SlotSetupDrawOrder (identity) each frame (step 1) and overwritten by the active key
        // (step 2). DrawOrderWinWeight is a length-1 buffer holding the discrete winner weight (reset to -1
        // by BeginBlend), mirroring the pose.ts scalar kept in a typed array so the pose stays a buffer.
        public int[] DrawOrder { get; }
        public int[] SlotSetupDrawOrder { get; }
        public double[] DrawOrderWinWeight { get; }

        public IReadOnlyList<ResolvedIkConstraint> IkConstraints { get; }
        public IReadOnlyList<ResolvedTransformConstraint> TransformConstraints { get; }

        // The document's path constraints (ADR-0013, PP-B6), resolved in document array order. Solved AFTER all
        // IK and all transform constraints by default (ADR-0011 section 2.3). Empty for a rig with none.
        public IReadOnlyList<ResolvedPathConstraint> PathConstraints { get; }

        // The document's physics constraints (ADR-0014, PP-B7), resolved in document array order. Solved AFTER
        // all IK, transform, and path constraints by default (ADR-0014 section 4): physics is secondary motion
        // layered on the final posed skeleton. Empty for a rig with none; carries the persistent (P, V) state.
        public IReadOnlyList<ResolvedPhysicsConstraint> PhysicsConstraints { get; }

        // The skeleton-level physics globals (ADR-0014 section 5), captured at build (defaults 0, 0, 1 when the
        // document omits the block). Read by every physics constraint's per-frame combine; never mutated.
        public PhysicsSettings PhysicsSettings { get; }

        // The explicit combined-set solve schedule (ADR-0009 section 1.3, ADR-0010 section 1, ADR-0011 section
        // 2.3) or null when no constraint carries an order. When present it is a dense permutation of [0, N)
        // (N = total constraints across all THREE arrays): SolveOrder[pos] is a constraint CODE selecting
        // IkConstraints[code] when code < ikCount, TransformConstraints[code - ikCount] when
        // ikCount <= code < ikCount + transformCount, else PathConstraints[code - ikCount - transformCount].
        // Null keeps the exact default (all IK, then all transform, then all path) path, so a rig without order
        // is byte-identical. Precomputed once at build; never touched per frame.
        public int[]? SolveOrder { get; }

        // Reused scratch for sampled deform offsets (grows only when a larger mesh is sampled).
        public double[] DeformScratch;

        // Prepared animations cached by Animation identity (reference equality), so the first sample of an
        // animation builds it and every later sample reuses it with zero allocation.
        public Dictionary<Animation, PreparedAnimation> PreparedAnimations { get; }

        public Pose(
            int boneCount,
            IReadOnlyList<string> boneNames,
            int slotCount,
            IReadOnlyList<string> slotNames,
            IReadOnlyList<ResolvedIkConstraint> ikConstraints,
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints,
            IReadOnlyList<ResolvedPathConstraint> pathConstraints,
            IReadOnlyList<ResolvedPhysicsConstraint> physicsConstraints,
            PhysicsSettings physicsSettings)
        {
            BoneCount = boneCount;
            BoneNames = boneNames;
            ParentIndices = new int[boneCount];
            TransformModes = new sbyte[boneCount];
            Setup = new double[boneCount * SetupStride];
            Local = new double[boneCount * Affine.Mat2x3Stride];
            BlendLocal = new double[boneCount * SetupStride];
            BoneTouched = new byte[boneCount];
            World = new double[boneCount * Affine.Mat2x3Stride];
            BoneLength = new double[boneCount];

            SlotCount = slotCount;
            SlotNames = slotNames;
            SlotBoneIndices = new int[slotCount];
            SlotSetupColor = new double[slotCount * SlotColorStride];
            SlotColor = new double[slotCount * SlotColorStride];
            SlotSetupDarkColor = new double[slotCount * SlotColorStride];
            SlotDarkColor = new double[slotCount * SlotColorStride];
            SlotHasDarkColor = new byte[slotCount];
            SlotAttachmentWinWeight = new double[slotCount];
            IkBendWinWeight = new double[ikConstraints.Count];
            IkStretchWinWeight = new double[ikConstraints.Count];
            IkCompressWinWeight = new double[ikConstraints.Count];
            SlotSetupAttachment = new string?[slotCount];
            SlotAttachment = new string?[slotCount];
            DrawOrder = IdentityDrawOrder(slotCount);
            SlotSetupDrawOrder = IdentityDrawOrder(slotCount);
            DrawOrderWinWeight = new double[1];

            IkConstraints = ikConstraints;
            TransformConstraints = transformConstraints;
            PathConstraints = pathConstraints;
            PhysicsConstraints = physicsConstraints;
            PhysicsSettings = physicsSettings;
            SolveOrder = BuildSolveOrder(
                ikConstraints, transformConstraints, pathConstraints, physicsConstraints);
            DeformScratch = new double[0];
            PreparedAnimations = new Dictionary<Animation, PreparedAnimation>();
        }

        private static int[] IdentityDrawOrder(int slotCount)
        {
            var order = new int[slotCount];
            for (int i = 0; i < slotCount; i += 1)
            {
                order[i] = i;
            }

            return order;
        }

        // Precompute the explicit combined-set solve schedule (ADR-0010 section 1). Returns null when no
        // constraint carries an order (the ADR-0003 two-phase default). When ANY carries one, the format
        // guarantees a dense unique permutation of [0, N); this builds the position->code map from that. It
        // is defensive against an UNVALIDATED document (a partial, duplicated, gapped, or out-of-range
        // assignment falls back to null, the safe document-order default) rather than a corrupt schedule.
        private static int[]? BuildSolveOrder(
            IReadOnlyList<ResolvedIkConstraint> ikConstraints,
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints,
            IReadOnlyList<ResolvedPathConstraint> pathConstraints,
            IReadOnlyList<ResolvedPhysicsConstraint> physicsConstraints)
        {
            int ikCount = ikConstraints.Count;
            int transformCount = transformConstraints.Count;
            int pathCount = pathConstraints.Count;
            int total = ikCount + transformCount + pathCount + physicsConstraints.Count;
            if (total == 0)
            {
                return null;
            }

            bool anyOrder = false;
            for (int i = 0; i < ikCount; i += 1)
            {
                if (ikConstraints[i].Order >= 0)
                {
                    anyOrder = true;
                }
            }

            for (int i = 0; i < transformCount; i += 1)
            {
                if (transformConstraints[i].Order >= 0)
                {
                    anyOrder = true;
                }
            }

            for (int i = 0; i < pathCount; i += 1)
            {
                if (pathConstraints[i].Order >= 0)
                {
                    anyOrder = true;
                }
            }

            for (int i = 0; i < physicsConstraints.Count; i += 1)
            {
                if (physicsConstraints[i].Order >= 0)
                {
                    anyOrder = true;
                }
            }

            if (!anyOrder)
            {
                return null;
            }

            var codes = new int[total];
            for (int i = 0; i < total; i += 1)
            {
                codes[i] = -1;
            }

            for (int i = 0; i < ikCount; i += 1)
            {
                if (!Place(codes, total, ikConstraints[i].Order, i))
                {
                    return null;
                }
            }

            for (int j = 0; j < transformCount; j += 1)
            {
                if (!Place(codes, total, transformConstraints[j].Order, ikCount + j))
                {
                    return null;
                }
            }

            for (int k = 0; k < pathCount; k += 1)
            {
                if (!Place(codes, total, pathConstraints[k].Order, ikCount + transformCount + k))
                {
                    return null;
                }
            }

            for (int m = 0; m < physicsConstraints.Count; m += 1)
            {
                if (!Place(codes, total, physicsConstraints[m].Order, ikCount + transformCount + pathCount + m))
                {
                    return null;
                }
            }

            return codes;
        }

        private static bool Place(int[] codes, int total, int order, int code)
        {
            if (order < 0 || order >= total || codes[order] != -1)
            {
                return false;
            }

            codes[order] = code;
            return true;
        }
    }
}
