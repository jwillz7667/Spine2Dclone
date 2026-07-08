using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // On demand world resolution (mirrors packages/runtime-core/src/solve/resolve-world.ts). At solve
    // step 3 a constraint needs the would be world matrix of a bone while the authoritative forward pass
    // is still step 4. ResolveWorld composes the bone's ancestor chain root to bone using the SAME
    // multiply routine as step 4, so the world it produces equals what step 4 will produce.
    internal static class ResolveWorld
    {
        // The deepest ancestor chain the walk will follow. Far beyond any real rig depth.
        private const int MaxChainDepth = 256;

        // Solver owned scratch, reused across calls so ResolveWorld allocates nothing. The solve is single
        // threaded and ResolveWorld is never called re entrantly, so static scratch is safe (the harness
        // disables test parallelization to preserve that contract). Mirrors the module level scratch in
        // resolve-world.ts.
        [System.ThreadStatic]
        private static int[]? _chainStack;

        [System.ThreadStatic]
        private static double[]? _accumulator;

        [System.ThreadStatic]
        private static double[]? _product;

        [System.ThreadStatic]
        private static double[]? _matScratch;

        private static int[] ChainStack => _chainStack ??= new int[MaxChainDepth];

        private static double[] Accumulator => _accumulator ??= new double[Affine.Mat2x3Stride];

        private static double[] Product => _product ??= new double[Affine.Mat2x3Stride];

        private static double[] MatScratch => _matScratch ??= new double[Affine.Mat2x3Stride];

        // Write bone boneIndex's world matrix into output[outOffset .. outOffset + 5]. Allocation free.
        public static void Resolve(Pose pose, int boneIndex, double[] output, int outOffset)
        {
            int[] parentIndices = pose.ParentIndices;
            sbyte[] transformModes = pose.TransformModes;
            double[] local = pose.Local;
            int[] chainStack = ChainStack;
            double[] accumulator = Accumulator;
            double[] product = Product;

            int depth = 0;
            int cursor = boneIndex;
            while (cursor >= 0)
            {
                chainStack[depth] = cursor;
                depth += 1;
                cursor = parentIndices[cursor];
            }

            Affine.CopyInto(accumulator, 0, local, chainStack[depth - 1] * Affine.Mat2x3Stride);
            for (int k = depth - 2; k >= 0; k -= 1)
            {
                int childIndex = chainStack[k];
                int childOffset = childIndex * Affine.Mat2x3Stride;
                if (transformModes[childIndex] == Skeleton.TransformModes.Normal)
                {
                    Affine.MultiplyInto(product, 0, accumulator, 0, local, childOffset);
                }
                else
                {
                    Skeleton.TransformModes.WorldFromParentByMode(
                        product,
                        0,
                        accumulator,
                        0,
                        local,
                        childOffset,
                        transformModes[childIndex]);
                }

                Affine.CopyInto(accumulator, 0, product, 0);
            }

            Affine.CopyInto(output, outOffset, accumulator, 0);
        }

        // The world matrix of the bone as a value type, for the tuple style call sites.
        public static Mat2x3 ResolveMat(Pose pose, int boneIndex)
        {
            double[] scratch = MatScratch;
            Resolve(pose, boneIndex, scratch, 0);
            return Affine.Read(scratch, 0);
        }

        // The world matrix of a bone's PARENT, or identity for a root.
        public static Mat2x3 ParentWorldMat(Pose pose, int boneIndex)
        {
            int parent = pose.ParentIndices[boneIndex];
            return parent < 0 ? Affine.Identity() : ResolveMat(pose, parent);
        }

        public static Mat2x3 LocalMat(Pose pose, int boneIndex) =>
            Affine.Read(pose.Local, boneIndex * Affine.Mat2x3Stride);

        public static void WriteLocalMat(Pose pose, int boneIndex, in Mat2x3 m) =>
            Affine.Write(pose.Local, boneIndex * Affine.Mat2x3Stride, in m);
    }
}
