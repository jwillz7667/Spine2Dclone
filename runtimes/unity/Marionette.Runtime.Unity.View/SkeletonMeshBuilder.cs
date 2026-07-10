#if UNITY_2021_3_OR_NEWER
using System.Collections.Generic;
using Marionette.Runtime.View;
using UnityEngine;

namespace Marionette.Runtime.Unity.View
{
    // Uploads the engine-agnostic RenderBatchSet (produced by Marionette.Runtime.View.MeshBufferAssembler)
    // into Unity meshes, one child MeshRenderer per batch, pooled across frames. All rendering-idiomatic
    // concerns live here (Vector3/Vector2/Color32 conversion, the top-left to bottom-left UV flip, blend
    // mode to material selection, painter's-order via sortingOrder); the ORDERING and BATCHING decisions were
    // already made by the pure layer, so this class stays a thin, declarative uploader.
    //
    // Pooling: the child GameObjects, their MeshFilter/MeshRenderer, and the per-batch scratch arrays are
    // created once and reused. A batch buffer is reallocated only when a frame needs a larger one than any
    // before (size-keyed), so a steady-state animation of a fixed rig allocates nothing per frame. Unused
    // child renderers are disabled rather than destroyed.
    //
    // This class references UnityEngine and therefore is NOT part of the headless dotnet solution; Unity
    // compiles it. Its inputs (RenderBatch buffers) are produced and tested entirely in the engine-agnostic
    // layer, so the logic that could drift is covered by the xUnit conformance suite; this uploader is
    // verified in-editor.
    public sealed class SkeletonMeshBuilder
    {
        private sealed class BatchRenderer
        {
            public readonly GameObject GameObject;
            public readonly MeshFilter Filter;
            public readonly MeshRenderer Renderer;
            public readonly Mesh Mesh;
            public readonly MaterialPropertyBlock Properties;

            public Vector3[] Positions = System.Array.Empty<Vector3>();
            public Vector2[] Uvs = System.Array.Empty<Vector2>();
            public Color32[] Colors = System.Array.Empty<Color32>();
            public int[] Indices = System.Array.Empty<int>();

            public BatchRenderer(Transform parent, int index)
            {
                GameObject = new GameObject($"MarionetteBatch{index}");
                GameObject.transform.SetParent(parent, false);
                Filter = GameObject.AddComponent<MeshFilter>();
                Renderer = GameObject.AddComponent<MeshRenderer>();
                Mesh = new Mesh { name = $"MarionetteBatch{index}" };
                Mesh.MarkDynamic();
                Filter.sharedMesh = Mesh;
                Properties = new MaterialPropertyBlock();
                Renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                Renderer.receiveShadows = false;
            }
        }

        private static readonly int MainTexId = Shader.PropertyToID("_MainTex");

        private readonly Transform _parent;
        private readonly List<BatchRenderer> _pool = new List<BatchRenderer>();

        public SkeletonMeshBuilder(Transform parent)
        {
            _parent = parent;
        }

        // Upload one frame's batches. materials maps a blend mode name to a Material; pageTextures maps an
        // atlas page file name to its Texture2D (a null or missing entry draws the white fallback via the
        // material's own texture). sortingLayerId / baseSortingOrder place the batches so batch 0 draws behind
        // batch N (painter's order, solve-order step 6).
        public void Upload(
            RenderBatchSet batches,
            IReadOnlyDictionary<string, Material> materials,
            IReadOnlyDictionary<string, Texture2D> pageTextures,
            int sortingLayerId,
            int baseSortingOrder,
            Material fallbackMaterial)
        {
            for (int b = 0; b < batches.Count; b += 1)
            {
                RenderBatch batch = batches[b];
                BatchRenderer target = Rent(b);
                Fill(target, batch);

                Material material = ResolveMaterial(materials, batch.Blend, fallbackMaterial);
                target.Renderer.sharedMaterial = material;

                target.Properties.Clear();
                if (batch.PageFile != null
                    && pageTextures.TryGetValue(batch.PageFile, out Texture2D pageTexture)
                    && pageTexture != null)
                {
                    target.Properties.SetTexture(MainTexId, pageTexture);
                }

                target.Renderer.SetPropertyBlock(target.Properties);
                target.Renderer.sortingLayerID = sortingLayerId;
                target.Renderer.sortingOrder = baseSortingOrder + b;
                target.GameObject.SetActive(true);
            }

            // Disable any renderers left over from a busier previous frame (kept for reuse, not destroyed).
            for (int b = batches.Count; b < _pool.Count; b += 1)
            {
                _pool[b].GameObject.SetActive(false);
            }
        }

        private BatchRenderer Rent(int index)
        {
            while (_pool.Count <= index)
            {
                _pool.Add(new BatchRenderer(_parent, _pool.Count));
            }

            return _pool[index];
        }

        private static Material ResolveMaterial(
            IReadOnlyDictionary<string, Material> materials,
            string blend,
            Material fallbackMaterial)
        {
            if (materials != null && materials.TryGetValue(blend, out Material material) && material != null)
            {
                return material;
            }

            return fallbackMaterial;
        }

        private static void Fill(BatchRenderer target, RenderBatch batch)
        {
            int vertexCount = batch.VertexCount;
            int indexCount = batch.IndexCount;

            if (target.Positions.Length < vertexCount)
            {
                target.Positions = new Vector3[vertexCount];
                target.Uvs = new Vector2[vertexCount];
                target.Colors = new Color32[vertexCount];
            }

            if (target.Indices.Length < indexCount)
            {
                target.Indices = new int[indexCount];
            }

            double[] positions = batch.Positions;
            double[] uvs = batch.Uvs;
            double[] colors = batch.Colors;
            for (int v = 0; v < vertexCount; v += 1)
            {
                target.Positions[v] = new Vector3((float)positions[v * 2], (float)positions[(v * 2) + 1], 0f);
                // Atlas UVs are top-left origin; Unity texture space is bottom-left, so flip v.
                target.Uvs[v] = new Vector2((float)uvs[v * 2], 1f - (float)uvs[(v * 2) + 1]);
                int c = v * 4;
                target.Colors[v] = new Color32(
                    ToByte(colors[c]),
                    ToByte(colors[c + 1]),
                    ToByte(colors[c + 2]),
                    ToByte(colors[c + 3]));
            }

            // Trailing slots in an oversized pooled buffer must not draw; clear the tail indices to a
            // degenerate triangle only when the buffer is longer than the live count.
            System.Array.Copy(batch.Indices, target.Indices, indexCount);
            for (int t = indexCount; t < target.Indices.Length; t += 1)
            {
                target.Indices[t] = 0;
            }

            Mesh mesh = target.Mesh;
            mesh.Clear();
            mesh.SetVertices(target.Positions, 0, vertexCount);
            mesh.SetUVs(0, target.Uvs, 0, vertexCount);
            mesh.SetColors(target.Colors, 0, vertexCount);
            mesh.SetTriangles(target.Indices, 0, indexCount, 0, false);
        }

        private static byte ToByte(double value)
        {
            int scaled = (int)(value * 255.0 + 0.5);
            if (scaled < 0)
            {
                scaled = 0;
            }
            else if (scaled > 255)
            {
                scaled = 255;
            }

            return (byte)scaled;
        }
    }
}
#endif
