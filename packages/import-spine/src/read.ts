import type { Diagnostics } from './diagnostics';

// Safe readers over an unknown JSON value. The Spine input arrives as `unknown` (it crosses a file or
// IPC boundary), so every field access is validated at the boundary (fail-fast, house rule): a wrong
// JSON shape records a SPINE_SCHEMA error against the exact input path and the reader returns the
// documented default (or undefined) so the conversion can continue collecting further faults rather
// than aborting on the first one. Internal converters trust the typed values these return.

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Append a segment to a JSON-Pointer-style path. The root path is the empty string, so the first
// segment yields "/segment" and nesting yields "/a/b/2".
export function ptr(base: string, segment: string | number): string {
  return `${base}/${segment}`;
}

// Coerce a value to a record, recording SPINE_SCHEMA and returning undefined when it is not one.
export function asRecord(value: unknown, path: string, diag: Diagnostics): JsonRecord | undefined {
  if (isRecord(value)) return value;
  diag.error('SPINE_SCHEMA', path, `expected a JSON object at ${path || '(root)'}`);
  return undefined;
}

// Coerce a value to an array, recording SPINE_SCHEMA and returning undefined when it is not one.
export function asArray(value: unknown, path: string, diag: Diagnostics): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  diag.error('SPINE_SCHEMA', path, `expected a JSON array at ${path || '(root)'}`);
  return undefined;
}

// Read a string field. When absent, returns `fallback`. When present but not a string, records
// SPINE_SCHEMA and returns `fallback`.
export function readString(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
  fallback: string,
): string {
  const value = rec[key];
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value;
  diag.error('SPINE_SCHEMA', ptr(base, key), `field "${key}" must be a string`);
  return fallback;
}

// Read an optional string field. Absent yields undefined; a non-string records SPINE_SCHEMA.
export function readOptionalString(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
): string | undefined {
  const value = rec[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  diag.error('SPINE_SCHEMA', ptr(base, key), `field "${key}" must be a string`);
  return undefined;
}

// Read a REQUIRED string field. Absent OR non-string records SPINE_SCHEMA and returns undefined.
export function readRequiredString(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
): string | undefined {
  const value = rec[key];
  if (typeof value === 'string') return value;
  diag.error(
    'SPINE_SCHEMA',
    ptr(base, key),
    value === undefined ? `required field "${key}" is missing` : `field "${key}" must be a string`,
  );
  return undefined;
}

// Read a finite number field. Absent yields `fallback`; a non-finite-number records SPINE_SCHEMA.
export function readNumber(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
  fallback: number,
): number {
  const value = rec[key];
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  diag.error('SPINE_SCHEMA', ptr(base, key), `field "${key}" must be a finite number`);
  return fallback;
}

// Read an optional finite number field. Absent yields undefined; a non-finite-number records
// SPINE_SCHEMA.
export function readOptionalNumber(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
): number | undefined {
  const value = rec[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  diag.error('SPINE_SCHEMA', ptr(base, key), `field "${key}" must be a finite number`);
  return undefined;
}

// Read a boolean field. Absent yields `fallback`; a non-boolean records SPINE_SCHEMA.
export function readBoolean(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
  fallback: boolean,
): boolean {
  const value = rec[key];
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  diag.error('SPINE_SCHEMA', ptr(base, key), `field "${key}" must be a boolean`);
  return fallback;
}

// Read a flat array of finite numbers at `path`. A non-array, or any non-finite-number element,
// records SPINE_SCHEMA; a valid array returns its numbers, an absent value returns [].
export function readNumberArrayField(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
): number[] {
  const value = rec[key];
  if (value === undefined) return [];
  const path = ptr(base, key);
  const array = asArray(value, path, diag);
  if (array === undefined) return [];
  const out: number[] = [];
  for (const [index, element] of array.entries()) {
    if (typeof element === 'number' && Number.isFinite(element)) {
      out.push(element);
    } else {
      diag.error('SPINE_SCHEMA', ptr(path, index), 'expected a finite number');
    }
  }
  return out;
}

// Read a flat array of strings at `path`. A non-array, or any non-string element, records SPINE_SCHEMA;
// an absent value returns [].
export function readStringArrayField(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
): string[] {
  const value = rec[key];
  if (value === undefined) return [];
  const path = ptr(base, key);
  const array = asArray(value, path, diag);
  if (array === undefined) return [];
  const out: string[] = [];
  for (const [index, element] of array.entries()) {
    if (typeof element === 'string') {
      out.push(element);
    } else {
      diag.error('SPINE_SCHEMA', ptr(path, index), 'expected a string');
    }
  }
  return out;
}
