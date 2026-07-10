using System;

namespace Marionette.Runtime.View
{
    // One drawable primitive in world space, gathered from a solved pose in DRAW ORDER (solve-order step 6).
    // A region attachment (a quad) and a mesh attachment (a triangle fan/strip) both reduce to this shape, so
    // the buffer assembler and the host engine treat every drawable uniformly. The WORLD positions are the
    // runtime-core solve output verbatim (RegionGeometry corners for regions, MeshSample vertices for
    // meshes), so the view cannot drift from the behavioral oracle. Mirrors render-preview's DrawItem.
    //
    // The item is POOLABLE (the codebase pooling idiom, ADR-0006 / MeshSample.ClipBuffers): its variable
    // buffers grow only when a larger geometry than any before appears (size-keyed), so a host that reuses a
    // SkeletonDrawList across frames allocates nothing in steady state. VertexCount / TriangleIndexCount are
    // the live lengths (the backing arrays may be larger).
    public sealed class DrawItem
    {
        // The document slot index this drawable came from (a positional key, not drawn geometry).
        public int SlotIndex { get; private set; }

        // The render position (index into the draw order) this drawable occupies; 0 is drawn first (behind).
        public int RenderPosition { get; private set; }

        // The live vertex count; WorldPositions / PageUvs hold 2 * VertexCount valid lanes.
        public int VertexCount { get; private set; }

        // The live triangle-index count; Triangles holds this many valid entries.
        public int TriangleIndexCount { get; private set; }

        // Flat world-space vertex positions [x0, y0, x1, y1, ...] (2 * VertexCount valid lanes). Pooled.
        public double[] WorldPositions { get; private set; } = Array.Empty<double>();

        // Flat page-normalized UVs [u0, v0, ...] (top-left origin), one per world vertex, already mapped
        // through the atlas region window (rotation and rectangle folded in) so a host uploads them as is.
        public double[] PageUvs { get; private set; } = Array.Empty<double>();

        // Triangle index triples into the vertex list (TriangleIndexCount valid entries). Pooled.
        public int[] Triangles { get; private set; } = Array.Empty<int>();

        // The LIGHT tint (slot color rgb x attachment color rgb); its alpha lane is inert (Alpha is
        // authoritative). Multiplied into the sampled texel by the host shader.
        public RenderColor Tint { get; private set; }

        // The resolved opacity (slot color alpha x attachment color alpha).
        public double Alpha { get; private set; }

        // The slot's static blend mode ("normal", "additive", "multiply", "screen"). Batches never merge
        // across a blend-mode change, so the draw order and the blend semantics are both preserved.
        public string Blend { get; private set; } = "normal";

        // The two-color DARK tint (rgb; alpha inert), or null when the slot declared no setup darkColor. A
        // host with a two-color shader fills the texel's shadow term from this; the default single-color
        // path ignores it (documented). Mirrors pose.slotDarkColor / slotHasDarkColor.
        public RenderColor? Dark { get; private set; }

        // The resolved atlas region name (the base attachment path, or the sequence-resolved frame name).
        public string RegionPath { get; private set; } = string.Empty;

        // The atlas page image file this drawable samples, or null when the region is unresolved (drawn as a
        // white quad). Drawables sharing a page file and blend mode batch into one draw call.
        public string? PageFile { get; private set; }

        // Ensure the vertex/index buffers hold at least the given capacity, growing (never shrinking) so a
        // steady-state stream of same-or-smaller geometry reuses the arrays. Sets the live counts.
        internal void EnsureCapacity(int vertexCount, int triangleIndexCount)
        {
            if (WorldPositions.Length < vertexCount * 2)
            {
                WorldPositions = new double[vertexCount * 2];
                PageUvs = new double[vertexCount * 2];
            }

            if (Triangles.Length < triangleIndexCount)
            {
                Triangles = new int[triangleIndexCount];
            }

            VertexCount = vertexCount;
            TriangleIndexCount = triangleIndexCount;
        }

        internal void SetMeta(
            int slotIndex,
            int renderPosition,
            RenderColor tint,
            double alpha,
            string blend,
            RenderColor? dark,
            string regionPath,
            string? pageFile)
        {
            SlotIndex = slotIndex;
            RenderPosition = renderPosition;
            Tint = tint;
            Alpha = alpha;
            Blend = blend;
            Dark = dark;
            RegionPath = regionPath;
            PageFile = pageFile;
        }
    }
}
