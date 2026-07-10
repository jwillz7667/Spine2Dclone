using System.Collections.Generic;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.View;
using Xunit;

namespace Marionette.Runtime.Core.Tests
{
    // Focused unit checks for the engine-agnostic view geometry: region-quad world placement (RegionGeometry)
    // and atlas UV window mapping (AtlasIndex), including the atlas trim offset and the rotated-region uv
    // mapping. These are the render-preview parity primitives ported to C#; the numbers are derived by hand
    // so a drift in the port fails here rather than only in a whole-frame comparison.
    public sealed class ViewGeometryTests
    {
        private static readonly RenderColor White = RenderColor.White;

        [Fact]
        public void RegionWorldCornersOfAnIdentityQuadAreTheCenteredWidthByHeightRectangle()
        {
            var region = new RenderRegion("r", 0, 0, 0, 1, 1, 2, 2, White);
            var boneWorld = new Mat2x3(1, 0, 0, 1, 0, 0);
            var output = new double[8];

            RegionGeometry.RegionWorldCorners(boneWorld, region, null, output);

            // Unit corners (-/+0.5) scaled by width=height=2: (-1,-1), (1,-1), (1,1), (-1,1).
            Assert.Equal(new double[] { -1, -1, 1, -1, 1, 1, -1, 1 }, output);
        }

        [Fact]
        public void RegionWorldCornersRespectTheBoneWorldTranslationAndScale()
        {
            var region = new RenderRegion("r", 0, 0, 0, 1, 1, 2, 2, White);
            // Bone world: scale 3 in x, 1 in y, translated to (10, 5).
            var boneWorld = new Mat2x3(3, 0, 0, 1, 10, 5);
            var output = new double[8];

            RegionGeometry.RegionWorldCorners(boneWorld, region, null, output);

            // Local corners (+/-1 in x, +/-1 in y) times the bone world: x scaled by 3 then +10, y +5.
            Assert.Equal(new double[] { 7, 4, 13, 4, 13, 6, 7, 6 }, output);
        }

        [Fact]
        public void AFullNoOpTrimYieldsTheSameQuadAsNoTrim()
        {
            var region = new RenderRegion("r", 0, 0, 0, 1, 1, 2, 2, White);
            var boneWorld = new Mat2x3(1, 0, 0, 1, 0, 0);
            var untrimmed = new double[8];
            var trimmed = new double[8];

            RegionGeometry.RegionWorldCorners(boneWorld, region, null, untrimmed);
            // offset 0, packed == original: the trimmed corners fall EXACTLY on +/-0.5 with no drift.
            RegionGeometry.RegionWorldCorners(boneWorld, region, new RegionTrim(0, 0, 2, 2, 2, 2), trimmed);

            Assert.Equal(untrimmed, trimmed);
        }

        [Fact]
        public void APartialTrimOffsetsTheQuadIntoTheContentSubRectangle()
        {
            var region = new RenderRegion("r", 0, 0, 0, 1, 1, 2, 2, White);
            var boneWorld = new Mat2x3(1, 0, 0, 1, 0, 0);
            var output = new double[8];

            // Content window w=1 at offsetX=1 inside originalW=2: unit x maps to [-0.5+1/2, -0.5+2/2] = [0, 0.5].
            // Full height (offsetY 0, h=2, originalH=2): unit y stays [-0.5, 0.5]. Sized by width=height=2.
            RegionGeometry.RegionWorldCorners(boneWorld, region, new RegionTrim(1, 0, 1, 2, 2, 2), output);

            Assert.Equal(new double[] { 0, -1, 1, -1, 1, 1, 0, 1 }, output);
        }

        [Fact]
        public void AtlasMapsUnrotatedRegionUvIntoTheNormalizedPageWindow()
        {
            AtlasIndex atlas = MakeAtlas("r", 10, 20, 30, 40, false, 100, 200);

            PageUv topLeft = atlas.MapUv("r", 0, 0);
            PageUv bottomRight = atlas.MapUv("r", 1, 1);

            Assert.Equal(0.1, topLeft.U, 12);
            Assert.Equal(0.1, topLeft.V, 12);
            Assert.Equal(0.4, bottomRight.U, 12);
            Assert.Equal(0.3, bottomRight.V, 12);
        }

        [Fact]
        public void AtlasMapsRotatedRegionUvThroughTheTurnedWindow()
        {
            // Rotated: the stored page rectangle is (h x w) = (40 x 30); logical (u, v) maps to stored (1-v, u).
            AtlasIndex atlas = MakeAtlas("r", 10, 20, 30, 40, true, 100, 200);

            // (u=0, v=0) -> stored (1, 0): px = 10 + 1*40 = 50, py = 20 + 0*30 = 20 -> (0.5, 0.1).
            PageUv uv = atlas.MapUv("r", 0, 0);

            Assert.Equal(0.5, uv.U, 12);
            Assert.Equal(0.1, uv.V, 12);
        }

        [Fact]
        public void AnUnknownRegionMapsToIdentityUvAndResolvesNoPage()
        {
            AtlasIndex atlas = MakeAtlas("r", 10, 20, 30, 40, false, 100, 200);

            PageUv uv = atlas.MapUv("missing", 0.25, 0.75);

            Assert.False(atlas.HasRegion("missing"));
            Assert.Null(atlas.PageFile("missing"));
            Assert.Equal(0.25, uv.U, 12);
            Assert.Equal(0.75, uv.V, 12);
        }

        private static AtlasIndex MakeAtlas(
            string name,
            double x,
            double y,
            double w,
            double h,
            bool rotated,
            double pageWidth,
            double pageHeight)
        {
            var region = new AtlasRegion(name, x, y, w, h, rotated, 0, 0, w, h);
            var page = new AtlasPage("page.png", pageWidth, pageHeight, new List<AtlasRegion> { region });
            return new AtlasIndex(new AtlasData(new List<AtlasPage> { page }));
        }
    }
}
