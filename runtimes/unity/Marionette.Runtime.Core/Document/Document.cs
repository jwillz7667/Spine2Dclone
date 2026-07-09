using System.Collections.Generic;

namespace Marionette.Runtime.Core.Document
{
    // The subset of the SkeletonDocument model the shared C# core needs to solve the seven committed
    // conformance rigs. It mirrors the fields of @marionette/format/types that runtime-core reads; it is
    // NOT a general validator (that boundary is the format package's job in TS). Object member order is
    // preserved everywhere the TS solve iterates Object.keys() in insertion order (animation channels,
    // deform triples), so the port samples identically.

    public enum CurveKind
    {
        Linear,
        Stepped,
        Bezier,
    }

    public readonly struct Curve
    {
        public readonly CurveKind Kind;
        public readonly double Cx1;
        public readonly double Cy1;
        public readonly double Cx2;
        public readonly double Cy2;

        public Curve(CurveKind kind, double cx1, double cy1, double cx2, double cy2)
        {
            Kind = kind;
            Cx1 = cx1;
            Cy1 = cy1;
            Cx2 = cx2;
            Cy2 = cy2;
        }

        public static readonly Curve Linear = new Curve(CurveKind.Linear, 0, 0, 0, 0);
    }

    public readonly struct Rgba
    {
        public readonly double R;
        public readonly double G;
        public readonly double B;
        public readonly double A;

        public Rgba(double r, double g, double b, double a)
        {
            R = r;
            G = g;
            B = b;
            A = a;
        }
    }

    public sealed class Bone
    {
        public string Name { get; }
        public string? Parent { get; }
        public double Length { get; }
        public double X { get; }
        public double Y { get; }
        public double Rotation { get; }
        public double ScaleX { get; }
        public double ScaleY { get; }
        public double ShearX { get; }
        public double ShearY { get; }
        public string TransformMode { get; }

        public Bone(
            string name,
            string? parent,
            double length,
            double x,
            double y,
            double rotation,
            double scaleX,
            double scaleY,
            double shearX,
            double shearY,
            string transformMode)
        {
            Name = name;
            Parent = parent;
            Length = length;
            X = x;
            Y = y;
            Rotation = rotation;
            ScaleX = scaleX;
            ScaleY = scaleY;
            ShearX = shearX;
            ShearY = shearY;
            TransformMode = transformMode;
        }
    }

    public sealed class Slot
    {
        public string Name { get; }
        public string SlotBone { get; }
        public Rgba Color { get; }
        public string? Attachment { get; }

        // Static per-slot blend mode (solve-order step 6); the conformance fixture asserts it EXACTLY.
        // Defaults to "normal" when the rig omits it. Mirrors Slot.blendMode in @marionette/format.
        public string BlendMode { get; }

        public Slot(string name, string slotBone, Rgba color, string? attachment, string blendMode)
        {
            Name = name;
            SlotBone = slotBone;
            Color = color;
            Attachment = attachment;
            BlendMode = blendMode;
        }
    }

    public sealed class MeshAttachment
    {
        // The flat uv stream [u0, v0, ...]: its length / 2 is the logical vertex count.
        public double[] Uvs { get; }

        // The self delimiting vertex stream (ADR-0002). Unweighted: a flat [x0, y0, ...] setup stream.
        // Weighted: each logical vertex starts with its influence count, then [globalBoneIndex, vx, vy,
        // weight] per influence.
        public double[] Vertices { get; }

        // Present (and non empty) marks the mesh weighted; the values are unused by the skin solve (the
        // vertex stream carries global bone indices directly), so this is only the weighted flag.
        public int[]? Bones { get; }

        public MeshAttachment(double[] uvs, double[] vertices, int[]? bones)
        {
            Uvs = uvs;
            Vertices = vertices;
            Bones = bones;
        }
    }

    public sealed class Attachment
    {
        public string Type { get; }
        public MeshAttachment? Mesh { get; }

