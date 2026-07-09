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
            int order)
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

        public TransformMix SampledMix { get; }

        public ResolvedTransformConstraint(
            string name,
            int[] boneIndices,
            int targetIndex,
            TransformMix baseMix,
            TransformOffset offset,
            bool local,
            bool relative,
            int order)
        {
            Name = name;
            BoneIndices = boneIndices;
            TargetIndex = targetIndex;
            BaseMix = baseMix;
            Offset = offset;
            Local = local;
            Relative = relative;
            Order = order;
            SampledMix = new TransformMix(
                baseMix.Rotate,
                baseMix.X,
                baseMix.Y,
                baseMix.ScaleX,
                baseMix.ScaleY,
                baseMix.ShearY);
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

        // The explicit combined-set solve schedule (ADR-0009 section 1.3, ADR-0010 section 1) or null when
        // no constraint carries an order. When present it is a dense permutation of [0, N): SolveOrder[pos]
        // is a constraint CODE, code < IkConstraints.Count selecting IkConstraints[code], else
        // TransformConstraints[code - IkConstraints.Count]. Null keeps the exact ADR-0003 two-phase path, so
        // a rig without order is byte-identical. Precomputed once at build; never touched per frame.
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
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints)
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
            SolveOrder = BuildSolveOrder(ikConstraints, transformConstraints);
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
            IReadOnlyList<ResolvedTransformConstraint> transformConstraints)
        {
            int total = ikConstraints.Count + transformConstraints.Count;
            if (total == 0)
            {
                return null;
            }

            bool anyOrder = false;
            for (int i = 0; i < ikConstraints.Count; i += 1)
            {
                if (ikConstraints[i].Order >= 0)
                {
                    anyOrder = true;
                }
            }

            for (int i = 0; i < transformConstraints.Count; i += 1)
            {
                if (transformConstraints[i].Order >= 0)
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

            for (int i = 0; i < ikConstraints.Count; i += 1)
            {
                if (!Place(codes, total, ikConstraints[i].Order, i))
                {
                    return null;
                }
            }

            for (int j = 0; j < transformConstraints.Count; j += 1)
            {
                if (!Place(codes, total, transformConstraints[j].Order, ikConstraints.Count + j))
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
