using System.Collections.Generic;

namespace Marionette.Runtime.View
{
    // The RENDER-only projection of a SkeletonDocument: the attachment fields the solve core
    // (Marionette.Runtime.Core.Document) deliberately does NOT read because the solve does not need them,
    // but a renderer does. The core Document carries bones, slots, skins-as-solve-inputs, constraints and
    // animations; this model carries the per-attachment DRAW inputs (region placement quad, mesh triangles
    // and texture coordinates, per-attachment tint and atlas region name) plus the atlas region table. It
    // mirrors the @marionette/format region/mesh/linkedmesh attachment schema and the atlas schema. Reading
    // it is the RenderModelReader's job; consuming it (with a solved Pose) is the DrawItemBuilder's job.
    //
    // Both models are read from the SAME format JSON: the core RigReader builds the solve inputs, this
    // reader builds the render inputs, so a renderer holds one document and two typed views over it.

    // A straight-alpha RGBA tint in [0, 1], the per-attachment color multiplied into the slot color.
    public readonly struct RenderColor
    {
        public readonly double R;
        public readonly double G;
        public readonly double B;
        public readonly double A;

        public RenderColor(double r, double g, double b, double a)
        {
            R = r;
            G = g;
            B = b;
            A = a;
        }

        public static readonly RenderColor White = new RenderColor(1, 1, 1, 1);
    }

    // A region attachment (a single textured quad): the local (x, y, rotation, scaleX, scaleY) offset in the
    // slot bone's frame, the authored width x height footprint, the atlas region name (Path), and the
    // per-attachment tint. Mirrors regionAttachmentSchema. The quad's world corners are computed by
    // RegionGeometry from the slot bone's solved world matrix.
    public sealed class RenderRegion
    {
        public string Path { get; }
        public double X { get; }
        public double Y { get; }
        public double Rotation { get; }
        public double ScaleX { get; }
        public double ScaleY { get; }
        public double Width { get; }
        public double Height { get; }
        public RenderColor Color { get; }

        public RenderRegion(
            string path,
            double x,
            double y,
            double rotation,
            double scaleX,
            double scaleY,
            double width,
            double height,
            RenderColor color)
        {
            Path = path;
            X = x;
            Y = y;
            Rotation = rotation;
            ScaleX = scaleX;
            ScaleY = scaleY;
            Width = width;
            Height = height;
            Color = color;
        }
    }

    // A mesh attachment's RENDER inputs: the atlas region name (Path), the per-vertex texture coordinates
    // (Uvs, normalized over the region window; length / 2 is the vertex count), the triangle index list
    // (Triangles, three indices per triangle into the vertex list), and the tint. The WORLD vertex
    // positions are NOT here: they come from the solve (MeshSample.SampleMeshVertices / SkinMeshInto), which
    // is the single behavioral source of truth. Mirrors meshAttachmentSchema's render fields.
    public sealed class RenderMesh
    {
        public string Path { get; }
        public double[] Uvs { get; }
        public int[] Triangles { get; }
        public RenderColor Color { get; }

        public RenderMesh(string path, double[] uvs, int[] triangles, RenderColor color)
        {
            Path = path;
            Uvs = uvs;
            Triangles = triangles;
            Color = color;
        }
    }

    // A linked mesh's RENDER inputs (ADR-0009 section 2): it carries its OWN atlas region name and tint but
    // reuses a PARENT mesh's uvs/triangles geometry (resolved through Parent on the same slot in skin
    // Skin ?? this skin). Mirrors linkedMeshAttachmentSchema's render fields.
    public sealed class RenderLinkedMesh
    {
        public string Path { get; }
        public string Parent { get; }
        public string? Skin { get; }
        public RenderColor Color { get; }

        public RenderLinkedMesh(string path, string parent, string? skin, RenderColor color)
        {
            Path = path;
            Parent = parent;
            Skin = skin;
            Color = color;
        }
    }

    // A region/mesh attachment's sequence block (ADR-0009 section 3): a bounded run of numbered atlas
    // regions. Count frames, SetupIndex shown in setup pose, and the naming inputs Start/Digits that turn a
    // resolved integer frame into a region NAME (path + zero-padded (Start + frame) to Digits places). The
    // solve resolves the integer frame; the renderer resolves the name (RenderSequenceName). Mirrors
    // sequenceSchema.
    public readonly struct RenderSequence
    {
        public readonly int Count;
        public readonly int SetupIndex;
        public readonly int Start;
        public readonly int Digits;

        public RenderSequence(int count, int setupIndex, int start, int digits)
        {
            Count = count;
            SetupIndex = setupIndex;
            Start = start;
            Digits = digits;
        }
    }

    public enum RenderAttachmentKind
    {
        Region,
        Mesh,
        LinkedMesh,

        // A non-drawing attachment (clipping, boundingbox, point, path): present in the skin but never
        // emitted as a draw item. The reader records the kind so the builder can skip it explicitly rather
        // than treating an unknown member as a drawable.
        NonDrawing,
    }

