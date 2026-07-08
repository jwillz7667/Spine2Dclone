using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.Core.Skeleton
{
    // Solve steps 1 and 4 (mirrors packages/runtime-core/src/skeleton/world-transform.ts).
    public static class WorldTransform
    {
        // Solve step 1 (reset to setup pose): write each bone's local matrix from its captured setup
        // transform. Allocation free.
        public static void ResetToSetupPose(Pose pose)
        {
            double[] setup = pose.Setup;
            double[] local = pose.Local;
            int boneCount = pose.BoneCount;
            for (int i = 0; i < boneCount; i += 1)
            {
                int s = i * Pose.SetupStride;
                Affine.ComposeInto(
                    local,
                    i * Affine.Mat2x3Stride,
                    setup[s],
                    setup[s + 1],
                    setup[s + 2],
                    setup[s + 3],
                    setup[s + 4],
                    setup[s + 5],
                    setup[s + 6]);
            }
        }

        // Solve step 4 (world transforms): a single forward pass. A root's world matrix equals its local
        // matrix; every other bone inherits its parent's world transform per its transformMode. The pass
        // relies on the validated parent precedes child ordering (parentIndex < i). Allocation free.
        public static void ComputeWorldTransforms(Pose pose)
        {
            double[] local = pose.Local;
            double[] world = pose.World;
            int[] parentIndices = pose.ParentIndices;
            sbyte[] transformModes = pose.TransformModes;
            int boneCount = pose.BoneCount;
            for (int i = 0; i < boneCount; i += 1)
            {
                int offset = i * Affine.Mat2x3Stride;
                int parent = parentIndices[i];
                if (parent < 0)
                {
                    Affine.CopyInto(world, offset, local, offset);
                }
                else if (transformModes[i] == TransformModes.Normal)
                {
                    Affine.MultiplyInto(world, offset, world, parent * Affine.Mat2x3Stride, local, offset);
                }
                else
                {
                    TransformModes.WorldFromParentByMode(
                        world,
                        offset,
                        world,
                        parent * Affine.Mat2x3Stride,
                        local,
                        offset,
                        transformModes[i]);
                }
            }
        }
    }
}
