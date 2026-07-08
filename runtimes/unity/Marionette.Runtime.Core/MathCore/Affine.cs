using System;

namespace Marionette.Runtime.Core.MathCore
{
    // A 2x3 affine as a value type of six doubles, denoting the matrix
    //
    //     [ a  c  tx ]
    //     [ b  d  ty ]
    //     [ 0  0  1  ]
    //
    // in column vector form, so TransformPoint(m, x, y) = (a*x + c*y + tx, b*x + d*y + ty). This is the
    // exact cross runtime layout of packages/runtime-core/src/math/affine.ts (a readonly tuple there);
    // a struct here allocates nothing on the tuple path. World composition is child.world =
    // parent.world * child.local, and a bone's local matrix is Translate * Rotate * Shear * Scale.
    public readonly struct Mat2x3
    {
        public readonly double A;
        public readonly double B;
        public readonly double C;
        public readonly double D;
        public readonly double Tx;
        public readonly double Ty;

        public Mat2x3(double a, double b, double c, double d, double tx, double ty)
        {
            A = a;
            B = b;
            C = c;
            D = d;
            Tx = tx;
            Ty = ty;
        }
    }

    public readonly struct DecomposedTransform
    {
        public readonly double X;
        public readonly double Y;
        public readonly double RotationDeg;
        public readonly double ScaleX;
        public readonly double ScaleY;
        public readonly double ShearXDeg;
        public readonly double ShearYDeg;

        public DecomposedTransform(
            double x,
            double y,
            double rotationDeg,
            double scaleX,
            double scaleY,
            double shearXDeg,
            double shearYDeg)
        {
            X = x;
            Y = y;
            RotationDeg = rotationDeg;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearXDeg = shearXDeg;
            ShearYDeg = shearYDeg;
        }
    }

    public static class Affine
    {
        // The number of f64 lanes one matrix occupies in a packed double[] (the Pose storage stride).
        public const int Mat2x3Stride = 6;

        public const double DegToRad = Math.PI / 180.0;
        public const double RadToDeg = 180.0 / Math.PI;

        public static Mat2x3 Identity() => new Mat2x3(1, 0, 0, 1, 0, 0);

        // The product parent * child (apply child first, then parent). The world composition op.
        public static Mat2x3 Multiply(in Mat2x3 parent, in Mat2x3 child)
        {
            return new Mat2x3(
                (parent.A * child.A) + (parent.C * child.B),
                (parent.B * child.A) + (parent.D * child.B),
                (parent.A * child.C) + (parent.C * child.D),
                (parent.B * child.C) + (parent.D * child.D),
                (parent.A * child.Tx) + (parent.C * child.Ty) + parent.Tx,
                (parent.B * child.Tx) + (parent.D * child.Ty) + parent.Ty);
        }

        // Build a local matrix from a bone's setup transform: Translate * Rotate * Shear * Scale.
        public static Mat2x3 Compose(
            double x,
            double y,
            double rotationDeg,
            double scaleX,
            double scaleY,
            double shearXDeg,
            double shearYDeg)
        {
            double rotation = rotationDeg * DegToRad;
            double cos = Math.Cos(rotation);
            double sin = Math.Sin(rotation);
            double tanShearX = Math.Tan(shearXDeg * DegToRad);
            double tanShearY = Math.Tan(shearYDeg * DegToRad);
            return new Mat2x3(
                (cos - (sin * tanShearY)) * scaleX,
                (sin + (cos * tanShearY)) * scaleX,
                ((cos * tanShearX) - sin) * scaleY,
                ((sin * tanShearX) + cos) * scaleY,
                x,
                y);
        }

        public static void TransformPoint(in Mat2x3 m, double x, double y, out double outX, out double outY)
        {
            outX = (m.A * x) + (m.C * y) + m.Tx;
            outY = (m.B * x) + (m.D * y) + m.Ty;
        }

        // The inverse affine. Defined when the determinant a*d - b*c is non zero.
        public static Mat2x3 Invert(in Mat2x3 m)
        {
            double det = (m.A * m.D) - (m.B * m.C);
            double inverseDet = 1.0 / det;
            double ia = m.D * inverseDet;
            double ib = -m.B * inverseDet;
            double ic = -m.C * inverseDet;
            double id = m.A * inverseDet;
            return new Mat2x3(
                ia,
                ib,
                ic,
                id,
                -((ia * m.Tx) + (ic * m.Ty)),
                -((ib * m.Tx) + (id * m.Ty)));
        }

