using System.Collections.Generic;

namespace Marionette.Runtime.Core.Json
{
    // A minimal, dependency free JSON value model. It exists so the core carries NO third party JSON
    // package (Unity compatibility, ADR-0001): the rig reader and the test harness both parse through
    // this. Object member order is PRESERVED (a List, not a Dictionary), because the TS solve iterates
    // Object.keys() in insertion order when preparing animations, and the port must iterate identically.
    public enum JsonKind
    {
        Null,
        Bool,
        Number,
        String,
        Array,
        Object,
    }

    public sealed class JsonValue
    {
        public JsonKind Kind { get; }

        private readonly bool _boolValue;
        private readonly double _numberValue;
        private readonly string? _stringValue;
        private readonly List<JsonValue>? _arrayValue;
        private readonly List<KeyValuePair<string, JsonValue>>? _objectValue;

        private JsonValue(
            JsonKind kind,
            bool boolValue,
            double numberValue,
            string? stringValue,
            List<JsonValue>? arrayValue,
            List<KeyValuePair<string, JsonValue>>? objectValue)
        {
            Kind = kind;
            _boolValue = boolValue;
            _numberValue = numberValue;
            _stringValue = stringValue;
            _arrayValue = arrayValue;
            _objectValue = objectValue;
        }

        public static readonly JsonValue Null =
            new JsonValue(JsonKind.Null, false, 0, null, null, null);

        public static JsonValue OfBool(bool value) =>
            new JsonValue(JsonKind.Bool, value, 0, null, null, null);

        public static JsonValue OfNumber(double value) =>
            new JsonValue(JsonKind.Number, false, value, null, null, null);

        public static JsonValue OfString(string value) =>
            new JsonValue(JsonKind.String, false, 0, value, null, null);

        public static JsonValue OfArray(List<JsonValue> value) =>
            new JsonValue(JsonKind.Array, false, 0, null, value, null);

        public static JsonValue OfObject(List<KeyValuePair<string, JsonValue>> value) =>
            new JsonValue(JsonKind.Object, false, 0, null, null, value);

        public bool AsBool() => _boolValue;

        public double AsNumber() => _numberValue;

        public string AsString() => _stringValue!;

        public IReadOnlyList<JsonValue> AsArray() => _arrayValue!;

        public IReadOnlyList<KeyValuePair<string, JsonValue>> Members() => _objectValue!;

        public bool IsNull => Kind == JsonKind.Null;

        // Look up an object member by key, or return null when absent. The seven rigs use only a small,
        // known field set, so the reader treats presence as optional where the TS document model does.
        public JsonValue? Member(string key)
        {
            if (_objectValue == null)
            {
                return null;
            }

            for (int i = 0; i < _objectValue.Count; i += 1)
            {
                if (_objectValue[i].Key == key)
                {
                    return _objectValue[i].Value;
                }
            }

            return null;
        }
    }
}
