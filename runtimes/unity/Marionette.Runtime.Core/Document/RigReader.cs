using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Json;

namespace Marionette.Runtime.Core.Document
{
    // Thrown when a rig JSON is missing a field the solve requires. A typed error (never a bare throw) so
    // the harness reports exactly which member was absent. This is a MINIMAL strict reader for the fields
    // the seven committed conformance rigs use, not a general format validator (that boundary is the TS
    // format package's job); the committed rigs are already validated there before they are committed.
    public sealed class RigReadException : Exception
    {
        public RigReadException(string message)
            : base(message)
        {
        }
    }

    public static class RigReader
    {
        public static SkeletonDocument Parse(string json)
        {
            JsonValue root = JsonParser.Parse(json);
            return ReadDocument(root);
        }

        private static SkeletonDocument ReadDocument(JsonValue root)
        {
            var bones = new List<Bone>();
            foreach (JsonValue bone in ReqArray(root, "bones"))
            {
                bones.Add(ReadBone(bone));
            }

            var slots = new List<Slot>();
            JsonValue? slotsValue = root.Member("slots");
            if (slotsValue != null && slotsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue slot in slotsValue.AsArray())
                {
                    slots.Add(ReadSlot(slot));
                }
            }

            var skins = new List<Skin>();
            JsonValue? skinsValue = root.Member("skins");
            if (skinsValue != null && skinsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue skin in skinsValue.AsArray())
                {
                    skins.Add(ReadSkin(skin));
                }
            }