        public Attachment(string type, MeshAttachment? mesh)
        {
            Type = type;
            Mesh = mesh;
        }
    }

    public sealed class Skin
    {
        public string Name { get; }

        // slot name -> (attachment name -> attachment), member order preserved.
        public IReadOnlyList<KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>>> Attachments
        {
            get;
        }

        public Skin(
            string name,
            IReadOnlyList<KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>>> attachments)
        {
            Name = name;
            Attachments = attachments;
        }
    }

    public sealed class IkConstraint
    {
        public string Name { get; }
        public IReadOnlyList<string> Bones { get; }
        public string Target { get; }
        public double Mix { get; }
        public bool BendPositive { get; }

        public IkConstraint(string name, IReadOnlyList<string> bones, string target, double mix, bool bendPositive)
        {
            Name = name;
            Bones = bones;
            Target = target;
            Mix = mix;
            BendPositive = bendPositive;
        }
    }

    public sealed class TransformConstraint
    {
        public string Name { get; }
        public IReadOnlyList<string> Bones { get; }
        public string Target { get; }
        public double MixRotate { get; }
        public double MixX { get; }
        public double MixY { get; }
        public double MixScaleX { get; }
        public double MixScaleY { get; }
        public double MixShearY { get; }
        public double OffsetRotation { get; }
        public double OffsetX { get; }
        public double OffsetY { get; }
        public double OffsetScaleX { get; }
        public double OffsetScaleY { get; }
        public double OffsetShearY { get; }

        public TransformConstraint(
            string name,
            IReadOnlyList<string> bones,
            string target,
            double mixRotate,
            double mixX,
            double mixY,
            double mixScaleX,
            double mixScaleY,
            double mixShearY,
            double offsetRotation,
            double offsetX,
            double offsetY,
            double offsetScaleX,
            double offsetScaleY,
            double offsetShearY)
        {
            Name = name;
            Bones = bones;
            Target = target;
            MixRotate = mixRotate;
            MixX = mixX;
            MixY = mixY;
            MixScaleX = mixScaleX;
            MixScaleY = mixScaleY;
            MixShearY = mixShearY;
            OffsetRotation = offsetRotation;
            OffsetX = offsetX;
            OffsetY = offsetY;
            OffsetScaleX = offsetScaleX;
            OffsetScaleY = offsetScaleY;
            OffsetShearY = offsetShearY;
        }
    }

    public sealed class ScalarKeyframe
    {
        public double Time { get; }
        public double Value { get; }
        public Curve Curve { get; }

        public ScalarKeyframe(double time, double value, Curve curve)
        {
            Time = time;
            Value = value;
            Curve = curve;
        }
    }

    public sealed class Vec2Keyframe
    {
        public double Time { get; }
        public double X { get; }
        public double Y { get; }
        public Curve Curve { get; }

        public Vec2Keyframe(double time, double x, double y, Curve curve)
        {
            Time = time;
            X = x;
            Y = y;
            Curve = curve;
        }
    }

    public sealed class ColorKeyframe
    {
        public double Time { get; }
        public Rgba Color { get; }
        public Curve Curve { get; }

        public ColorKeyframe(double time, Rgba color, Curve curve)
        {
            Time = time;
            Color = color;
            Curve = curve;
        }
    }

    public sealed class AttachmentKeyframe
    {
        public double Time { get; }
        public string? Name { get; }

        public AttachmentKeyframe(double time, string? name)
        {
            Time = time;
            Name = name;
        }
    }

    public sealed class IkKeyframe
    {
        public double Time { get; }
        public double Mix { get; }
        public bool BendPositive { get; }
        public Curve Curve { get; }

        public IkKeyframe(double time, double mix, bool bendPositive, Curve curve)
        {
            Time = time;
            Mix = mix;
            BendPositive = bendPositive;
            Curve = curve;
        }
    }

