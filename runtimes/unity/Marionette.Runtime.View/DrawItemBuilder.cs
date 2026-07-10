using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Document;
using Marionette.Runtime.Core.MathCore;
using Marionette.Runtime.Core.Skeleton;

namespace Marionette.Runtime.View
{
    // A reusable, growable list of draw items plus the per-frame vertex scratch, so a host that drives the
    // builder every frame allocates nothing in steady state (the pooling idiom, ADR-0006). Items live in a
    // pool that grows to the busiest frame's drawable count and never shrinks; each item's own buffers grow
    // to its attachment's geometry. Count is the number of live items this frame (indices [0, Count) are
    // valid, in draw order).
    public sealed class SkeletonDrawList
    {
        private readonly List<DrawItem> _pool = new List<DrawItem>();

        // Reusable float scratch for a single mesh's world vertices (2 lanes per vertex), grown on demand.
        internal float[] VertexScratch = Array.Empty<float>();

        public int Count { get; private set; }

        public DrawItem this[int index] => _pool[index];

        internal void Reset()
        {
            Count = 0;
        }

        // Return the next pooled item to fill, growing the pool by one when exhausted. The returned item's
        // buffers are whatever it last held (the caller calls EnsureCapacity before writing).
        internal DrawItem Next()
        {
            if (Count == _pool.Count)
            {
                _pool.Add(new DrawItem());
            }

            DrawItem item = _pool[Count];
            Count += 1;
            return item;
        }

        internal float[] EnsureVertexScratch(int lanes)
        {
            if (VertexScratch.Length < lanes)
            {
                VertexScratch = new float[lanes];
            }

            return VertexScratch;
        }
    }

    // Gathers the world-space draw items from an ALREADY-solved pose, in DRAW ORDER (solve-order step 6),
    // mirroring render-preview's gatherDrawItemsFromPose. It reads the render-only geometry from the
    // RenderModel and the world positions from the solve (RegionGeometry for regions, MeshSample for meshes),
    // so the drawn geometry is the behavioral oracle's output and cannot drift. The caller must have solved
    // the pose to the SAME (animationId, sampleTime) it passes here (Sample.SampleSkeleton for an animated
    // frame, or reset-to-setup for animationId == null).
    public static class DrawItemBuilder
    {
        // The linked-mesh chain is validator-guaranteed acyclic (LINKED_MESH_CYCLE); this bound is a
        // defensive stop for an unvalidated document, mirroring the core solve's lenience.
        private const int MaxLinkedMeshDepth = 256;

        // Turn a resolved integer sequence frame into an atlas region NAME (ADR-0009 section 3): the
        // attachment path concatenated with (start + frameIndex) rendered in base 10 and LEFT-padded with
        // '0' to at least `digits` characters. A number already wider than `digits` is not truncated.
        // Character-for-character the render-preview / runtime-web sequenceRegionName.
        public static string RenderSequenceName(string path, RenderSequence sequence, int frameIndex)
        {
            int value = sequence.Start + frameIndex;
            return path + value.ToString(System.Globalization.CultureInfo.InvariantCulture)
                .PadLeft(sequence.Digits, '0');
        }

        // Convenience: gather into a fresh list (allocates). Simple hosts and the conformance tests use this;
        // a per-frame host uses BuildInto with a reused SkeletonDrawList for zero steady-state allocation.
        public static SkeletonDrawList Build(
            SkeletonDocument document,
            RenderModel renderModel,
            AtlasIndex atlas,
            Pose pose,
            string skinName,
            string? animationId,
            double sampleTime)
        {
            var list = new SkeletonDrawList();
            BuildInto(document, renderModel, atlas, pose, skinName, animationId, sampleTime, list);
            return list;
        }

