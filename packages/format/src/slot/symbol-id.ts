import { z } from 'zod';

// CD-1 (format-contract section 15.2/15.3): the authored symbol-vocabulary brand lives in `format`, not
// `math-bridge`. `math-bridge` MAY import `format` (so a `SpinResult` cell is typed as `SymbolId`), but
// `format` never imports `math-bridge`. Placing `SymbolId` here is the only direction-correct choice:
// putting it in `math-bridge` would force `format` to depend on the outcome package, which is forbidden.
//
// A `SymbolId` is a string brand. The brand is phantom (type-system only, never present at runtime); the
// concrete VALUES a math model emits are engine metadata supplied by `math-bridge` as a `SymbolVocabulary`.
// This is the authored-side TYPE; the values are not authored.

// The brand is a string-literal property (format-contract section 15.3: `{ __brand: 'SymbolId' }`),
// NOT a `unique symbol`. A literal-keyed brand is nameable across the package boundary, so the inferred
// Zod schema types (consumed by math-bridge) emit clean .d.ts; a `unique symbol` brand cannot be named
// in an exported declaration and breaks the composite build.
export type SymbolId = string & { readonly __brand: 'SymbolId' };

// The SINGLE sanctioned brand point. A validated non-empty string IS a SymbolId; the phantom brand
// exists only in the type system (INV-4 explicitly permits the documented brand cast, identical
// discipline to the skeletal id factory). Funnelling both the schema transform and the literal helper
// through one expression keeps the cast in exactly one place.
// eslint-disable-next-line no-restricted-syntax -- documented brand construction (phantom brand, INV-4)
const brand = (value: string): SymbolId => value as SymbolId;

// A non-empty string is a valid SymbolId at the boundary; the per-model vocabulary (which ids are known)
// is a separate, math-bridge-owned check (R4.10), not a format-level constraint.
export const symbolIdSchema = z.string().min(1).transform(brand);

// Construct a SymbolId from a known string (authoring/test helper). Callers that already hold a validated
// id use it directly; this is the single sanctioned brand point for literals.
export function symbolId(value: string): SymbolId {
  return brand(value);
}
