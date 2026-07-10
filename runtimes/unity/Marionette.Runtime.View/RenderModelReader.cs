using System;
using System.Collections.Generic;
using Marionette.Runtime.Core.Json;

namespace Marionette.Runtime.View
{
    // Thrown when the render-only projection of a document is malformed (a required render field is absent
    // or the wrong JSON kind). A typed error, never a bare throw, so a host can distinguish a bad document
    // from a runtime bug. The solve core's RigReader guards the SOLVE inputs the same way; this guards the
    // RENDER inputs the solve reader skips.
    public sealed class RenderModelReadException : Exception
    {
        public RenderModelReadException(string message)
            : base(message)
        {
        }
    }

    // Builds the RENDER-only projection (skins' region/mesh/linkedmesh attachments plus the atlas) from a
    // format document's JSON, reusing the core's dependency-free JSON parser. It reads ONLY the render
    // fields the solve core's RigReader deliberately skips (region placement quad, mesh uvs/triangles,
    // per-attachment color, atlas region table); the solve inputs come from the core reader in parallel.
    public static class RenderModelReader
    {
        public static RenderModel Parse(string json)
        {
            JsonValue root = JsonParser.Parse(json);
            return Read(root);
        }

        public static RenderModel Read(JsonValue root)
        {
            var skins = new Dictionary<string, RenderSkin>();
            JsonValue? skinsValue = root.Member("skins");
            if (skinsValue != null && skinsValue.Kind == JsonKind.Array)
            {
                foreach (JsonValue skin in skinsValue.AsArray())
                {
                    RenderSkin renderSkin = ReadSkin(skin);
                    skins[renderSkin.Name] = renderSkin;
                }
            }

            AtlasData atlas = ReadAtlas(root.Member("atlas"));
            return new RenderModel(skins, atlas);
        }

        private static RenderSkin ReadSkin(JsonValue skin)
        {
            string name = ReqString(skin, "name");
            var slots = new Dictionary<string, IReadOnlyDictionary<string, RenderAttachment>>();
            JsonValue attachments = ReqObject(skin, "attachments");
            foreach (KeyValuePair<string, JsonValue> slotEntry in attachments.Members())
            {
                var perSlot = new Dictionary<string, RenderAttachment>();
                foreach (KeyValuePair<string, JsonValue> attachmentEntry in slotEntry.Value.Members())
                {
                    perSlot[attachmentEntry.Key] = ReadAttachment(attachmentEntry.Value);
                }

                slots[slotEntry.Key] = perSlot;
            }

            return new RenderSkin(name, slots);
        }

        private static RenderAttachment ReadAttachment(JsonValue attachment)
        {
            string type = ReqString(attachment, "type");
            switch (type)
            {
                case "region":
                {
                    var region = new RenderRegion(
                        ReqString(attachment, "path"),
                        ReqNumber(attachment, "x"),
                        ReqNumber(attachment, "y"),
                        ReqNumber(attachment, "rotation"),
                        ReqNumber(attachment, "scaleX"),
                        ReqNumber(attachment, "scaleY"),
                        ReqNumber(attachment, "width"),
                        ReqNumber(attachment, "height"),
                        ReadColor(attachment.Member("color")));
                    return RenderAttachment.OfRegion(region, ReadSequence(attachment));
                }

                case "mesh":
                {
                    var mesh = new RenderMesh(
                        ReqString(attachment, "path"),
                        ReqNumberArray(attachment, "uvs"),
                        ReqIntArray(attachment, "triangles"),
                        ReadColor(attachment.Member("color")));
                    return RenderAttachment.OfMesh(mesh, ReadSequence(attachment));
                }

                case "linkedmesh":
                {
                    JsonValue? skinValue = attachment.Member("skin");
                    string? skinName = skinValue == null || skinValue.IsNull ? null : skinValue.AsString();
                    return RenderAttachment.OfLinkedMesh(new RenderLinkedMesh(
                        ReqString(attachment, "path"),
                        ReqString(attachment, "parent"),
                        skinName,
                        ReadColor(attachment.Member("color"))));
                }

                default:
                    // clipping, boundingbox, point, path: geometry the solve reads for constraints/hit-testing
                    // but the renderer never draws. Recorded so the builder skips it explicitly.
                    return RenderAttachment.NonDrawing();
            }
        }

