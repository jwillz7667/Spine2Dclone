using System;
using System.Collections.Generic;

namespace Marionette.Runtime.View
{
    // One render batch: a maximal run of consecutive draw items (in draw order) that share a blend mode AND
    // an atlas page, flattened into contiguous vertex/uv/color/index buffers a host uploads as one mesh (one
    // draw call). Because a batch never spans a blend-mode change and the runs stay in draw order, the batch
    // sequence preserves both the painter's-order semantics (solve-order step 6) and the per-slot blend
    // semantics. All buffers are POOLED: they grow to the busiest batch seen and never shrink, so a host that
    // reuses a RenderBatchSet across frames allocates nothing in steady state.
    public sealed class RenderBatch
    {
        // The blend mode every item in this batch shares.
        public string Blend { get; internal set; } = "normal";

        // The atlas page file every item samples, or null for the untextured (white) run.
        public string? PageFile { get; internal set; }

        // True when ANY item in the batch carried a two-color dark tint; then DarkColors is meaningful.
        public bool HasDark { get; internal set; }

        public int VertexCount { get; internal set; }
        public int IndexCount { get; internal set; }

        // 2 lanes per vertex (world x, y).
        public double[] Positions { get; internal set; } = Array.Empty<double>();

        // 2 lanes per vertex (page-normalized u, v, top-left origin).
        public double[] Uvs { get; internal set; } = Array.Empty<double>();

        // 4 lanes per vertex: the LIGHT tint rgb and the resolved alpha, straight (not premultiplied).
        public double[] Colors { get; internal set; } = Array.Empty<double>();

        // 4 lanes per vertex: the two-color DARK tint rgb (alpha inert, 1). Only meaningful when HasDark.
        public double[] DarkColors { get; internal set; } = Array.Empty<double>();

        // Triangle indices into this batch's vertex buffer (already offset per appended item).
        public int[] Indices { get; internal set; } = Array.Empty<int>();

        internal void Begin(string blend, string? pageFile)
        {
            Blend = blend;
            PageFile = pageFile;
            HasDark = false;
            VertexCount = 0;
            IndexCount = 0;
        }

        internal void EnsureCapacity(int addVertices, int addIndices)
        {
            int neededVertices = VertexCount + addVertices;
            int neededIndices = IndexCount + addIndices;
            if (Positions.Length < neededVertices * 2)
            {
                Positions = Grow(Positions, neededVertices * 2);
                Uvs = Grow(Uvs, neededVertices * 2);
            }

            if (Colors.Length < neededVertices * 4)
            {
                Colors = Grow(Colors, neededVertices * 4);
                DarkColors = Grow(DarkColors, neededVertices * 4);
            }

            if (Indices.Length < neededIndices)
            {
                Indices = Grow(Indices, neededIndices);
            }
        }

        private static double[] Grow(double[] existing, int minimum)
        {
            int size = Math.Max(minimum, existing.Length * 2);
            var next = new double[size];
            Array.Copy(existing, next, existing.Length);
            return next;
        }

        private static int[] Grow(int[] existing, int minimum)
        {
            int size = Math.Max(minimum, existing.Length * 2);
            var next = new int[size];
            Array.Copy(existing, next, existing.Length);
            return next;
        }
    }

    // A reusable set of render batches produced from one frame's draw items. Count is the number of live
    // batches (indices [0, Count) are valid, in draw order); the underlying batch objects and their buffers
    // are pooled across frames.
    public sealed class RenderBatchSet
    {
        private readonly List<RenderBatch> _pool = new List<RenderBatch>();

        public int Count { get; private set; }

        public RenderBatch this[int index] => _pool[index];

        internal void Reset()
        {
            Count = 0;
        }

        internal RenderBatch NextBatch(string blend, string? pageFile)
        {
            if (Count == _pool.Count)
            {
                _pool.Add(new RenderBatch());
            }

            RenderBatch batch = _pool[Count];
            Count += 1;
            batch.Begin(blend, pageFile);
            return batch;
        }
    }

    // Flattens a SkeletonDrawList (draw items in draw order) into pooled RenderBatches by grouping maximal
    // consecutive runs of the same (blend mode, atlas page). This is the buffer-building, draw-order
    // batching, blend-mode grouping, and vertex assembly the host engine's mesh upload consumes. Pure and
    // engine-agnostic, so it is covered by the headless conformance tests; the Unity MonoBehaviour and the
    // Godot Node2D only upload the result.
    public static class MeshBufferAssembler
    {
        // Two batch keys merge iff both the blend mode and the atlas page match (a null page, the white
        // fallback, merges only with another null page).
        private static bool SameKey(RenderBatch batch, DrawItem item) =>
            batch.Blend == item.Blend && batch.PageFile == item.PageFile;

        public static void Assemble(SkeletonDrawList items, RenderBatchSet outBatches)
        {
            outBatches.Reset();
            RenderBatch? current = null;

            for (int i = 0; i < items.Count; i += 1)
            {
                DrawItem item = items[i];
                if (item.VertexCount == 0 || item.TriangleIndexCount == 0)
                {
                    continue;
                }

                if (current == null || !SameKey(current, item))
                {
                    current = outBatches.NextBatch(item.Blend, item.PageFile);
                }

                Append(current, item);
            }
        }

        private static void Append(RenderBatch batch, DrawItem item)
        {
            int vertexCount = item.VertexCount;
            int indexCount = item.TriangleIndexCount;
            batch.EnsureCapacity(vertexCount, indexCount);

            int vertexBase = batch.VertexCount;
            double[] positions = batch.Positions;
            double[] uvs = batch.Uvs;
            double[] colors = batch.Colors;
            double[] darkColors = batch.DarkColors;
            RenderColor tint = item.Tint;
            double alpha = item.Alpha;
            bool itemHasDark = item.Dark != null;
            RenderColor dark = item.Dark ?? new RenderColor(0, 0, 0, 1);
            if (itemHasDark)
            {
                batch.HasDark = true;
            }

            for (int v = 0; v < vertexCount; v += 1)
            {
                int p = (vertexBase + v) * 2;
                positions[p] = item.WorldPositions[v * 2];
                positions[p + 1] = item.WorldPositions[(v * 2) + 1];
                uvs[p] = item.PageUvs[v * 2];
                uvs[p + 1] = item.PageUvs[(v * 2) + 1];

                int c = (vertexBase + v) * 4;
                colors[c] = tint.R;
                colors[c + 1] = tint.G;
                colors[c + 2] = tint.B;
                colors[c + 3] = alpha;
                darkColors[c] = dark.R;
                darkColors[c + 1] = dark.G;
                darkColors[c + 2] = dark.B;
                darkColors[c + 3] = 1;
            }

            int[] indices = batch.Indices;
            int indexBase = batch.IndexCount;
            for (int t = 0; t < indexCount; t += 1)
            {
                indices[indexBase + t] = vertexBase + item.Triangles[t];
            }

            batch.VertexCount = vertexBase + vertexCount;
            batch.IndexCount = indexBase + indexCount;
        }
    }
}
