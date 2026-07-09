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
        public double SampledMix;
        public bool SampledBendPositive;

        public ResolvedIkConstraint(
            string name,
            int[] boneIndices,
            int targetIndex,
            double baseMix,
            bool baseBendPositive)
        {
            Name = name;
            BoneIndices = boneIndices;
            TargetIndex = targetIndex;
            BaseMix = baseMix;
            BaseBendPositive = baseBendPositive;
            SampledMix = baseMix;
            SampledBendPositive = baseBendPositive;
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
        public TransformMix SampledMix { get; }

        public ResolvedTransformConstraint(
            string name,
            int[] boneIndices,
            int targetIndex,
            TransformMix baseMix,
            TransformOffset offset)
        {
            Name = name;
            BoneIndices = boneIndices;
            TargetIndex = targetIndex;
            BaseMix = baseMix;
            Offset = offset;
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
        public double[] SlotAttachmentWinWeight { get; }
        public double[] IkBendWinWeight { get; }
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
            SlotAttachmentWinWeight = new double[slotCount];
            IkBendWinWeight = new double[ikConstraints.Count];
            SlotSetupAttachment = new string?[slotCount];
            SlotAttachment = new string?[slotCount];
            DrawOrder = IdentityDrawOrder(slotCount);
            SlotSetupDrawOrder = IdentityDrawOrder(slotCount);
            DrawOrderWinWeight = new double[1];

            IkConstraints = ikConstraints;
            TransformConstraints = transformConstraints;
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
    }
}
