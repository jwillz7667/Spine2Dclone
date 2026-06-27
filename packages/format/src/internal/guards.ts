// Shared structural type guards used by the validator and the canonicalizer. Narrowing `unknown`
// through these guards keeps the package free of `as` casts (INV-4): a guarded value is typed by
// the compiler, never asserted.

// True for a plain object (not null, not an array). Narrows to an index-accessible record.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