        // Gather into a reused list (zero steady-state allocation). Clears the list, then appends one draw
        // item per drawable slot in draw order.
        public static void BuildInto(
            SkeletonDocument document,
            RenderModel renderModel,
            AtlasIndex atlas,
            Pose pose,
            string skinName,
            string? animationId,
            double sampleTime,
            SkeletonDrawList outList)
        {
            outList.Reset();
            RenderSkin? skin = renderModel.FindSkin(skinName);
            if (skin == null)
            {
                return;
            }

            for (int position = 0; position < pose.SlotCount; position += 1)
            {
                int slotIndex = pose.DrawOrder[position];
                int boneIndex = pose.SlotBoneIndices[slotIndex];
                if (boneIndex < 0)
                {
                    continue;
                }

                string? activeName = pose.SlotAttachment[slotIndex];
                if (activeName == null)
                {
                    continue;
                }

                Slot slot = document.Slots[slotIndex];
                RenderAttachment? attachment = skin.Find(slot.Name, activeName);
                if (attachment == null || attachment.Kind == RenderAttachmentKind.NonDrawing)
                {
                    continue;
                }

                EmitDrawable(
                    document,
                    renderModel,
                    atlas,
                    pose,
                    skin,
                    skinName,
                    animationId,
                    sampleTime,
                    position,
                    slotIndex,
                    boneIndex,
                    slot,
                    activeName,
                    attachment,
                    outList);
            }
        }

        private static void EmitDrawable(
            SkeletonDocument document,
            RenderModel renderModel,
            AtlasIndex atlas,
            Pose pose,
            RenderSkin skin,
            string skinName,
            string? animationId,
            double sampleTime,
            int renderPosition,
            int slotIndex,
            int boneIndex,
            Slot slot,
            string activeName,
            RenderAttachment attachment,
            SkeletonDrawList outList)
        {
            RenderColor attachmentColor = AttachmentColor(attachment);
            int colorBase = slotIndex * Pose.SlotColorStride;
            double[] slotColor = pose.SlotColor;
            var tint = new RenderColor(
                slotColor[colorBase] * attachmentColor.R,
                slotColor[colorBase + 1] * attachmentColor.G,
                slotColor[colorBase + 2] * attachmentColor.B,
                1);
            double alpha = slotColor[colorBase + 3] * attachmentColor.A;

            RenderColor? dark = null;
            if (pose.SlotHasDarkColor[slotIndex] == 1)
            {
                double[] slotDark = pose.SlotDarkColor;
                dark = new RenderColor(slotDark[colorBase], slotDark[colorBase + 1], slotDark[colorBase + 2], 1);
            }

            string regionPath = ResolveRegionPath(document, pose, animationId, sampleTime, slot.Name, attachment);
            string? pageFile = atlas.PageFile(regionPath);

            DrawItem item = outList.Next();
            item.SetMeta(slotIndex, renderPosition, tint, alpha, slot.BlendMode, dark, regionPath, pageFile);

            if (attachment.Kind == RenderAttachmentKind.Region)
            {
                EmitRegion(pose, atlas, boneIndex, attachment.Region!, regionPath, item);
            }
            else
            {
                EmitMesh(
                    document,
                    renderModel,
                    atlas,
                    pose,
                    skinName,
                    skin,
                    animationId,
                    sampleTime,
                    boneIndex,
                    slotIndex,
                    slot.Name,
                    activeName,
                    attachment,
                    regionPath,
                    item,
                    outList);
            }
        }

        private static void EmitRegion(
            Pose pose,
            AtlasIndex atlas,
            int boneIndex,
            RenderRegion region,
            string regionPath,
            DrawItem item)
        {
            item.EnsureCapacity(4, RegionGeometry.QuadTriangles.Length);
            Mat2x3 boneWorld = Affine.Read(pose.World, boneIndex * Affine.Mat2x3Stride);
            RegionTrim? trim = atlas.Trim(regionPath);
            RegionGeometry.RegionWorldCorners(boneWorld, region, trim, item.WorldPositions);

            double[] quadUvs = RegionGeometry.QuadUvs;
            double[] pageUvs = item.PageUvs;
            for (int corner = 0; corner < 4; corner += 1)
            {
                PageUv uv = atlas.MapUv(regionPath, quadUvs[corner * 2], quadUvs[(corner * 2) + 1]);
                pageUvs[corner * 2] = uv.U;
                pageUvs[(corner * 2) + 1] = uv.V;
            }

            Array.Copy(RegionGeometry.QuadTriangles, item.Triangles, RegionGeometry.QuadTriangles.Length);
        }

