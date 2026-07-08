using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Marionette.Runtime.Core.Json
{
    // Thrown on malformed JSON. A typed error (never a bare throw) so a caller can report where parsing
    // failed. The reader fails loudly on any structural violation rather than guessing.
    public sealed class JsonParseException : Exception
    {
        public JsonParseException(string message)
            : base(message)
        {
        }
    }

    // A small recursive descent JSON parser (RFC 8259 value grammar). It is deliberate and dependency
    // free so the core needs no System.Text.Json (Unity compatibility). Numbers parse to double with the
    // invariant culture, which reproduces the exact IEEE-754 values the committed fixtures store (the
    // fixtures are V8 double literals such as 6.123233995736766e-17). Object member order is preserved.
    public static class JsonParser
    {
        public static JsonValue Parse(string text)
        {
            int index = 0;
            SkipWhitespace(text, ref index);
            JsonValue value = ParseValue(text, ref index);
            SkipWhitespace(text, ref index);
            if (index != text.Length)
            {
                throw new JsonParseException($"trailing characters at position {index}");
            }

            return value;
        }

        private static JsonValue ParseValue(string text, ref int index)
        {
            if (index >= text.Length)
            {
                throw new JsonParseException("unexpected end of input");
            }

            char c = text[index];
            switch (c)
            {
                case '{':
                    return ParseObject(text, ref index);
                case '[':
                    return ParseArray(text, ref index);
                case '"':
                    return JsonValue.OfString(ParseString(text, ref index));
                case 't':
                case 'f':
                    return ParseBool(text, ref index);
                case 'n':
                    ParseLiteral(text, ref index, "null");
                    return JsonValue.Null;
                default:
                    return ParseNumber(text, ref index);
            }
        }

        private static JsonValue ParseObject(string text, ref int index)
        {
            index += 1; // consume '{'
            var members = new List<KeyValuePair<string, JsonValue>>();
            SkipWhitespace(text, ref index);
            if (Peek(text, index) == '}')
            {
                index += 1;
                return JsonValue.OfObject(members);
            }

            while (true)
            {
                SkipWhitespace(text, ref index);
                if (Peek(text, index) != '"')
                {
                    throw new JsonParseException($"expected object key at position {index}");
                }

                string key = ParseString(text, ref index);
                SkipWhitespace(text, ref index);
                Expect(text, ref index, ':');
                SkipWhitespace(text, ref index);
                JsonValue value = ParseValue(text, ref index);
                members.Add(new KeyValuePair<string, JsonValue>(key, value));
                SkipWhitespace(text, ref index);
                char next = Peek(text, index);
                if (next == ',')
                {
                    index += 1;
                    continue;
                }

                if (next == '}')
                {
                    index += 1;
                    return JsonValue.OfObject(members);
                }

                throw new JsonParseException($"expected ',' or '}}' at position {index}");
            }
        }

        private static JsonValue ParseArray(string text, ref int index)
        {
            index += 1; // consume '['
            var items = new List<JsonValue>();
            SkipWhitespace(text, ref index);
            if (Peek(text, index) == ']')
            {
                index += 1;
                return JsonValue.OfArray(items);
            }

            while (true)
            {
                SkipWhitespace(text, ref index);
                items.Add(ParseValue(text, ref index));
                SkipWhitespace(text, ref index);
                char next = Peek(text, index);
                if (next == ',')
                {
                    index += 1;
                    continue;
                }

                if (next == ']')
                {
                    index += 1;
                    return JsonValue.OfArray(items);
                }

                throw new JsonParseException($"expected ',' or ']' at position {index}");
            }
        }

        private static string ParseString(string text, ref int index)
        {
            index += 1; // consume opening quote
            var builder = new StringBuilder();
            while (true)
            {
                if (index >= text.Length)
                {
                    throw new JsonParseException("unterminated string");
                }

                char c = text[index];
                index += 1;
                if (c == '"')
                {
                    return builder.ToString();
                }

                if (c == '\\')
                {
                    if (index >= text.Length)
                    {
                        throw new JsonParseException("unterminated escape");
                    }

                    char escape = text[index];
                    index += 1;
                    switch (escape)
                    {
                        case '"':
                            builder.Append('"');
                            break;
                        case '\\':
                            builder.Append('\\');
                            break;
                        case '/':
                            builder.Append('/');
                            break;
                        case 'b':
                            builder.Append('\b');
                            break;
                        case 'f':
                            builder.Append('\f');
                            break;
                        case 'n':
                            builder.Append('\n');
                            break;
                        case 'r':
                            builder.Append('\r');
                            break;
                        case 't':
                            builder.Append('\t');
                            break;
                        case 'u':
                            builder.Append(ParseUnicodeEscape(text, ref index));
                            break;
                        default:
                            throw new JsonParseException($"invalid escape '\\{escape}'");
                    }
                }
                else
                {
                    builder.Append(c);
                }
            }
        }

        private static char ParseUnicodeEscape(string text, ref int index)
        {
            if (index + 4 > text.Length)
            {
                throw new JsonParseException("truncated unicode escape");
            }

            string hex = text.Substring(index, 4);
            index += 4;
            if (!ushort.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out ushort code))
            {
                throw new JsonParseException($"invalid unicode escape '{hex}'");
            }

            return (char)code;
        }

        private static JsonValue ParseBool(string text, ref int index)
        {
            if (text[index] == 't')
            {
                ParseLiteral(text, ref index, "true");
                return JsonValue.OfBool(true);
            }

            ParseLiteral(text, ref index, "false");
            return JsonValue.OfBool(false);
        }

        private static JsonValue ParseNumber(string text, ref int index)
        {
            int start = index;
            if (Peek(text, index) == '-')
            {
                index += 1;
            }

            while (index < text.Length)
            {
                char c = text[index];
                bool isNumberChar = (c >= '0' && c <= '9')
                    || c == '.'
                    || c == 'e'
                    || c == 'E'
                    || c == '+'
                    || c == '-';
                if (!isNumberChar)
                {
                    break;
                }

                index += 1;
            }

            string token = text.Substring(start, index - start);
            if (token.Length == 0)
            {
                throw new JsonParseException($"expected value at position {start}");
            }

            if (!double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
            {
                throw new JsonParseException($"invalid number '{token}'");
            }

            return JsonValue.OfNumber(value);
        }

        private static void ParseLiteral(string text, ref int index, string literal)
        {
            if (index + literal.Length > text.Length
                || text.Substring(index, literal.Length) != literal)
            {
                throw new JsonParseException($"expected '{literal}' at position {index}");
            }

            index += literal.Length;
        }

        private static void SkipWhitespace(string text, ref int index)
        {
            while (index < text.Length)
            {
                char c = text[index];
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r')
                {
                    index += 1;
                }
                else
                {
                    break;
                }
            }
        }

        private static char Peek(string text, int index) =>
            index < text.Length ? text[index] : '\0';

        private static void Expect(string text, ref int index, char expected)
        {
            if (Peek(text, index) != expected)
            {
                throw new JsonParseException($"expected '{expected}' at position {index}");
            }

            index += 1;
        }
    }
}
