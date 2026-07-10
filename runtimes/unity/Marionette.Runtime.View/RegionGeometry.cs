using Marionette.Runtime.Core.MathCore;

namespace Marionette.Runtime.View
{
    // Region-quad world geometry, mirroring render-preview/geometry.ts (which itself reproduces runtime-web's
    // region-placement.ts computeRegionSized / placeRegion). The world quad is texture-size-independent by
    // construction: boneWorld * (attachmentLocal * scale(width, height)) applied to a unit-centered quad. A
    // trimmed region's quad is offset so a trimmed texture lands where the untrimmed original would. This is
    // the placement parity primitive: same bone world times the same sized-local matrix in every runtime.
    public static class RegionGeometry
    {
        // The four corners of the unit-centered quad, in the order that pairs with QuadUvs [0,0, 1,0, 1,1,
        // 0,1]: top-left, top-right, bottom-right, bottom-left in the attachment local frame. Triangulated as
        // [0, 1, 2, 0, 2, 3].
        private static readonly double[] UnitQuadCornersX = { -0.5, 0.5, 0.5, -0.5 };
        private static readonly double[] UnitQuadCornersY = { -0.5, -0.5, 0.5, 0.5 };

        // The region UVs matching the four corners (normalized over the region's texture window).
        public static readonly double[] QuadUvs = { 0, 0, 1, 0, 1, 1, 0, 1 };

        // The region quad's two triangles (indices into the four corners).
        public static readonly int[] QuadTriangles = { 0, 1, 2, 0, 2, 3 };

        // The constant part of a region's placement: attachmentLocal * scale(width, height), where
        // attachmentLocal = compose(x, y, rotation, scaleX, scaleY) is the attachment's offset in bone-local
        // space. The size scale is innermost so the unit-centered quad becomes a width-by-height quad in
        // attachment-local axes BEFORE the attachment offset and the bone world transform apply. Verbatim
        // reproduction of geometry.ts regionSizedLocal.
        public static Mat2x3 RegionSizedLocal(RenderRegion region)
        {
            Mat2x3 attachmentLocal = Affine.Compose(
                region.X,
                region.Y,
                region.Rotation,
                region.ScaleX,
                region.ScaleY,
                0,
                0);
            var size = new Mat2x3(region.Width, 0, 0, region.Height, 0, 0);
            return Affine.Multiply(attachmentLocal, size);
        }

        // Write the four world-space corners of a region attachment into output (8 lanes, x/y per corner in
        // the QuadUvs order): transform the (trim-adjusted) unit-quad corners by boneWorld *
        // RegionSizedLocal(region). trim (from the region's AtlasRegion) offsets the quad so a trimmed
        // texture lands where the untrimmed original would; pass null for an untrimmed region or a region
        // with no atlas entry, which yields the full centered quad EXACTLY (integer 0/original and
        // original/original fall on +/- 0.5 with no floating-point drift). output must hold >= 8 lanes.
        public static void RegionWorldCorners(in Mat2x3 boneWorld, RenderRegion region, RegionTrim? trim, double[] output)
        {
            Mat2x3 world = Affine.Multiply(boneWorld, RegionSizedLocal(region));
            for (int corner = 0; corner < 4; corner += 1)
            {
                double cx = UnitQuadCornersX[corner];
                double cy = UnitQuadCornersY[corner];
                if (trim != null)
                {
                    RegionTrim t = trim.Value;
                    // Map the +/- 0.5 corner into the content sub-rectangle expressed as a fraction of the
                    // ORIGINAL image: an original-image coordinate p maps to unit coordinate -0.5 + p/original.
                    double left = -0.5 + (t.OffsetX / t.OriginalW);
                    double right = -0.5 + ((t.OffsetX + t.W) / t.OriginalW);
                    double top = -0.5 + (t.OffsetY / t.OriginalH);
                    double bottom = -0.5 + ((t.OffsetY + t.H) / t.OriginalH);
                    cx = corner == 0 || corner == 3 ? left : right;
                    cy = corner == 0 || corner == 1 ? top : bottom;
                }

                Affine.TransformPoint(world, cx, cy, out double outX, out double outY);
                output[corner * 2] = outX;
                output[(corner * 2) + 1] = outY;
            }
        }
    }
}
