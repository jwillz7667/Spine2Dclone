namespace Marionette.Runtime.Core.Solve
{
    // The per channel mix of a transform constraint (mirrors the TransformMix interface in
    // packages/runtime-core/src/solve/transform-constraint.ts). Mutable: step 2 blends the sampled mix in
    // place on pose owned scratch, so the per frame solve allocates none. Degrees for rotate and shearY.
    public sealed class TransformMix
    {
        public double Rotate;
        public double X;
        public double Y;
        public double ScaleX;
        public double ScaleY;
        public double ShearY;

        public TransformMix(double rotate, double x, double y, double scaleX, double scaleY, double shearY)
        {
            Rotate = rotate;
            X = x;
            Y = y;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearY = shearY;
        }

        public void CopyFrom(TransformMix source)
        {
            Rotate = source.Rotate;
            X = source.X;
            Y = source.Y;
            ScaleX = source.ScaleX;
            ScaleY = source.ScaleY;
            ShearY = source.ShearY;
        }
    }

    // The per channel offset of a transform constraint (degrees for rotation and shearY). Immutable: set
    // once at build time from the constraint definition.
    public sealed class TransformOffset
    {
        public double Rotation { get; }
        public double X { get; }
        public double Y { get; }
        public double ScaleX { get; }
        public double ScaleY { get; }
        public double ShearY { get; }

        public TransformOffset(
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
}