            var ikConstraints = new List<IkConstraint>();
            JsonValue? ikValue = root.Member("ikConstraints");
            if (ikValue != null && ikValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue ik in ikValue.AsArray())
                {
                    ikConstraints.Add(ReadIkConstraint(ik));
                }
            }

            var transformConstraints = new List<TransformConstraint>();
            JsonValue? tcValue = root.Member("transformConstraints");
            if (tcValue != null && tcValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue tc in tcValue.AsArray())
                {
                    transformConstraints.Add(ReadTransformConstraint(tc));
                }
            }

            var events = new List<EventDef>();
            JsonValue? eventsValue = root.Member("events");
            if (eventsValue != null && eventsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue ev in eventsValue.AsArray())
                {
                    events.Add(
                        new EventDef(
                            ReqString(ev, "name"),
                            OptInt(ev, "int"),
                            OptNumber(ev, "float"),
                            OptString(ev, "string")));
                }
            }

            var animations = new List<KeyValuePair<string, Animation>>();
            JsonValue animationsValue = ReqMember(root, "animations", JsonKind.Object);
            foreach (KeyValuePair<string, JsonValue> entry in animationsValue.Members())
            {
                animations.Add(
                    new KeyValuePair<string, Animation>(entry.Key, ReadAnimation(entry.Value)));
            }

            return new SkeletonDocument(
                bones,
                slots,
                skins,
                ikConstraints,
                transformConstraints,
                events,
                animations);
        }

        private static Bone ReadBone(JsonValue bone)
        {
            JsonValue? parent = bone.Member("parent");
            string? parentName = parent == null || parent.IsNull ? null : parent.AsString();
            return new Bone(
                ReqString(bone, "name"),
                parentName,
                ReqNumber(bone, "length"),
                ReqNumber(bone, "x"),
                ReqNumber(bone, "y"),
                ReqNumber(bone, "rotation"),
                ReqNumber(bone, "scaleX"),
                ReqNumber(bone, "scaleY"),
                ReqNumber(bone, "shearX"),
                ReqNumber(bone, "shearY"),
                ReqString(bone, "transformMode"));
        }

        private static Slot ReadSlot(JsonValue slot)
        {
            JsonValue? attachment = slot.Member("attachment");
            string? attachmentName = attachment == null || attachment.IsNull ? null : attachment.AsString();
            // Optional setup two-color dark tint (ADR-0009 section 4.3, ADR-0011 section 3): an RGBA color
            // object, present only when the slot enables two-color tinting. Absent stays null (inert).
            JsonValue? darkValue = slot.Member("darkColor");
            Rgba? darkColor = darkValue != null && darkValue.Kind == JsonKind.Object
                ? ReadColor(darkValue)
                : (Rgba?)null;
            return new Slot(
                ReqString(slot, "name"),
                ReqString(slot, "bone"),
                ReadColor(ReqMember(slot, "color", JsonKind.Object)),
                attachmentName,
                OptString(slot, "blendMode") ?? "normal",
                darkColor);
        }

        private static Skin ReadSkin(JsonValue skin)
        {
            var slots = new List<KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>>>();
            JsonValue attachments = ReqMember(skin, "attachments", JsonKind.Object);
            foreach (KeyValuePair<string, JsonValue> slotEntry in attachments.Members())
            {
                var perSlot = new List<KeyValuePair<string, Attachment>>();
                foreach (KeyValuePair<string, JsonValue> attachmentEntry in slotEntry.Value.Members())
                {
                    perSlot.Add(
                        new KeyValuePair<string, Attachment>(
                            attachmentEntry.Key,
                            ReadAttachment(attachmentEntry.Value)));
                }

                slots.Add(
                    new KeyValuePair<string, IReadOnlyList<KeyValuePair<string, Attachment>>>(
                        slotEntry.Key,
                        perSlot));
            }

            return new Skin(ReqString(skin, "name"), slots);
        }

        private static Attachment ReadAttachment(JsonValue attachment)
        {
            string type = ReqString(attachment, "type");

            // A linked mesh (ADR-0011 section 1) carries no geometry: read the parent reference, the optional
            // parent-skin override, and the required timelines-sharing flag. Path/width/height/color are
            // render inputs the solve ignores, so they are not read.
            if (type == "linkedmesh")
            {
                JsonValue? skinValue = attachment.Member("skin");
                string? skin = skinValue == null || skinValue.IsNull ? null : skinValue.AsString();
                return new Attachment(
                    type,
                    null,
                    new LinkedMeshAttachment(
                        ReqString(attachment, "parent"),
                        skin,
                        ReqBool(attachment, "timelines")),
                    null);
            }

            // A region or mesh attachment may carry an optional sequence block (ADR-0011 section 2); read it
            // for both so the sequence solve can find it on either attachment kind.
            SequenceBlock? sequence = ReadSequenceBlock(attachment);

            if (type != "mesh")
            {
                return new Attachment(type, null, null, sequence);
            }

            double[] uvs = ReadNumberArray(ReqMember(attachment, "uvs", JsonKind.Array));
            double[] vertices = ReadNumberArray(ReqMember(attachment, "vertices", JsonKind.Array));
            int[]? bones = null;
            JsonValue? bonesValue = attachment.Member("bones");
            if (bonesValue != null && bonesValue.Kind == JsonKind.Array)
            {
                bones = ReadIntArray(bonesValue);
            }

            return new Attachment(type, new MeshAttachment(uvs, vertices, bones), null, sequence);
        }

        private static SequenceBlock? ReadSequenceBlock(JsonValue attachment)
        {
            JsonValue? sequenceValue = attachment.Member("sequence");
            if (sequenceValue == null || sequenceValue.Kind != JsonKind.Object)
            {
                return null;
            }

            // The solve needs only count + setupIndex; start/digits are render-only naming inputs.
            return new SequenceBlock(
                (int)ReqNumber(sequenceValue, "count"),
                (int)ReqNumber(sequenceValue, "setupIndex"));
        }

        private static IkConstraint ReadIkConstraint(JsonValue ik)
        {
            // Format 0.4.0 (ADR-0009) carries the signed bend direction (+1 / -1) in place of the pre-0.4.0
            // bendPositive boolean; the solve keys on the same sign, so bend > 0 reproduces it exactly. The
            // F2 depth fields (softness/stretch/compress/uniform, ADR-0010 section 2) and the optional
            // explicit solve order (ADR-0009 section 1.3) drive the depth/order solve; absent order is -1.
            return new IkConstraint(
                ReqString(ik, "name"),
                ReadStringArray(ReqMember(ik, "bones", JsonKind.Array)),
                ReqString(ik, "target"),
                ReqNumber(ik, "mix"),
                ReqNumber(ik, "bend") > 0.0,
                OptNumber(ik, "softness") ?? 0.0,
                OptBool(ik, "stretch") ?? false,
                OptBool(ik, "compress") ?? false,
                OptBool(ik, "uniform") ?? false,
                OptInt(ik, "order") ?? -1);
        }

        private static TransformConstraint ReadTransformConstraint(JsonValue tc)
        {
            return new TransformConstraint(
                ReqString(tc, "name"),
                ReadStringArray(ReqMember(tc, "bones", JsonKind.Array)),
                ReqString(tc, "target"),
                ReqNumber(tc, "mixRotate"),
                ReqNumber(tc, "mixX"),
                ReqNumber(tc, "mixY"),
                ReqNumber(tc, "mixScaleX"),
                ReqNumber(tc, "mixScaleY"),
                ReqNumber(tc, "mixShearY"),
                ReqNumber(tc, "offsetRotation"),
                ReqNumber(tc, "offsetX"),
                ReqNumber(tc, "offsetY"),
                ReqNumber(tc, "offsetScaleX"),
                ReqNumber(tc, "offsetScaleY"),
                ReqNumber(tc, "offsetShearY"),
                // Variant flags (ADR-0009 section 1.2) and the optional explicit solve order (section 1.3).
                // The variant solve is deferred (ADR-0010 section 3); order feeds the interleaved schedule.
                OptBool(tc, "local") ?? false,
                OptBool(tc, "relative") ?? false,
                OptInt(tc, "order") ?? -1);
        }

        private static Animation ReadAnimation(JsonValue animation)
        {
            double duration = ReqNumber(animation, "duration");

            var bones = new List<KeyValuePair<string, BoneTimelines>>();
            JsonValue? bonesValue = animation.Member("bones");
            if (bonesValue != null && bonesValue.Kind == JsonKind.Object)
            {
                foreach (KeyValuePair<string, JsonValue> entry in bonesValue.Members())
                {
                    bones.Add(
                        new KeyValuePair<string, BoneTimelines>(entry.Key, ReadBoneTimelines(entry.Value)));
                }
            }

            var slots = new List<KeyValuePair<string, SlotTimelines>>();
            JsonValue? slotsValue = animation.Member("slots");
            if (slotsValue != null && slotsValue.Kind == JsonKind.Object)
            {
                foreach (KeyValuePair<string, JsonValue> entry in slotsValue.Members())
                {
                    slots.Add(
                        new KeyValuePair<string, SlotTimelines>(entry.Key, ReadSlotTimelines(entry.Value)));
                }
            }

            var ik = new List<KeyValuePair<string, IReadOnlyList<IkKeyframe>>>();
            JsonValue? ikValue = animation.Member("ik");
            if (ikValue != null && ikValue.Kind == JsonKind.Object)
            {
                foreach (KeyValuePair<string, JsonValue> entry in ikValue.Members())
                {
                    var frames = new List<IkKeyframe>();
                    foreach (JsonValue frame in entry.Value.AsArray())
                    {
                        JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                        frames.Add(
                            new IkKeyframe(
                                ReqNumber(frame, "time"),
                                ReqNumber(value, "mix"),
                                // Signed bend (ADR-0009); bend > 0 reproduces the pre-0.4.0 bendPositive.
                                ReqNumber(value, "bend") > 0.0,
                                ReadCurve(frame),
                                // Optional keyable depth channels (ADR-0010 section 2.4); absent == null so
                                // the depth-track build drops the channel and the constraint base holds.
                                OptNumber(value, "softness"),
                                OptBool(value, "stretch"),
                                OptBool(value, "compress")));
                    }

                    ik.Add(new KeyValuePair<string, IReadOnlyList<IkKeyframe>>(entry.Key, frames));
                }
            }

            var transform = new List<KeyValuePair<string, IReadOnlyList<TransformKeyframe>>>();
            JsonValue? transformValue = animation.Member("transform");
            if (transformValue != null && transformValue.Kind == JsonKind.Object)
            {
                foreach (KeyValuePair<string, JsonValue> entry in transformValue.Members())
                {
                    var frames = new List<TransformKeyframe>();
                    foreach (JsonValue frame in entry.Value.AsArray())
                    {
                        JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                        frames.Add(
                            new TransformKeyframe(
                                ReqNumber(frame, "time"),
                                ReadCurve(frame),
                                OptNumber(value, "mixRotate"),
                                OptNumber(value, "mixX"),
                                OptNumber(value, "mixY"),
                                OptNumber(value, "mixScaleX"),
                                OptNumber(value, "mixScaleY"),
                                OptNumber(value, "mixShearY")));
                    }

                    transform.Add(
                        new KeyValuePair<string, IReadOnlyList<TransformKeyframe>>(entry.Key, frames));
                }
            }

            var deform = new List<DeformEntry>();
            JsonValue? deformValue = animation.Member("deform");
            if (deformValue != null && deformValue.Kind == JsonKind.Object)
            {
                foreach (KeyValuePair<string, JsonValue> skinEntry in deformValue.Members())
                {
                    foreach (KeyValuePair<string, JsonValue> slotEntry in skinEntry.Value.Members())
                    {
                        foreach (KeyValuePair<string, JsonValue> attachmentEntry in slotEntry.Value.Members())
                        {
                            var frames = new List<DeformKeyframe>();
                            foreach (JsonValue frame in attachmentEntry.Value.AsArray())
                            {
                                JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                                frames.Add(
                                    new DeformKeyframe(
                                        ReqNumber(frame, "time"),
                                        ReadNumberArray(ReqMember(value, "offsets", JsonKind.Array)),
                                        ReadCurve(frame)));
                            }

                            deform.Add(
                                new DeformEntry(
                                    skinEntry.Key,
                                    slotEntry.Key,
                                    attachmentEntry.Key,
                                    frames));
                        }
                    }
                }
            }

            var drawOrder = new List<DrawOrderKeyframe>();
            JsonValue? drawOrderValue = animation.Member("drawOrder");
            if (drawOrderValue != null && drawOrderValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue key in drawOrderValue.AsArray())
                {
                    var offsets = new List<DrawOrderOffset>();
                    JsonValue? offsetsValue = key.Member("offsets");
                    if (offsetsValue != null && offsetsValue.Kind == JsonKind.Array)
                    {
                        foreach (JsonValue offset in offsetsValue.AsArray())
                        {
                            offsets.Add(
                                new DrawOrderOffset(
                                    ReqString(offset, "slot"),
                                    (int)ReqNumber(offset, "offset")));
                        }
                    }

                    drawOrder.Add(new DrawOrderKeyframe(ReqNumber(key, "time"), offsets));
                }
            }

            var events = new List<EventKeyframe>();
            JsonValue? eventsValue = animation.Member("events");
            if (eventsValue != null && eventsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue ev in eventsValue.AsArray())
                {
                    events.Add(
                        new EventKeyframe(
                            ReqNumber(ev, "time"),
                            ReqString(ev, "name"),
                            OptInt(ev, "int"),
                            OptNumber(ev, "float"),
                            OptString(ev, "string")));
                }
            }

            return new Animation(duration, bones, slots, ik, transform, deform, drawOrder, events);
        }

        private static BoneTimelines ReadBoneTimelines(JsonValue timelines)
        {
            return new BoneTimelines(
                ReadScalarChannel(timelines.Member("rotate"), "angle"),
                ReadVec2Channel(timelines.Member("translate")),
                ReadVec2Channel(timelines.Member("scale")),
                ReadVec2Channel(timelines.Member("shear")),
                // Per-component split tracks (ADR-0009 section 4.1, ADR-0011 section 3): each keyframe carries
                // its scalar under `value.value`.
                ReadScalarChannel(timelines.Member("translateX"), "value"),
                ReadScalarChannel(timelines.Member("translateY"), "value"),
                ReadScalarChannel(timelines.Member("scaleX"), "value"),
                ReadScalarChannel(timelines.Member("scaleY"), "value"),
                ReadScalarChannel(timelines.Member("shearX"), "value"),
                ReadScalarChannel(timelines.Member("shearY"), "value"));
        }

        private static SlotTimelines ReadSlotTimelines(JsonValue timelines)
        {
            return new SlotTimelines(
                ReadColorChannel(timelines.Member("color")),
                ReadAttachmentChannel(timelines.Member("attachment")),
                ReadSequenceChannel(timelines.Member("sequence")),
                // Split color tracks (ADR-0009 section 4.2, ADR-0011 section 3): rgb reads `value.rgb.{r,g,b}`,
                // alpha reads `value.alpha`. The keyable dark tint reads `value.color.{r,g,b,a}`, structurally
                // identical to the joint color channel, so it reuses ReadColorChannel.
                ReadRgbChannel(timelines.Member("rgb")),
                ReadScalarChannel(timelines.Member("alpha"), "alpha"),
                ReadColorChannel(timelines.Member("dark")));
        }

        private static List<RgbKeyframe>? ReadRgbChannel(JsonValue? channel)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            var keys = new List<RgbKeyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                JsonValue rgb = ReqMember(value, "rgb", JsonKind.Object);
                keys.Add(
                    new RgbKeyframe(
                        ReqNumber(frame, "time"),
                        ReqNumber(rgb, "r"),
                        ReqNumber(rgb, "g"),
                        ReqNumber(rgb, "b"),
                        ReadCurve(frame)));
            }

            return keys;
        }

        private static List<SequenceKeyframe>? ReadSequenceChannel(JsonValue? channel)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            // A sequence keyframe carries its fields directly (no nested "value" object): time, mode, index,
            // delay (ADR-0009 section 3). The mode is a closed enum, so an unknown string fails loudly.
            var keys = new List<SequenceKeyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                keys.Add(
                    new SequenceKeyframe(
                        ReqNumber(frame, "time"),
                        ParseSequenceMode(ReqString(frame, "mode")),
                        (int)ReqNumber(frame, "index"),
                        ReqNumber(frame, "delay")));
            }

            return keys;
        }

        private static SequenceMode ParseSequenceMode(string mode)
        {
            switch (mode)
            {
                case "hold":
                    return SequenceMode.Hold;
                case "once":
                    return SequenceMode.Once;
                case "loop":
                    return SequenceMode.Loop;
                case "pingpong":
                    return SequenceMode.Pingpong;
                case "onceReverse":
                    return SequenceMode.OnceReverse;
                case "loopReverse":
                    return SequenceMode.LoopReverse;
                case "pingpongReverse":
                    return SequenceMode.PingpongReverse;
                default:
                    throw new RigReadException($"unknown sequence mode '{mode}'");
            }
        }

        private static List<ScalarKeyframe>? ReadScalarChannel(JsonValue? channel, string valueKey)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            var keys = new List<ScalarKeyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                keys.Add(
                    new ScalarKeyframe(ReqNumber(frame, "time"), ReqNumber(value, valueKey), ReadCurve(frame)));
            }

            return keys;
        }

        private static List<Vec2Keyframe>? ReadVec2Channel(JsonValue? channel)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            var keys = new List<Vec2Keyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                keys.Add(
                    new Vec2Keyframe(
                        ReqNumber(frame, "time"),
                        ReqNumber(value, "x"),
                        ReqNumber(value, "y"),
                        ReadCurve(frame)));
            }

            return keys;
        }

        private static List<ColorKeyframe>? ReadColorChannel(JsonValue? channel)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            var keys = new List<ColorKeyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                JsonValue value = ReqMember(frame, "value", JsonKind.Object);
                keys.Add(
                    new ColorKeyframe(
                        ReqNumber(frame, "time"),
                        ReadColor(ReqMember(value, "color", JsonKind.Object)),
                        ReadCurve(frame)));
            }

            return keys;
        }

        private static List<AttachmentKeyframe>? ReadAttachmentChannel(JsonValue? channel)
        {
            if (channel == null || channel.Kind != JsonKind.Array)
            {
                return null;
            }

            var keys = new List<AttachmentKeyframe>();
            foreach (JsonValue frame in channel.AsArray())
            {
                JsonValue? name = frame.Member("name");
                string? nameValue = name == null || name.IsNull ? null : name.AsString();
                keys.Add(new AttachmentKeyframe(ReqNumber(frame, "time"), nameValue));
            }

            return keys;
        }

        private static Curve ReadCurve(JsonValue frame)
        {
            JsonValue? curve = frame.Member("curve");
            if (curve == null)
            {
                return Curve.Linear;
            }

            if (curve.Kind == JsonKind.String)
            {
                string kind = curve.AsString();
                if (kind == "stepped")
                {
                    return new Curve(CurveKind.Stepped, 0, 0, 0, 0);
                }

                return Curve.Linear;
            }

            if (curve.Kind == JsonKind.Object)
            {
                return new Curve(
                    CurveKind.Bezier,
                    ReqNumber(curve, "cx1"),
                    ReqNumber(curve, "cy1"),
                    ReqNumber(curve, "cx2"),
                    ReqNumber(curve, "cy2"));
            }

            return Curve.Linear;
        }

        private static Rgba ReadColor(JsonValue color)
        {
            return new Rgba(
                ReqNumber(color, "r"),
                ReqNumber(color, "g"),
                ReqNumber(color, "b"),
                ReqNumber(color, "a"));
        }

        private static double[] ReadNumberArray(JsonValue array)
        {
            IReadOnlyList<JsonValue> items = array.AsArray();
            var result = new double[items.Count];
            for (int i = 0; i < items.Count; i += 1)
            {
                result[i] = items[i].AsNumber();
            }

            return result;
        }

        private static int[] ReadIntArray(JsonValue array)
        {
            IReadOnlyList<JsonValue> items = array.AsArray();
            var result = new int[items.Count];
            for (int i = 0; i < items.Count; i += 1)
            {
                result[i] = (int)items[i].AsNumber();
            }

            return result;
        }

        private static List<string> ReadStringArray(JsonValue array)
        {
            IReadOnlyList<JsonValue> items = array.AsArray();
            var result = new List<string>(items.Count);
            for (int i = 0; i < items.Count; i += 1)
            {
                result.Add(items[i].AsString());
            }

            return result;
        }

        private static JsonValue ReqMember(JsonValue obj, string key, JsonKind expectedKind)
        {
            JsonValue? member = obj.Member(key);
            if (member == null)
            {
                throw new RigReadException($"missing required member '{key}'");
            }

            if (member.Kind != expectedKind)
            {
                throw new RigReadException(
                    $"member '{key}' expected {expectedKind} but was {member.Kind}");
            }

            return member;
        }

        private static IReadOnlyList<JsonValue> ReqArray(JsonValue obj, string key) =>
            ReqMember(obj, key, JsonKind.Array).AsArray();

        private static double ReqNumber(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.Number)
            {
                throw new RigReadException($"missing required number '{key}'");
            }

            return member.AsNumber();
        }

        private static double? OptNumber(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.Number)
            {
                return null;
            }

            return member.AsNumber();
        }

        private static int? OptInt(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.Number)
            {
                return null;
            }

            return (int)member.AsNumber();
        }

        private static bool? OptBool(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.Bool)
            {
                return null;
            }

            return member.AsBool();
        }

        private static string? OptString(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.String)
            {
                return null;
            }

            return member.AsString();
        }

        private static string ReqString(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.String)
            {
                throw new RigReadException($"missing required string '{key}'");
            }

            return member.AsString();
        }

        private static bool ReqBool(JsonValue obj, string key)
        {
            JsonValue? member = obj.Member(key);
            if (member == null || member.Kind != JsonKind.Bool)
            {
                throw new RigReadException($"missing required bool '{key}'");
            }

            return member.AsBool();
        }
    }
}
