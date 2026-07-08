using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.Solve;

namespace Marionette.Runtime.Core.Skeleton
{
    // Build a Pose from a rig document (mirrors packages/runtime-core/src/skeleton/build-pose.ts). It
    // allocates the buffers once, captures each bone's setup transform and each slot's setup color, active
    // attachment name, and driving bone, resolves parent/slot bone names to indices, and resolves the
    // IK/transform constraints to bone indices in document array order. A name that does not resolve is
    // captured as -1 and skipped by the solve rather than crashing.
    public static class BuildPose
    {
        public static Pose Build(SkeletonDocument document)
        {
            IReadOnlyList<Bone> bones = document.Bones;
            int boneCount = bones.Count;
            var boneNames = new string[boneCount];
            for (int i = 0; i < boneCount; i += 1)
            {
                boneNames[i] = bones[i].Name;
            }

            IReadOnlyList<Slot> slots = document.Slots;
            int slotCount = slots.Count;
            var slotNames = new string[slotCount];
            for (int i = 0; i < slotCount; i += 1)
            {
                slotNames[i] = slots[i].Name;
            }

            var indexByName = new Dictionary<string, int>();
            for (int i = 0; i < boneCount; i += 1)
            {
                indexByName[boneNames[i]] = i;
            }

            var ikConstraints = new List<ResolvedIkConstraint>();
            foreach (IkConstraint constraint in document.IkConstraints)
            {
                ikConstraints.Add(ResolveIk(constraint, indexByName));
            }

            var transformConstraints = new List<ResolvedTransformConstraint>();
            foreach (TransformConstraint constraint in document.TransformConstraints)
            {
                transformConstraints.Add(ResolveTransform(constraint, indexByName));
            }

            var pose = new Pose(
                boneCount,
                boneNames,
                slotCount,
                slotNames,
                ikConstraints,
                transformConstraints);

            for (int i = 0; i < boneCount; i += 1)
            {
                Bone bone = bones[i];
                pose.ParentIndices[i] =
                    bone.Parent == null ? -1 : LookupOrMinusOne(indexByName, bone.Parent);
                pose.TransformModes[i] = (sbyte)TransformModes.FromName(bone.TransformMode);
                pose.BoneLength[i] = bone.Length;
                int b = i * Pose.SetupStride;
                pose.Setup[b] = bone.X;
                pose.Setup[b + 1] = bone.Y;
                pose.Setup[b + 2] = bone.Rotation;
                pose.Setup[b + 3] = bone.ScaleX;
                pose.Setup[b + 4] = bone.ScaleY;
                pose.Setup[b + 5] = bone.ShearX;
                pose.Setup[b + 6] = bone.ShearY;
            }

            for (int i = 0; i < slotCount; i += 1)
            {
                Slot slot = slots[i];
                pose.SlotBoneIndices[i] = LookupOrMinusOne(indexByName, slot.SlotBone);
                int b = i * Pose.SlotColorStride;
                pose.SlotSetupColor[b] = slot.Color.R;
                pose.SlotSetupColor[b + 1] = slot.Color.G;
                pose.SlotSetupColor[b + 2] = slot.Color.B;
                pose.SlotSetupColor[b + 3] = slot.Color.A;
                pose.SlotSetupAttachment[i] = slot.Attachment;
            }

            return pose;
        }

        private static int LookupOrMinusOne(Dictionary<string, int> indexByName, string name) =>
            indexByName.TryGetValue(name, out int value) ? value : -1;

        private static int[] ResolveBoneIndices(IReadOnlyList<string> names, Dictionary<string, int> indexByName)
        {
            var indices = new int[names.Count];
            for (int i = 0; i < names.Count; i += 1)
            {
                indices[i] = LookupOrMinusOne(indexByName, names[i]);
            }

            return indices;
        }

        private static ResolvedIkConstraint ResolveIk(IkConstraint constraint, Dictionary<string, int> indexByName)
        {
            return new ResolvedIkConstraint(
                constraint.Name,
                ResolveBoneIndices(constraint.Bones, indexByName),
                LookupOrMinusOne(indexByName, constraint.Target),
                constraint.Mix,
                constraint.BendPositive);
        }

        private static ResolvedTransformConstraint ResolveTransform(
            TransformConstraint constraint,
            Dictionary<string, int> indexByName)
        {
            var baseMix = new TransformMix(
                constraint.MixRotate,
                constraint.MixX,
                constraint.MixY,
                constraint.MixScaleX,
                constraint.MixScaleY,
                constraint.MixShearY);
            var offset = new TransformOffset(
                constraint.OffsetRotation,
                constraint.OffsetX,
                constraint.OffsetY,
                constraint.OffsetScaleX,
                constraint.OffsetScaleY,
                constraint.OffsetShearY);
            return new ResolvedTransformConstraint(
                constraint.Name,
                ResolveBoneIndices(constraint.Bones, indexByName),
                LookupOrMinusOne(indexByName, constraint.Target),
                baseMix,
                offset);
        }
    }
}
