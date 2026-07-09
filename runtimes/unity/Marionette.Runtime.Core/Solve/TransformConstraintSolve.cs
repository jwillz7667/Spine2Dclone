using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // Transform constraint (mirrors packages/runtime-core/src/solve/transform-constraint.ts, ADR-0003
    // section 5, variants per ADR-0009 section 1.2 / ADR-0010 section 3): default reads WORLD, blends in
    // WORLD, writes LOCAL. The `local` flag switches the space (the bone's own local components); the
    // `relative` flag switches the composition (a mix-scaled offset added to the bone's current value).
    // Default (local false, relative false) is the exact ADR-0003 solve, so pre-variant fixtures are
    // byte-identical.
    internal static class TransformConstraintSolve
    {
        // Blend one channel model toward a target under the mix and offset (ADR-0010 section 3). Absolute:
        // resultCh = lerp(boneCh, targetCh, mix) + offset. Relative: resultCh = boneCh + mix * (targetCh +
        // offset). WorldChannels is a readonly struct (value type), so this allocates no heap.
        private static WorldChannels BlendChannels(
            in WorldChannels bone,
            in WorldChannels target,
            in TransformMix mix,
            in TransformOffset offset,
            bool relative)
        {
            if (relative)
            {
                return new WorldChannels(
                    bone.Rotation + (mix.Rotate * (target.Rotation + offset.Rotation)),
                    bone.X + (mix.X * (target.X + offset.X)),
                    bone.Y + (mix.Y * (target.Y + offset.Y)),
                    bone.ScaleX + (mix.ScaleX * (target.ScaleX + offset.ScaleX)),
                    bone.ScaleY + (mix.ScaleY * (target.ScaleY + offset.ScaleY)),
                    bone.ShearY + (mix.ShearY * (target.ShearY + offset.ShearY)));
            }

            return new WorldChannels(
                Scalar.Lerp(bone.Rotation, target.Rotation, mix.Rotate) + offset.Rotation,
                Scalar.Lerp(bone.X, target.X, mix.X) + offset.X,
                Scalar.Lerp(bone.Y, target.Y, mix.Y) + offset.Y,
                Scalar.Lerp(bone.ScaleX, target.ScaleX, mix.ScaleX) + offset.ScaleX,
                Scalar.Lerp(bone.ScaleY, target.ScaleY, mix.ScaleY) + offset.ScaleY,
                Scalar.Lerp(bone.ShearY, target.ShearY, mix.ShearY) + offset.ShearY);
        }

        public static void Solve(
            Pose pose,
            int boneIndex,
            int targetIndex,
            TransformMix mix,
            TransformOffset offset,
            bool local,
            bool relative)
        {
            if (local)
            {
                // Local variant: read and write the bone's LOCAL components directly, no world round-trip.
                WorldChannels targetLocal = AffineChannels.DecomposeWorld(ResolveWorld.LocalMat(pose, targetIndex));
                WorldChannels boneLocal = AffineChannels.DecomposeWorld(ResolveWorld.LocalMat(pose, boneIndex));
                Mat2x3 blendedLocal = AffineChannels.ComposeWorld(
                    BlendChannels(in boneLocal, in targetLocal, in mix, in offset, relative));
                ResolveWorld.WriteLocalMat(pose, boneIndex, in blendedLocal);
                return;
            }

            WorldChannels targetChannels = AffineChannels.DecomposeWorld(ResolveWorld.ResolveMat(pose, targetIndex));
            WorldChannels boneChannels = AffineChannels.DecomposeWorld(ResolveWorld.ResolveMat(pose, boneIndex));
            Mat2x3 blended = AffineChannels.ComposeWorld(
                BlendChannels(in boneChannels, in targetChannels, in mix, in offset, relative));

            // Convert the blended WORLD matrix to LOCAL: local = inverse(parentWorld) * blendedWorld.
            int parent = pose.ParentIndices[boneIndex];
            Mat2x3 localMatrix = parent < 0
                ? blended
                : Affine.Multiply(Affine.Invert(ResolveWorld.ParentWorldMat(pose, boneIndex)), blended);
            ResolveWorld.WriteLocalMat(pose, boneIndex, in localMatrix);
        }
    }
}