    public sealed class TransformKeyframe
    {
        public double Time { get; }
        public Curve Curve { get; }

        // Present channels only (null == absent from this keyframe, which the mix track build honors by
        // dropping the channel so the constraint base holds).
        public double? MixRotate { get; }
        public double? MixX { get; }
        public double? MixY { get; }
        public double? MixScaleX { get; }
        public double? MixScaleY { get; }
        public double? MixShearY { get; }

        public TransformKeyframe(
            double time,
            Curve curve,
            double? mixRotate,
            double? mixX,
            double? mixY,
            double? mixScaleX,
            double? mixScaleY,
            double? mixShearY)
        {
            Time = time;
            Curve = curve;
            MixRotate = mixRotate;
            MixX = mixX;
            MixY = mixY;
            MixScaleX = mixScaleX;
            MixScaleY = mixScaleY;
            MixShearY = mixShearY;
        }
    }

    public sealed class DeformKeyframe
    {
        public double Time { get; }
        public double[] Offsets { get; }
        public Curve Curve { get; }

        public DeformKeyframe(double time, double[] offsets, Curve curve)
        {
            Time = time;
            Offsets = offsets;
            Curve = curve;
        }
    }

    public sealed class BoneTimelines
    {
        public IReadOnlyList<ScalarKeyframe>? Rotate { get; }
        public IReadOnlyList<Vec2Keyframe>? Translate { get; }
        public IReadOnlyList<Vec2Keyframe>? Scale { get; }
        public IReadOnlyList<Vec2Keyframe>? Shear { get; }

        public BoneTimelines(
            IReadOnlyList<ScalarKeyframe>? rotate,
            IReadOnlyList<Vec2Keyframe>? translate,
            IReadOnlyList<Vec2Keyframe>? scale,
            IReadOnlyList<Vec2Keyframe>? shear)
        {
            Rotate = rotate;
            Translate = translate;
            Scale = scale;
            Shear = shear;
        }
    }

    public sealed class SlotTimelines
    {
        public IReadOnlyList<ColorKeyframe>? Color { get; }
        public IReadOnlyList<AttachmentKeyframe>? Attachment { get; }

        public SlotTimelines(IReadOnlyList<ColorKeyframe>? color, IReadOnlyList<AttachmentKeyframe>? attachment)
        {
            Color = color;
            Attachment = attachment;
        }
    }

    public sealed class DeformEntry
    {
        public string Skin { get; }
        public string Slot { get; }
        public string Attachment { get; }
        public IReadOnlyList<DeformKeyframe> Frames { get; }

        public DeformEntry(string skin, string slot, string attachment, IReadOnlyList<DeformKeyframe> frames)
        {
            Skin = skin;
            Slot = slot;
            Attachment = attachment;
            Frames = frames;
        }
    }

    // A draw-order offset entry (ADR-0008 section 3): move one named slot by a signed integer number of
    // render positions from its setup index. Mirrors DrawOrderOffset in @marionette/format.
    public sealed class DrawOrderOffset
    {
        public string Slot { get; }
        public int Offset { get; }

        public DrawOrderOffset(string slot, int offset)
        {
            Slot = slot;
            Offset = offset;
        }
    }

    // A draw-order keyframe (ADR-0008 section 3): at Time, apply a compact list of per-slot offsets to the
    // setup draw order. An empty Offsets list means the setup order (identity). Stepped (no curve).
    public sealed class DrawOrderKeyframe
    {
        public double Time { get; }
        public IReadOnlyList<DrawOrderOffset> Offsets { get; }

        public DrawOrderKeyframe(double time, IReadOnlyList<DrawOrderOffset> offsets)
        {
            Time = time;
            Offsets = offsets;
        }
    }

