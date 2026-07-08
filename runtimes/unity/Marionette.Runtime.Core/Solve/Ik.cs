using System;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.Core.Solve
{
    // IK constraints (mirrors packages/runtime-core/src/solve/ik.ts, ADR-0003 section 4): read WORLD
    // positions, write LOCAL rotation, blended by mix in [0, 1]. IK never writes translation, scale,
    // shear, or a world matrix; it only rotates.
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

        // Write a new local rotation while preserving the bone's other local channels.
        private static void BlendLocalRotation(Pose pose, int boneIndex, double solvedRotDeg, double mix)
        {
            DecomposedTransform current = Affine.Decompose(ResolveWorld.LocalMat(pose, boneIndex));
            double blendedRot =
                current.RotationDeg + (mix * Scalar.WrapDegrees(solvedRotDeg - current.RotationDeg));
            Affine.ComposeInto(
                pose.Local,
                boneIndex * Affine.Mat2x3Stride,
                current.X,
                current.Y,
                blendedRot,
                current.ScaleX,
                current.ScaleY,
                current.ShearXDeg,
                0);
        }

        // One bone IK: rotate the bone so its X axis aims at the target world position.
        public static void SolveIkOneBone(
            Pose pose,
            int boneIndex,
            double targetWorldX,
            double targetWorldY,
            double mix)
        {
            if (mix <= 0)
            {
                return;
            }

            Mat2x3 world = ResolveWorld.ResolveMat(pose, boneIndex);
            double dx = targetWorldX - world.Tx;
            double dy = targetWorldY - world.Ty;
            if (((dx * dx) + (dy * dy)) < Epsilon)
            {
                return;
            }

            double worldAngle = Math.Atan2(dy, dx);
            double solvedRotDeg =
                WorldDirToLocalRotDeg(ResolveWorld.ParentWorldMat(pose, boneIndex), worldAngle);
            BlendLocalRotation(pose, boneIndex, solvedRotDeg, mix);
        }

        // Two bone IK via the law of cosines (ADR-0003 section 4). The chain base is the parent bone's
        // world origin, the joint is the parent's tip, and the tip is the child's tip. bendPositive selects
        // which of the two mirror solutions.
        public static void SolveIkTwoBone(
            Pose pose,
            int parentIndex,
            int childIndex,
            double targetWorldX,
            double targetWorldY,
            bool bendPositive,
            double mix)
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

            double cosAngle1 = Scalar.Clamp(
                ((distance * distance) + (len1 * len1) - (len2 * len2)) / (2.0 * len1 * distance),
                -1,
                1);
            double angle1 = Math.Acos(cosAngle1);
            double cosAngle2 = Scalar.Clamp(
                ((len1 * len1) + (len2 * len2) - (distance * distance)) / (2.0 * len1 * len2),
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
                mix);
            BlendLocalRotation(
                pose,
                childIndex,
                WorldDirToLocalRotDeg(ResolveWorld.ResolveMat(pose, parentIndex), phi2),
                mix);
        }
    }
}
