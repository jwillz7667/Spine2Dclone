namespace Marionette.Runtime.Core.Solve
{
    // Scalar helpers shared by the constraint solvers (mirrors packages/runtime-core/src/solve/scalar.ts).
    // Deterministic (no clock, no random): platform agnostic solve math.
    internal static class Scalar
    {
        public const double DegToRad = System.Math.PI / 180.0;
        public const double RadToDeg = 180.0 / System.Math.PI;

        public static double Clamp(double value, double min, double max) =>
            value < min ? min : value > max ? max : value;

        public static double Lerp(double from, double to, double t) => from + ((to - from) * t);

        // Wrap a degree delta into (-180, 180] so an angular blend always takes the short way around.
        public static double WrapDegrees(double deg)
        {
            double wrapped = deg % 360.0;
            if (wrapped > 180.0)
            {
                wrapped -= 360.0;
            }
            else if (wrapped <= -180.0)
            {
                wrapped += 360.0;
            }

            return wrapped;
        }
    }
}