    // An event keyframe (ADR-0008 section 2): fires the named event at Time, optionally overriding the
    // event's int/float/string payload defaults. Discrete (no curve). Null presence means "not overridden"
    // (the EventDef default holds); the payload resolution happens at prepare time.
    public sealed class EventKeyframe
    {
        public double Time { get; }
        public string Name { get; }
        public int? Int { get; }
        public double? Float { get; }
        public string? String { get; }

        public EventKeyframe(double time, string name, int? intValue, double? floatValue, string? stringValue)
        {
            Time = time;
            Name = name;
            Int = intValue;
            Float = floatValue;
            String = stringValue;
        }
    }

    // A named event definition (ADR-0008 section 1): the payload defaults an event carries when fired. The
    // audio hint is not part of the solve, so the C# core reads only the payload fields (name + defaults).
    public sealed class EventDef
    {
        public string Name { get; }
        public int? Int { get; }
        public double? Float { get; }
        public string? String { get; }

        public EventDef(string name, int? intValue, double? floatValue, string? stringValue)
        {
            Name = name;
            Int = intValue;
            Float = floatValue;
            String = stringValue;
        }
    }

    public sealed class Animation
    {
        public double Duration { get; }
        public IReadOnlyList<KeyValuePair<string, BoneTimelines>> Bones { get; }
        public IReadOnlyList<KeyValuePair<string, SlotTimelines>> Slots { get; }
        public IReadOnlyList<KeyValuePair<string, IReadOnlyList<IkKeyframe>>> Ik { get; }
        public IReadOnlyList<KeyValuePair<string, IReadOnlyList<TransformKeyframe>>> Transform { get; }
        public IReadOnlyList<DeformEntry> Deform { get; }
        public IReadOnlyList<DrawOrderKeyframe> DrawOrder { get; }
        public IReadOnlyList<EventKeyframe> Events { get; }

        public Animation(
            double duration,
            IReadOnlyList<KeyValuePair<string, BoneTimelines>> bones,
            IReadOnlyList<KeyValuePair<string, SlotTimelines>> slots,
            IReadOnlyList<KeyValuePair<string, IReadOnlyList<IkKeyframe>>> ik,
            IReadOnlyList<KeyValuePair<string, IReadOnlyList<TransformKeyframe>>> transform,
            IReadOnlyList<DeformEntry> deform,
            IReadOnlyList<DrawOrderKeyframe> drawOrder,
            IReadOnlyList<EventKeyframe> events)
        {
            Duration = duration;
            Bones = bones;
            Slots = slots;
            Ik = ik;
            Transform = transform;
            Deform = deform;
            DrawOrder = drawOrder;
            Events = events;
        }
    }

    public sealed class SkeletonDocument
    {
        public IReadOnlyList<Bone> Bones { get; }
        public IReadOnlyList<Slot> Slots { get; }
        public IReadOnlyList<Skin> Skins { get; }
        public IReadOnlyList<IkConstraint> IkConstraints { get; }
        public IReadOnlyList<TransformConstraint> TransformConstraints { get; }
        public IReadOnlyList<EventDef> Events { get; }
        public IReadOnlyList<KeyValuePair<string, Animation>> Animations { get; }

        public SkeletonDocument(
            IReadOnlyList<Bone> bones,
            IReadOnlyList<Slot> slots,
            IReadOnlyList<Skin> skins,
            IReadOnlyList<IkConstraint> ikConstraints,
            IReadOnlyList<TransformConstraint> transformConstraints,
            IReadOnlyList<EventDef> events,
            IReadOnlyList<KeyValuePair<string, Animation>> animations)
        {
            Bones = bones;
            Slots = slots;
            Skins = skins;
            IkConstraints = ikConstraints;
            TransformConstraints = transformConstraints;
            Events = events;
            Animations = animations;
        }

        public Animation? FindAnimation(string id)
        {
            for (int i = 0; i < Animations.Count; i += 1)
            {
                if (Animations[i].Key == id)
                {
                    return Animations[i].Value;
                }
            }

            return null;
        }
    }
}
