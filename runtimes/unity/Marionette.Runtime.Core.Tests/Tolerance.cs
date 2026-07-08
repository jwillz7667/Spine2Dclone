using System;

namespace Marionette.Runtime.Core.Tests
{
    // The A.5 tolerance policy, ported verbatim from packages/conformance/src/compare/tolerance.ts. There
    // is no per runtime tolerance and no other epsilon; loosening any value to make this runtime pass is
    // forbidden (the fix is to fix the runtime). A pair matches iff
    //   |actual - expected| <= atol + rtol * max(|actual|, |expected|).
    public readonly struct Tolerance
    {
        public readonly double Atol;
        public readonly double Rtol;

        public Tolerance(double atol, double rtol)
        {
            Atol = atol;
            Rtol = rtol;
        }

        public bool Within(double actual, double expected)
        {
            double diff = Math.Abs(actual - expected);
            return diff <= Atol + (Rtol * Math.Max(Math.Abs(actual), Math.Abs(expected)));
        }
    }

    public static class Tolerances
    {
        // World basis a, b, c, d (rotation/scale/shear, near 1 magnitudes): tight absolute term.
        public static readonly Tolerance WorldBasis = new Tolerance(1e-6, 1e-6);

        // World translation tx, ty (rig units, can be large): the relative term dominates at large coords.
        public static readonly Tolerance WorldTranslation = new Tolerance(1e-4, 1e-6);

        // Skinned and deformed vertex world positions: absolute term near zero, relative term at scale.
        public static readonly Tolerance Vertex = new Tolerance(1e-4, 1e-5);

        // Affine lanes [a, b, c, d, tx, ty]: 0..3 are the basis class, 4..5 the translation class.
        public static Tolerance ForLane(int lane) => lane < 4 ? WorldBasis : WorldTranslation;
    }
}
