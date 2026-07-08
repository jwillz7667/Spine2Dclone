using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // Focused unit checks on the ported primitives, independent of the fixtures: they pin the exact
    // inverse relationships the solve relies on, so a decomposition or bezier bracket bug surfaces here
    // with a small readable failure rather than only as a fixture drift.
    public sealed class MathTests
    {
        [Fact]
        public void Decompose_is_the_exact_inverse_of_Compose()
        {
            Mat2x3 m = Affine.Compose(12.5, -7.25, 33.0, 1.4, 0.8, 10.0, 0.0);
            DecomposedTransform d = Affine.Decompose(m);
            Mat2x3 rebuilt = Affine.Compose(d.X, d.Y, d.RotationDeg, d.ScaleX, d.ScaleY, d.ShearXDeg, d.ShearYDeg);

            Assert.Equal(m.A, rebuilt.A, 12);
            Assert.Equal(m.B, rebuilt.B, 12);
            Assert.Equal(m.C, rebuilt.C, 12);
            Assert.Equal(m.D, rebuilt.D, 12);
            Assert.Equal(m.Tx, rebuilt.Tx, 12);
            Assert.Equal(m.Ty, rebuilt.Ty, 12);
        }

        [Fact]
        public void Multiply_then_invert_returns_identity()
        {
            Mat2x3 a = Affine.Compose(3, 4, 25, 1.2, 0.9, 0, 0);
            Mat2x3 product = Affine.Multiply(a, Affine.Invert(a));

            Assert.Equal(1.0, product.A, 12);
            Assert.Equal(0.0, product.B, 12);
            Assert.Equal(0.0, product.C, 12);
            Assert.Equal(1.0, product.D, 12);
            Assert.Equal(0.0, product.Tx, 12);
            Assert.Equal(0.0, product.Ty, 12);
        }

        [Fact]
        public void Bezier_table_is_monotonic_in_x_and_spans_the_unit_interval()
        {
            double[] table = Curves.BuildBezierTable(0.7, 0.0, 0.9, 0.15);

            Assert.Equal(0.0, table[0], 12);
            Assert.Equal(0.0, table[1], 12);
            Assert.Equal(1.0, table[table.Length - 2], 12);
            Assert.Equal(1.0, table[table.Length - 1], 12);

            double previousX = double.NegativeInfinity;
            for (int i = 0; i < table.Length; i += 2)
            {
                Assert.True(table[i] >= previousX);
                previousX = table[i];
            }

            // The eased y at the midpoint x sits below the linear diagonal for this ease in curve.
            double y = Curves.EvalBezierY(table, 0, 0.5);
            Assert.True(y >= 0.0 && y <= 0.5);
        }
    }
}