    // One attachment in a skin's render table: the kind plus exactly one populated payload (or none for a
    // non-drawing attachment). A closed discriminated shape mirroring the format's attachment union.
    public sealed class RenderAttachment
    {
        public RenderAttachmentKind Kind { get; }
        public RenderRegion? Region { get; }
        public RenderMesh? Mesh { get; }
        public RenderLinkedMesh? LinkedMesh { get; }

        // A region or mesh attachment MAY carry a sequence block (ADR-0011 section 2); when present, the
        // drawn atlas region is the sequence-resolved frame's name rather than Path. Null when absent.
        public RenderSequence? Sequence { get; }

        private RenderAttachment(
            RenderAttachmentKind kind,
            RenderRegion? region,
            RenderMesh? mesh,
            RenderLinkedMesh? linkedMesh,
            RenderSequence? sequence)
        {
            Kind = kind;
            Region = region;
            Mesh = mesh;
            LinkedMesh = linkedMesh;
            Sequence = sequence;
        }

        public static RenderAttachment OfRegion(RenderRegion region, RenderSequence? sequence) =>
            new RenderAttachment(RenderAttachmentKind.Region, region, null, null, sequence);

        public static RenderAttachment OfMesh(RenderMesh mesh, RenderSequence? sequence) =>
            new RenderAttachment(RenderAttachmentKind.Mesh, null, mesh, null, sequence);

        public static RenderAttachment OfLinkedMesh(RenderLinkedMesh linkedMesh) =>
            new RenderAttachment(RenderAttachmentKind.LinkedMesh, null, null, linkedMesh, null);

        public static RenderAttachment NonDrawing() =>
            new RenderAttachment(RenderAttachmentKind.NonDrawing, null, null, null, null);
    }

    // One skin's render table: slot name -> (attachment name -> RenderAttachment), insertion order
    // preserved so lookups and any ordered traversal match the format's member order.
    public sealed class RenderSkin
    {
        public string Name { get; }
        public IReadOnlyDictionary<string, IReadOnlyDictionary<string, RenderAttachment>> Slots { get; }

        public RenderSkin(
            string name,
            IReadOnlyDictionary<string, IReadOnlyDictionary<string, RenderAttachment>> slots)
        {
            Name = name;
            Slots = slots;
        }

        // Look up a render attachment by (slot, attachment) in this skin, or null when absent.
        public RenderAttachment? Find(string slotName, string attachmentName)
        {
            if (!Slots.TryGetValue(slotName, out IReadOnlyDictionary<string, RenderAttachment>? bySlot))
            {
                return null;
            }

            return bySlot.TryGetValue(attachmentName, out RenderAttachment? attachment) ? attachment : null;
        }
    }

    // The render-only projection of the whole document: the skins' render tables (by name) and the atlas.
    public sealed class RenderModel
    {
        public IReadOnlyDictionary<string, RenderSkin> Skins { get; }
        public AtlasData Atlas { get; }

        public RenderModel(IReadOnlyDictionary<string, RenderSkin> skins, AtlasData atlas)
        {
            Skins = skins;
            Atlas = atlas;
        }

        public RenderSkin? FindSkin(string name) =>
            Skins.TryGetValue(name, out RenderSkin? skin) ? skin : null;
    }

    // One packed atlas region (mirrors atlasRegionSchema): the pixel rectangle (X, Y, W, H) on its page,
    // whether it was packed rotated 90 degrees clockwise, and the trim window (OffsetX/OffsetY inside the
    // OriginalW x OriginalH untrimmed footprint). Name is unique across pages.
    public sealed class AtlasRegion
    {
        public string Name { get; }
        public double X { get; }
        public double Y { get; }
        public double W { get; }
        public double H { get; }
        public bool Rotated { get; }
        public double OffsetX { get; }
        public double OffsetY { get; }
        public double OriginalW { get; }
        public double OriginalH { get; }

        public AtlasRegion(
            string name,
            double x,
            double y,
            double w,
            double h,
            bool rotated,
            double offsetX,
            double offsetY,
            double originalW,
            double originalH)
        {
            Name = name;
            X = x;
            Y = y;
            W = w;
            H = h;
            Rotated = rotated;
            OffsetX = offsetX;
            OffsetY = offsetY;
            OriginalW = originalW;
            OriginalH = originalH;
        }
    }

    // One atlas page (mirrors atlasPageSchema): the image file name, its pixel dimensions, and its regions.
    public sealed class AtlasPage
    {
        public string File { get; }
        public double Width { get; }
        public double Height { get; }
        public IReadOnlyList<AtlasRegion> Regions { get; }

        public AtlasPage(string file, double width, double height, IReadOnlyList<AtlasRegion> regions)
        {
            File = file;
            Width = width;
            Height = height;
            Regions = regions;
        }
    }

    // The document atlas (mirrors atlasRefSchema): the ordered pages. Empty for a bone-only rig with no
    // textured attachments.
    public sealed class AtlasData
    {
        public IReadOnlyList<AtlasPage> Pages { get; }

        public AtlasData(IReadOnlyList<AtlasPage> pages)
        {
            Pages = pages;
        }

        public static readonly AtlasData Empty = new AtlasData(new List<AtlasPage>());
    }
}
