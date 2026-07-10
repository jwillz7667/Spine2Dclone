using System.Collections.Generic;

namespace Marionette.Runtime.View
{
    // A UV point on an atlas page, normalized to [0, 1] with the TOP-LEFT as the origin (the atlas pixel
    // convention: u to the right, v downward). A host engine whose texture origin is bottom-left flips v
    // (1 - V) when uploading; keeping this layer engine-neutral means the mapping stays byte-comparable with
    // the render-preview oracle.
    public readonly struct PageUv
    {
        public readonly double U;
        public readonly double V;

        public PageUv(double u, double v)
        {
            U = u;
            V = v;
        }
    }

    // The atlas trim of a region: the packed (trimmed) content window (W x H) sits at (OffsetX, OffsetY)
    // inside the ORIGINAL untrimmed image (OriginalW x OriginalH). A trimmed region must render exactly where
    // its untrimmed original would, so RegionGeometry offsets the quad by this. Mirrors RegionTrim in
    // render-preview/geometry.ts.
    public readonly struct RegionTrim
    {
        public readonly double OffsetX;
        public readonly double OffsetY;
        public readonly double W;
        public readonly double H;
        public readonly double OriginalW;
        public readonly double OriginalH;

        public RegionTrim(double offsetX, double offsetY, double w, double h, double originalW, double originalH)
        {
            OffsetX = offsetX;
            OffsetY = offsetY;
            W = w;
            H = h;
            OriginalW = originalW;
            OriginalH = originalH;
        }
    }

    // Resolves an attachment path (== AtlasRegion.Name) to its page and pixel window, and maps a logical
    // attachment UV [0, 1] over the region's texture window into a page-normalized UV. Mirrors the
    // render-preview AtlasIndex (resolve / regionTrim / regionSize) and the RegionSampler's rotated-window
    // mapping, so a region packed rotated 90 degrees clockwise samples identically in every runtime. Pure
    // (no engine, no file IO): built once from the document atlas and reused per frame.
    public sealed class AtlasIndex
    {
        private readonly struct Entry
        {
            public readonly AtlasRegion Region;
            public readonly AtlasPage Page;

            public Entry(AtlasRegion region, AtlasPage page)
            {
                Region = region;
                Page = page;
            }
        }

        private readonly Dictionary<string, Entry> _byName = new Dictionary<string, Entry>();

        public AtlasIndex(AtlasData atlas)
        {
            foreach (AtlasPage page in atlas.Pages)
            {
                foreach (AtlasRegion region in page.Regions)
                {
                    // Region names are unique across pages (format invariant ATLAS_REGION_DUPLICATE); a last
                    // write on a malformed duplicate is harmless because validation rejects it upstream.
                    _byName[region.Name] = new Entry(region, page);
                }
            }
        }

        // Whether the atlas resolves the given region name. A false result means the renderer draws the
        // attachment as an untextured (white) quad, exactly the runtime-web / render-preview fallback.
        public bool HasRegion(string path) => _byName.ContainsKey(path);

        // The page image file the region lives on, or null when the region is not in the atlas. A batch of
        // draw items sharing this key can share one page texture and thus one draw call.
        public string? PageFile(string path) =>
            _byName.TryGetValue(path, out Entry entry) ? entry.Page.File : null;

        // The atlas trim of a region, or null when the region is absent (then placement uses the full
        // centered quad). Mirrors render-preview AtlasIndex.regionTrim.
        public RegionTrim? Trim(string path)
        {
            if (!_byName.TryGetValue(path, out Entry entry))
            {
                return null;
            }

            AtlasRegion r = entry.Region;
            return new RegionTrim(r.OffsetX, r.OffsetY, r.W, r.H, r.OriginalW, r.OriginalH);
        }

        // Map a logical attachment UV (u, v) in [0, 1] over the region's texture window into a
        // page-normalized UV, accounting for the region's page rectangle and rotated packing. When the
        // region is absent the identity (u, v) is returned, so an untextured quad still carries sane UVs for
        // the white fallback. The rotated mapping mirrors RegionSampler: logical (u, v) maps to stored
        // (1 - v, u) for a region packed 90 degrees clockwise; unrotated is the identity.
        public PageUv MapUv(string path, double u, double v)
        {
            if (!_byName.TryGetValue(path, out Entry entry))
            {
                return new PageUv(u, v);
            }

            AtlasRegion r = entry.Region;
            double storedW = r.Rotated ? r.H : r.W;
            double storedH = r.Rotated ? r.W : r.H;
            double su = r.Rotated ? 1 - v : u;
            double sv = r.Rotated ? u : v;
            double px = r.X + (su * storedW);
            double py = r.Y + (sv * storedH);
            return new PageUv(px / entry.Page.Width, py / entry.Page.Height);
        }
    }
}
