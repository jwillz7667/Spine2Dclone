using System;
using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.Core.Solve
{
    // Canonical 2D affine world channel decomposition and recomposition (mirrors
    // packages/runtime-core/src/solve/affine-channels.ts). This is the channel model transform
    // constraints blend in (read world, blend per channel in world, write local). Angles are kept in
    // DEGREES at this boundary to match Affine.Compose and the format's stored fields.
    public readonly struct WorldChannels
    {
        public readonly double Rotation;
        public readonly double X;
        public readonly double Y;
        public readonly double ScaleX;
        public readonly double ScaleY;
        public readonly double ShearY;

        public WorldChannels(
            double rotation,
            double x,
            double y,
            double scaleX,
            double scaleY,
            double shearY)
        {
            Rotation = rotation;
            X = x;
            Y = y;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearY = shearY;
        }
    }

    internal static class AffineChannels
    {
        public static WorldChannels DecomposeWorld(in Mat2x3 m)
        {
            // The X' column is (a, c), the Y' column is (b, d). In our column vector Mat2x3 that maps to
            // a = A, c = B (X column), b = C, d = D (Y column), NOT the literal field order.
            double a = m.A;
            double c = m.B;
            double b = m.C;
            double d = m.D;
            double rotation = Math.Atan2(c, a);
            double scaleX = Math.Sqrt((a * a) + (c * c));
            double det = (a * d) - (b * c);
            double scaleY = det / scaleX;
            double shearY = Math.Atan2((a * b) + (c * d), det);
            return new WorldChannels(
                rotation * Scalar.RadToDeg,
                m.Tx,
                m.Ty,
                scaleX,
                scaleY,
                shearY * Scalar.RadToDeg);
        }

        public static Mat2x3 ComposeWorld(in WorldChannels channels)
        {
            double rotation = channels.Rotation * Scalar.DegToRad;
            double shearY = channels.ShearY * Scalar.DegToRad;
            double cos = Math.Cos(rotation);
            double sin = Math.Sin(rotation);
            double tanShearY = Math.Tan(shearY);
            double scaleX = channels.ScaleX;
            double scaleY = channels.ScaleY;
            return new Mat2x3(
                scaleX * cos,
                scaleX * sin,
                scaleY * ((tanShearY * cos) - sin),
                scaleY * ((tanShearY * sin) + cos),
                channels.X,
                channels.Y);
        }
    }
}
