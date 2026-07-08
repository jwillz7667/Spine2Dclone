using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // Transform constraint (mirrors packages/runtime-core/src/solve/transform-constraint.ts, ADR-0003
    // section 5): read WORLD, blend in WORLD, write LOCAL. Per channel mix blends the constrained bone's
    // would be world channels toward the target's world channels; per channel offsets add on top.
    internal static class TransformConstraintSolve
    {
        public static void Solve(
            Pose pose,
            int boneIndex,
            int targetIndex,
            TransformMix mix,
            TransformOffset offset)
        {
            WorldChannels targetChannels = AffineChannels.DecomposeWorld(ResolveWorld.ResolveMat(pose, targetIndex));
            WorldChannels boneChannels = AffineChannels.DecomposeWorld(ResolveWorld.ResolveMat(pose, boneIndex));

            // worldCh = lerp(boneWorldCh, targetWorldCh, mixCh) + offsetCh. Plain (not shortest path) lerp
            // on rotation/shearY, exactly as the contract specifies.
            var blended = AffineChannels.ComposeWorld(new WorldChannels(
                Scalar.Lerp(boneChannels.Rotation, targetChannels.Rotation, mix.Rotate) + offset.Rotation,
                Scalar.Lerp(boneChannels.X, targetChannels.X, mix.X) + offset.X,
                Scalar.Lerp(boneChannels.Y, targetChannels.Y, mix.Y) + offset.Y,
                Scalar.Lerp(boneChannels.ScaleX, targetChannels.ScaleX, mix.ScaleX) + offset.ScaleX,
                Scalar.Lerp(boneChannels.ScaleY, targetChannels.ScaleY, mix.ScaleY) + offset.ScaleY,
                Scalar.Lerp(boneChannels.ShearY, targetChannels.ShearY, mix.ShearY) + offset.ShearY));

            // Convert the blended WORLD matrix to LOCAL: local = inverse(parentWorld) * blendedWorld.
            int parent = pose.ParentIndices[boneIndex];
            Mat2x3 local = parent < 0
                ? blended
                : Affine.Multiply(Affine.Invert(ResolveWorld.ParentWorldMat(pose, boneIndex)), blended);
            ResolveWorld.WriteLocalMat(pose, boneIndex, in local);
        }
    }
}