        // Read an optional sequence block (ADR-0009 section 3) off a region/mesh attachment, or null when
        // absent. count/setupIndex drive the solve's frame resolution; start/digits drive the renderer's
        // frame NAMING (RenderSequenceName). The solve core reads only count/setupIndex; a renderer needs
        // all four.
        private static RenderSequence? ReadSequence(JsonValue attachment)
        {
            JsonValue? sequenceValue = attachment.Member("sequence");
            if (sequenceValue == null || sequenceValue.Kind != JsonKind.Object)
            {
                return null;
            }

            return new RenderSequence(
                (int)ReqNumber(sequenceValue, "count"),
                (int)ReqNumber(sequenceValue, "setupIndex"),
                (int)ReqNumber(sequenceValue, "start"),
                (int)ReqNumber(sequenceValue, "digits"));
        }

        private static AtlasData ReadAtlas(JsonValue? atlasValue)
        {
            if (atlasValue == null || atlasValue.Kind != JsonKind.Object)
            {
                return AtlasData.Empty;
            }

            JsonValue? pagesValue = atlasValue.Member("pages");
            if (pagesValue == null || pagesValue.Kind != JsonKind.Array)
            {
                return AtlasData.Empty;
            }

            var pages = new List<AtlasPage>();
            foreach (JsonValue page in pagesValue.AsArray())
            {
                var regions = new List<AtlasRegion>();
                JsonValue? regionsValue = page.Member("regions");
                if (regionsValue != null && regionsValue.Kind == JsonKind.Array)
                {
                    foreach (JsonValue region in regionsValue.AsArray())
                    {
                        regions.Add(new AtlasRegion(
                            ReqString(region, "name"),
                            ReqNumber(region, "x"),
                            ReqNumber(region, "y"),
                            ReqNumber(region, "w"),
                            ReqNumber(region, "h"),
                            ReqBool(region, "rotated"),
                            ReqNumber(region, "offsetX"),
                            ReqNumber(region, "offsetY"),
                            ReqNumber(region, "originalW"),
                            ReqNumber(region, "originalH")));
                    }
                }

                pages.Add(new AtlasPage(
                    ReqString(page, "file"),
                    ReqNumber(page, "width"),
                    ReqNumber(page, "height"),
                    regions));
            }

            return new AtlasData(pages);
        }

        private static RenderColor ReadColor(JsonValue? color)
        {
            if (color == null || color.Kind != JsonKind.Object)
            {
                return RenderColor.White;
            }

            return new RenderColor(
                ReqNumber(color, "r"),
                ReqNumber(color, "g"),
                ReqNumber(color, "b"),
                ReqNumber(color, "a"));
        }

        private static JsonValue ReqMember(JsonValue obj, string key)
        {
            JsonValue? value = obj.Member(key);
            if (value == null)
            {
                throw new RenderModelReadException($"missing required member '{key}'");
            }

            return value;
        }

        private static JsonValue ReqObject(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.Object)
            {
                throw new RenderModelReadException($"member '{key}' must be an object");
            }

            return value;
        }

        private static string ReqString(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.String)
            {
                throw new RenderModelReadException($"member '{key}' must be a string");
            }

            return value.AsString();
        }

        private static double ReqNumber(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.Number)
            {
                throw new RenderModelReadException($"member '{key}' must be a number");
            }

            return value.AsNumber();
        }

        private static bool ReqBool(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.Bool)
            {
                throw new RenderModelReadException($"member '{key}' must be a boolean");
            }

            return value.AsBool();
        }

        private static double[] ReqNumberArray(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.Array)
            {
                throw new RenderModelReadException($"member '{key}' must be an array");
            }

            IReadOnlyList<JsonValue> items = value.AsArray();
            var result = new double[items.Count];
            for (int i = 0; i < items.Count; i += 1)
            {
                result[i] = items[i].AsNumber();
            }

            return result;
        }

        private static int[] ReqIntArray(JsonValue obj, string key)
        {
            JsonValue value = ReqMember(obj, key);
            if (value.Kind != JsonKind.Array)
            {
                throw new RenderModelReadException($"member '{key}' must be an array");
            }

            IReadOnlyList<JsonValue> items = value.AsArray();
            var result = new int[items.Count];
            for (int i = 0; i < items.Count; i += 1)
            {
                result[i] = (int)items[i].AsNumber();
            }

            return result;
        }
    }
}
