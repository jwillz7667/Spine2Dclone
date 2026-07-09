using System;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // IK constraints (mirrors packages/runtime-core/src/solve/ik.ts, ADR-0003 section 4, depth per ADR-0010
    // section 2): read WORLD positions, write LOCAL rotation (and, for the stretch/compress depth controls,
    // LOCAL scaleX), blended by mix in [0, 1]. IK never writes translation, shear, or a world matrix. Every
    // depth control is guarded on its enabling condition, so the default (softness 0, stretch/compress/uniform
    // false) is the exact ADR-0003 hard solve and the byte-locked pre-F2 fixtures are unchanged.
    internal static class Ik
    {
        // Below this a length or a target offset is degenerate and skipped, so no division by zero.
        private const double Epsilon = 1e-12;

        // Convert a desired WORLD direction angle (radians) into the LOCAL rotation (degrees) that makes
        // the bone's local X axis point that way under the given parent world frame.
        private static double WorldDirToLocalRotDeg(in Mat2x3 parentWorld, double worldAngleRad)
        {
            double wx = Math.Cos(worldAngleRad);
            double wy = Math.Sin(worldAngleRad);
            Mat2x3 inv = Affine.Invert(parentWorld);
            double localX = (inv.A * wx) + (inv.C * wy);
            double localY = (inv.B * wx) + (inv.D * wy);
            return Math.Atan2(localY, localX) * Scalar.RadToDeg;
        }

        // Write a new local rotation (and optionally scale local X by a factor) while preserving the bone's
        // other local channels. mix = 0 reproduces the current matrix exactly (and the scale factor collapses
        // to 1); mix = 1 lands on the solved rotation and the full scale factor. scaleXMul = 1 (no
        // stretch/compress) leaves scaleX untouched at every mix, so a non-stretching solve is byte-identical
        // to the pre-F2 rotation-only write.
        private static void BlendLocalRotation(
            Pose pose,
            int boneIndex,
            double solvedRotDeg,
            double mix,
            double scaleXMul)
        {
            DecomposedTransform current = Affine.Decompose(ResolveWorld.LocalMat(pose, boneIndex));
            double blendedRot =
                current.RotationDeg + (mix * Scalar.WrapDegrees(solvedRotDeg - current.RotationDeg));
            double blendedScaleX = current.ScaleX * (1.0 + (mix * (scaleXMul - 1.0)));
            Affine.ComposeInto(
                pose.Local,
                boneIndex * Affine.Mat2x3Stride,
                current.X,
                current.Y,
                blendedRot,
                blendedScaleX,
                current.ScaleY,
                current.ShearXDeg,
                0);
        }

        // Soft-reach remap of the base-to-target distance for the two-bone angle solve (ADR-0010 section
        // 2.3). Below the soft band (or with softness 0) it is the identity. In the band it is C1-continuous
        // with the identity at the entry and asymptotes to reach from below. The result is floored at EPSILON
        // so a pathological softness > reach cannot drive the cosine denominators negative.
        private static double SoftReachDistance(double distance, double reach, double softness)
        {
            if (softness <= 0)
            {
                return distance;
            }

            double bandStart = reach - softness;
            if (distance <= bandStart)
            {
                return distance;
            }

            double eased = reach - (softness * Math.Exp(-(distance - bandStart) / softness));
            return eased < Epsilon ? Epsilon : eased;
        }

        // One bone IK: rotate the bone so its X axis aims at the target world position. stretch (target
        // beyond the bone's length) and compress (target closer than its length) scale local X by d / len so
        // the single segment reaches the target; the default (both false) leaves scale at 1 and the write is
        // the pre-F2 rotation-only aim.
        public static void SolveIkOneBone(
            Pose pose,
            int boneIndex,
            double targetWorldX,
            double targetWorldY,
            double mix,
            bool stretch,
            bool compress)
        {
            if (mix <= 0)
            {
                return;
            }

            Mat2x3 world = ResolveWorld.ResolveMat(pose, boneIndex);
            double dx = targetWorldX - world.Tx;
            double dy = targetWorldY - world.Ty;
            double distanceSq = (dx * dx) + (dy * dy);
            if (distanceSq < Epsilon)
            {
                return;
            }

            double worldAngle = Math.Atan2(dy, dx);
            double solvedRotDeg =
                WorldDirToLocalRotDeg(ResolveWorld.ParentWorldMat(pose, boneIndex), worldAngle);

            // The bone's world length is its setup length scaled by its world X-axis magnitude.
            double len = pose.BoneLength[boneIndex] * Affine.Hypot(world.A, world.B);
            double scaleXMul = 1.0;
            if (len >= Epsilon)
            {
                double distance = Math.Sqrt(distanceSq);
                if ((stretch && distance > len) || (compress && distance < len))
                {
                    scaleXMul = distance / len;
                }
            }

            BlendLocalRotation(pose, boneIndex, solvedRotDeg, mix, scaleXMul);
        }

        // Two bone IK via the law of cosines (ADR-0003 section 4, depth per ADR-0010 section 2). The chain
        // base is the parent bone's world origin, the joint is the parent's tip, and the tip is the child's
        // tip. bendPositive selects which of the two mirror solutions.
        //
        // Depth controls: stretch lengthens the chain straight to a target beyond full reach; compress
        // shrinks it to a target closer than its fold boundary; uniform selects whether stretch scales both
        // bones or only the parent; softness eases the approach to full extension. With all at their defaults
        // this is the exact ADR-0003 hard solve.
        public static void SolveIkTwoBone(
            Pose pose,
            int parentIndex,
            int childIndex,
            double targetWorldX,
            double targetWorldY,
            bool bendPositive,
            double mix,
            double softness,
            bool stretch,
            bool compress,
            bool uniform)
        {
            if (mix <= 0)
            {
                return;
            }

            Mat2x3 parentWorld = ResolveWorld.ResolveMat(pose, parentIndex);
            Mat2x3 childWorld = ResolveWorld.ResolveMat(pose, childIndex);
            double len1 = pose.BoneLength[parentIndex] * Affine.Hypot(parentWorld.A, parentWorld.B);
            double len2 = pose.BoneLength[childIndex] * Affine.Hypot(childWorld.A, childWorld.B);
            if (len1 < Epsilon || len2 < Epsilon)
            {
                return;
            }

            double baseX = parentWorld.Tx;
            double baseY = parentWorld.Ty;
            double toTargetX = targetWorldX - baseX;
            double toTargetY = targetWorldY - baseY;
            double distance = Math.Max(Affine.Hypot(toTargetX, toTargetY), Epsilon);
            double baseAngle = Math.Atan2(toTargetY, toTargetX);
            double reach = len1 + len2;

            // Stretch: the target is beyond full reach and the chain may lengthen. It straightens (both bones
            // aim at the target) and scales the PARENT bone's local X so the straightened tip lands on the
            // target; the child rides the parent's scale through transform inheritance (ADR-0010 section 2.1).
            // uniform: scale the parent by d/reach and leave the child (childMul 1), so the child inherits the
            // same factor and BOTH world segments scale by d/reach. Non-uniform: grow the parent to length
            // (d - len2) and counter-scale the child by the inverse so ONLY the parent lengthens.
            if (stretch && distance > reach)
            {
                double parentScaleMulStretch;
                double childScaleMul;
                if (uniform)
                {
                    parentScaleMulStretch = distance / reach;
                    childScaleMul = 1.0;
                }
                else
                {
                    parentScaleMulStretch = (distance - len2) / len1;
                    childScaleMul = len1 / (distance - len2);
                }

                BlendLocalRotation(
                    pose,
                    parentIndex,
                    WorldDirToLocalRotDeg(ResolveWorld.ParentWorldMat(pose, parentIndex), baseAngle),
                    mix,
                    parentScaleMulStretch);
                BlendLocalRotation(
                    pose,
                    childIndex,
                    WorldDirToLocalRotDeg(ResolveWorld.ResolveMat(pose, parentIndex), baseAngle),
                    mix,
                    childScaleMul);
                return;
            }

            // Compress: the target is closer than the chain can reach by folding (inside the dead zone of
            // radius |len1 - len2|). The law of cosines below already folds the chain; compress additionally
            // scales the PARENT by d/dead so the folded tip, which rides the parent's scale by inheritance,
            // shrinks to reach the near target (ADR-0010 section 2.2). dead == 0 (equal segments) leaves the
            // ADR-0003 hard fold.
            double dead = Math.Abs(len1 - len2);
            double parentScaleMul = 1.0;
            double solveDistance = SoftReachDistance(distance, reach, softness);
            if (compress && dead >= Epsilon && distance < dead)
            {
                parentScaleMul = distance / dead;
                solveDistance = distance;
            }

            double cosAngle1 = Scalar.Clamp(
                ((solveDistance * solveDistance) + (len1 * len1) - (len2 * len2)) / (2.0 * len1 * solveDistance),
                -1,
                1);
            double angle1 = Math.Acos(cosAngle1);
            double cosAngle2 = Scalar.Clamp(
                ((len1 * len1) + (len2 * len2) - (solveDistance * solveDistance)) / (2.0 * len1 * len2),
                -1,
                1);
            double angle2 = Math.Acos(cosAngle2);

            double bend = bendPositive ? 1.0 : -1.0;
            double phi1 = baseAngle + (bend * angle1);
            double phi2 = phi1 + (bend * (angle2 - Math.PI));

            BlendLocalRotation(
                pose,
                parentIndex,
                WorldDirToLocalRotDeg(ResolveWorld.ParentWorldMat(pose, parentIndex), phi1),
                mix,
                parentScaleMul);
            BlendLocalRotation(
                pose,
                childIndex,
                WorldDirToLocalRotDeg(ResolveWorld.ResolveMat(pose, parentIndex), phi2),
                mix,
                1.0);
        }
    }
}
