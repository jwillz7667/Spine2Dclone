import { isRecord } from '../internal/guards';

// Deterministic canonical JSON (format-contract section 9.2): object keys sorted ascending
// (including Record maps), array order preserved (array order is semantic in this format), numbers
// via standard JS formatting (-0 serializes as 0), and one self-referential field optionally removed
// at the document root (the `hash` field cannot hash itself). Non-finite numbers cannot occur here:
// the document is validated (every number is finite) before it is ever hashed.
//
// Serialize one object's members with keys sorted ascending, skipping any key whose value is
// undefined. Skipping undefined mirrors JSON.stringify (which drops undefined-valued keys), so a
// document with an explicit `darkColor: undefined` hashes identically to one where the key is absent
// (format-contract section 9.2: no undefined leakage). `omitKey`, when given, is also skipped (used
// to exclude the self-referential `hash` field).
function serializeObject(value: Record<string, unknown>, omitKey: string | null): string {
  const keys = Object.keys(value)
    .filter((key) => key !== omitKey && value[key] !== undefined)
    .sort();
  const members = keys.map((key) => `${JSON.stringify(key)}:${stringify(value[key])}`);
  return `{${members.join(',')}}`;
}

// Primitives delegate to JSON.stringify, which already produces canonical output and normalizes -0
// to 0; only objects (key sorting, undefined skipping) and arrays (recurse, preserve order) need
// custom handling.
function stringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((element) => stringify(element)).join(',')}]`;
  }
  if (isRecord(value)) {
    return serializeObject(value, null);
  }
  // Object keys with undefined values are skipped above; a standalone undefined only reaches here as
  // an array element, where JSON.stringify emits null. Validated documents never contain either.
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

// Canonicalize a record, removing one top-level key before serialization. Used to exclude the
// self-referential `hash` field from its own digest.
export function canonicalJsonExcludingKey(value: Record<string, unknown>, omitKey: string): string {
  return serializeObject(value, omitKey);
}