        private static void EmitMesh(
            SkeletonDocument document,
            RenderModel renderModel,
            AtlasIndex atlas,
            Pose pose,
            string skinName,
            RenderSkin skin,
            string? animationId,
            double sampleTime,
            int boneIndex,
            int slotIndex,
            string slotName,
            string activeName,
            RenderAttachment attachment,
            string regionPath,
            DrawItem item,
            SkeletonDrawList outList)
        {
            RenderMesh? source = ResolveRenderSourceMesh(renderModel, skin, skinName, slotName, attachment);
            if (source == null)
            {
                // A linked mesh whose parent chain does not resolve to a mesh (a validator rejects this). Emit
                // an empty drawable so the pooled item is well-formed and the render just skips it.
                item.EnsureCapacity(0, 0);
                return;
            }

            int vertexCount = source.Uvs.Length / 2;
            item.EnsureCapacity(vertexCount, source.Triangles.Length);

            float[] scratch = outList.EnsureVertexScratch(vertexCount * 2);
            if (animationId != null)
            {
                MeshSample.SampleMeshVertices(
                    document, animationId, sampleTime, pose, skinName, slotName, activeName, scratch);
            }
            else
            {
                MeshAttachment? coreMesh = ResolveCoreSourceMesh(document, skinName, slotName, activeName);
                if (coreMesh == null)
                {
                    item.EnsureCapacity(0, 0);
                    return;
                }

                MeshSample.SkinMeshInto(coreMesh, pose, boneIndex, scratch);
            }

            double[] worldPositions = item.WorldPositions;
            double[] pageUvs = item.PageUvs;
            for (int v = 0; v < vertexCount; v += 1)
            {
                worldPositions[v * 2] = scratch[v * 2];
                worldPositions[(v * 2) + 1] = scratch[(v * 2) + 1];
                PageUv uv = atlas.MapUv(regionPath, source.Uvs[v * 2], source.Uvs[(v * 2) + 1]);
                pageUvs[v * 2] = uv.U;
                pageUvs[(v * 2) + 1] = uv.V;
            }

            Array.Copy(source.Triangles, item.Triangles, source.Triangles.Length);
        }

        private static RenderColor AttachmentColor(RenderAttachment attachment)
        {
            switch (attachment.Kind)
            {
                case RenderAttachmentKind.Region:
                    return attachment.Region!.Color;
                case RenderAttachmentKind.Mesh:
                    return attachment.Mesh!.Color;
                case RenderAttachmentKind.LinkedMesh:
                    return attachment.LinkedMesh!.Color;
                default:
                    return RenderColor.White;
            }
        }

        private static string AttachmentPath(RenderAttachment attachment)
        {
            switch (attachment.Kind)
            {
                case RenderAttachmentKind.Region:
                    return attachment.Region!.Path;
                case RenderAttachmentKind.Mesh:
                    return attachment.Mesh!.Path;
                case RenderAttachmentKind.LinkedMesh:
                    return attachment.LinkedMesh!.Path;
                default:
                    return string.Empty;
            }
        }

        // Resolve the atlas region NAME to draw: the base attachment path, or, for a sequence attachment, the
        // name of the frame the sequence resolves to (setup frame at setup pose, else the mode-resolved frame
        // from the slot's sequence timeline). Mirrors the sequence branch of gatherDrawItemsFromPose.
        private static string ResolveRegionPath(
            SkeletonDocument document,
            Pose pose,
            string? animationId,
            double sampleTime,
            string slotName,
            RenderAttachment attachment)
        {
            string basePath = AttachmentPath(attachment);
            if (attachment.Sequence == null)
            {
                return basePath;
            }

            RenderSequence sequence = attachment.Sequence.Value;
            int frameIndex = animationId == null
                ? sequence.SetupIndex
                : Sequence.SampleSlotSequenceFrame(document, animationId, sampleTime, pose, slotName);
            return frameIndex >= 0 ? RenderSequenceName(basePath, sequence, frameIndex) : basePath;
        }

