import { validateSpinResult } from '@marionette/math-bridge';
import type { GridSize, SpinResult } from '@marionette/math-bridge';

// The committed slot SpinResult loader (phase-4-slot-composer.md WP-4.13). A committed spin json is the
// engine OUTCOME boundary value (LAW 1): it is validated ON LOAD via the math-bridge contract
// (validateSpinResult) at the pair's grid size (Law 3, fail loudly), so a malformed or mis-sized spin can
// never flow into the sequencer. We reuse the math-bridge validator (the one contract) rather than a
// parallel schema, exactly as the effects rig loader reuses parseEffectsDocument; a spin the engine boundary
// would reject can never be committed as a golden source.

export class SlotSpinValidationError extends Error {
  override readonly name = 'SlotSpinValidationError';
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`slot spin failed validation [${code}] at ${path}: ${message}`);
    this.code = code;
    this.path = path;
  }
}

// Validate a parsed spin json against the math-bridge boundary contract at the given grid size, throwing a
// typed error on any malformation (the loaders fail loudly, Law 3). Returns the validated SpinResult.
export function validateSlotSpin(input: unknown, gridSize: GridSize): SpinResult {
  const result = validateSpinResult(input, gridSize);
  if (!result.ok) {
    throw new SlotSpinValidationError(result.error.code, result.error.path, result.error.message);
  }
  return result.value;
}