        // Decompose a 2x3 affine into the bone transform Compose rebuilds EXACTLY. The TRS plus shear
        // parameterization has one redundant degree of freedom, resolved by the convention shearY = 0.
        public static DecomposedTransform Decompose(in Mat2x3 m)
        {
            double a = m.A;
            double b = m.B;
            double c = m.C;
            double d = m.D;
            double scaleX = Hypot(a, b);
            double xAxisAngle = Math.Atan2(b, a);
            double yAxisAngle = Math.Atan2(d, c);
            double shearX = xAxisAngle + (Math.PI / 2.0) - yAxisAngle;
            double scaleY = Hypot(c, d) * Math.Cos(shearX);
            return new DecomposedTransform(
                m.Tx,
                m.Ty,
                xAxisAngle * RadToDeg,
                scaleX,
                scaleY,
                shearX * RadToDeg,
                0);
        }

        // sqrt(a*a + b*b). The TS oracle calls Math.hypot; over rig magnitudes the difference from this
        // form is far below the A.5 tolerance band, so this is the faithful, portable equivalent.
        public static double Hypot(double a, double b) => Math.Sqrt((a * a) + (b * b));

        // Allocation free hot path operations on packed double[] storage. Offsets address the first lane
        // of a matrix; callers pass in bounds offsets, so the reads never leave the buffer.

        // Write Translate * Rotate * Shear * Scale into buffer[offset .. offset + 5]. Mirrors Compose.
        public static void ComposeInto(
            double[] buffer,
            int offset,
            double x,
            double y,
            double rotationDeg,
            double scaleX,
            double scaleY,
            double shearXDeg,
            double shearYDeg)
        {
            double rotation = rotationDeg * DegToRad;
            double cos = Math.Cos(rotation);
            double sin = Math.Sin(rotation);
            double tanShearX = Math.Tan(shearXDeg * DegToRad);
            double tanShearY = Math.Tan(shearYDeg * DegToRad);
            buffer[offset] = (cos - (sin * tanShearY)) * scaleX;
            buffer[offset + 1] = (sin + (cos * tanShearY)) * scaleX;
            buffer[offset + 2] = ((cos * tanShearX) - sin) * scaleY;
            buffer[offset + 3] = ((sin * tanShearX) + cos) * scaleY;
            buffer[offset + 4] = x;
            buffer[offset + 5] = y;
        }

        // Write parent * child into outBuffer[outOffset ..]. outBuffer must alias neither operand slice.
        public static void MultiplyInto(
            double[] outBuffer,
            int outOffset,
            double[] parent,
            int parentOffset,
            double[] child,
            int childOffset)
        {
            double pa = parent[parentOffset];
            double pb = parent[parentOffset + 1];
            double pc = parent[parentOffset + 2];
            double pd = parent[parentOffset + 3];
            double ptx = parent[parentOffset + 4];
            double pty = parent[parentOffset + 5];
            double ca = child[childOffset];
            double cb = child[childOffset + 1];
            double cc = child[childOffset + 2];
            double cd = child[childOffset + 3];
            double ctx = child[childOffset + 4];
            double cty = child[childOffset + 5];
            outBuffer[outOffset] = (pa * ca) + (pc * cb);
            outBuffer[outOffset + 1] = (pb * ca) + (pd * cb);
            outBuffer[outOffset + 2] = (pa * cc) + (pc * cd);
            outBuffer[outOffset + 3] = (pb * cc) + (pd * cd);
            outBuffer[outOffset + 4] = (pa * ctx) + (pc * cty) + ptx;
            outBuffer[outOffset + 5] = (pb * ctx) + (pd * cty) + pty;
        }

        // Copy one matrix slice from src[srcOffset ..] into outBuffer[outOffset ..] without allocating.
        public static void CopyInto(double[] outBuffer, int outOffset, double[] src, int srcOffset)
        {
            outBuffer[outOffset] = src[srcOffset];
            outBuffer[outOffset + 1] = src[srcOffset + 1];
            outBuffer[outOffset + 2] = src[srcOffset + 2];
            outBuffer[outOffset + 3] = src[srcOffset + 3];
            outBuffer[outOffset + 4] = src[srcOffset + 4];
            outBuffer[outOffset + 5] = src[srcOffset + 5];
        }

        // Read a matrix slice out of packed storage as a value type (for the tuple style call sites).
        public static Mat2x3 Read(double[] buffer, int offset) =>
            new Mat2x3(
                buffer[offset],
                buffer[offset + 1],
                buffer[offset + 2],
                buffer[offset + 3],
                buffer[offset + 4],
                buffer[offset + 5]);

        // Write a value type matrix into packed storage.
        public static void Write(double[] buffer, int offset, in Mat2x3 m)
        {
            buffer[offset] = m.A;
            buffer[offset + 1] = m.B;
            buffer[offset + 2] = m.C;
            buffer[offset + 3] = m.D;
            buffer[offset + 4] = m.Tx;
            buffer[offset + 5] = m.Ty;
        }
    }
}