        // Resolve a mesh drawable's SOURCE render mesh (uvs/triangles): a plain mesh is itself; a linked mesh
        // walks the parent chain (parent on the same slot in skin `linked.Skin ?? current`) to the root mesh.
        // Mirrors resolveRenderMesh (render-preview) over the render model. Returns null when the chain never
        // reaches a mesh (an unvalidated document).
        private static RenderMesh? ResolveRenderSourceMesh(
            RenderModel renderModel,
            RenderSkin skin,
            string skinName,
            string slotName,
            RenderAttachment attachment)
        {
            if (attachment.Kind == RenderAttachmentKind.Mesh)
            {
                return attachment.Mesh;
            }

            if (attachment.Kind != RenderAttachmentKind.LinkedMesh)
            {
                return null;
            }

            RenderAttachment node = attachment;
            string currentSkin = skinName;
            for (int hop = 0; hop < MaxLinkedMeshDepth; hop += 1)
            {
                if (node.Kind == RenderAttachmentKind.Mesh)
                {
                    return node.Mesh;
                }

                if (node.Kind != RenderAttachmentKind.LinkedMesh)
                {
                    return null;
                }

                RenderLinkedMesh linked = node.LinkedMesh!;
                string parentSkinName = linked.Skin ?? currentSkin;
                RenderSkin? parentSkin = renderModel.FindSkin(parentSkinName);
                RenderAttachment? parent = parentSkin?.Find(slotName, linked.Parent);
                if (parent == null)
                {
                    return null;
                }

                node = parent;
                currentSkin = parentSkinName;
            }

            return null;
        }

        // Resolve the CORE source MeshAttachment (with its weighted/unweighted vertex stream) for the
        // setup-pose skinning path (animationId == null): a plain mesh is itself; a linked mesh walks the core
        // document's parent chain. The animated path never calls this (MeshSample.SampleMeshVertices resolves
        // the chain internally). Returns null when the chain never reaches a mesh.
        private static MeshAttachment? ResolveCoreSourceMesh(
            SkeletonDocument document,
            string skinName,
            string slotName,
            string attachmentName)
        {
            string currentSkin = skinName;
            string currentName = attachmentName;
            for (int hop = 0; hop < MaxLinkedMeshDepth; hop += 1)
            {
                Attachment? attachment = FindCoreAttachment(document, currentSkin, slotName, currentName);
                if (attachment == null)
                {
                    return null;
                }

                if (attachment.Type == "mesh" && attachment.Mesh != null)
                {
                    return attachment.Mesh;
                }

                if (attachment.Type != "linkedmesh" || attachment.Linked == null)
                {
                    return null;
                }

                currentSkin = attachment.Linked.Skin ?? currentSkin;
                currentName = attachment.Linked.Parent;
            }

            return null;
        }

        private static Attachment? FindCoreAttachment(
            SkeletonDocument document,
            string skinName,
            string slotName,
            string attachmentName)
        {
            foreach (Skin skin in document.Skins)
            {
                if (skin.Name != skinName)
                {
                    continue;
                }

                foreach (KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>> slotEntry in skin.Attachments)
                {
                    if (slotEntry.Key != slotName)
                    {
                        continue;
                    }

                    foreach (KeyValuePair<string, Attachment> attachmentEntry in slotEntry.Value)
                    {
                        if (attachmentEntry.Key == attachmentName)
                        {
                            return attachmentEntry.Value;
                        }
                    }
                }
            }

            return null;
        }
    }
}
