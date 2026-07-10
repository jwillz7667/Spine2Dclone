import { z } from 'zod';
import type { NativeResolveOutput } from './native';

// Zod schema for the certified engine's NATIVE non-transacting resolve output (WP-5.8). The HTTP
// transport validates the decoded response body against this schema BEFORE the adapter projects it into a
// SpinResult, so a malformed engine payload fails loudly at the boundary (LAW 3) and never escapes as a
// partial result. The shape mirrors native.ts field-for-field; a compile-time assertion below proves the
// inferred type equals the hand-written NativeResolveOutput interface, so the two cannot drift.
//
// Unknown TOP-LEVEL keys are stripped (not rejected): the engine's payload is versioned and owned by the
// certified engine, so it may carry fields we do not project. We validate exactly the fields the adapter
// consumes and ignore the rest; the PROJECTED SpinResult is then strictly validated (validateSpinResult),
// so nothing malformed reaches presentation. The consumed fields ARE strictly typed (a wrong-typed board,
// a missing `total`, a non-finite number are rejected here).

// Native numbers must be finite (reject NaN/Infinity from a malformed engine payload).
const finite = z.number().finite();
const nativeSymbol = z.string();
const cell = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);
const board = z.array(z.array(nativeSymbol));

const nativeCascadeSchema = z.object({
  removedCells: z.array(cell),
  fill: z.array(
    z.object({ column: z.number().int().nonnegative(), pieces: z.array(nativeSymbol) }),
  ),
  winThisStep: finite,
  runningTotal: finite.optional(),
});

export const nativeResolveOutputSchema = z.object({
  id: z.string().min(1),
  stake: finite,
  boardFinal: board,
  boardInitial: board.optional(),
  paylines: z.array(
    z.object({
      sym: nativeSymbol,
      cells: z.array(cell),
      pay: finite,
      line: z.number().int().nonnegative().optional(),
    }),
  ),
  bonuses: z.array(
    z.object({
      kind: z.string(),
      payload: z.record(z.string(), z.union([finite, z.string(), z.boolean(), z.array(finite)])),
    }),
  ),
  tumbles: z.array(nativeCascadeSchema).optional(),
  total: finite,
  proof: z.string().optional(),
});

// Compile-time proof the schema cannot silently drop or mistype a field the adapter projects: the parsed
// output must be assignable to the NativeResolveOutput interface. Dropping `total`, mistyping a board, or
// renaming a consumed field flips this constant's type to `false` and breaks the build. (The check is
// one-directional because the schema yields mutable arrays while the interface is readonly, and
// mutable-to-readonly is the assignable direction; a mutable value satisfies every readonly consumer,
// which is exactly what the adapter needs.)
type SchemaOutput = z.infer<typeof nativeResolveOutputSchema>;
type SchemaAssignableToInterface = SchemaOutput extends NativeResolveOutput ? true : false;
export const NATIVE_SCHEMA_MATCHES_INTERFACE: SchemaAssignableToInterface = true;
