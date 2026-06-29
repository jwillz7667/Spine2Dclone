import type { z } from 'zod';
import type {
  cascadeStepSchema,
  featureEventSchema,
  spinInputSchema,
  spinResultSchema,
  spinSeedSchema,
  winLineSchema,
} from './schema';

// The engine boundary TYPES, inferred from the Zod schemas (single source of truth, WP-4.1 TASK-4.1.1).
// Available at `@marionette/math-bridge/types` (zero runtime). These are runtime engine output; they are
// validated on receipt, NEVER serialized into a document, and NEVER authored (LAW 1). A board cell is a
// `SymbolId` (CD-1: the brand lives in `format`).

export type SpinSeed = z.infer<typeof spinSeedSchema>;
export type SpinInput = z.infer<typeof spinInputSchema>;
export type WinLine = z.infer<typeof winLineSchema>;
export type FeatureEvent = z.infer<typeof featureEventSchema>;
export type CascadeStep = z.infer<typeof cascadeStepSchema>;
export type SpinResult = z.infer<typeof spinResultSchema>;

// The NON-TRANSACTING resolve interface (phase-4 section 4.3, 5.1). `spin` is a deterministic,
// provably-fair resolution of a `SpinInput` (seed) returning a `SpinResult` with NO wallet debit and NO
// ledger advance. It is a pure read of "what would this seed produce", not a bet. Shape is identical for
// the mock and the real adapter; the scenario is a mock CONSTRUCTOR argument, never part of `SpinInput`.
export interface MathEngine {
  spin(input: SpinInput): Promise<SpinResult>;
}
