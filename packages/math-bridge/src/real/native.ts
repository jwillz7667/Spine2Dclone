// The certified engine's NATIVE non-transacting resolve output shape (phase-4 WP-4.3). This is a
// PLACEHOLDER model of the engine's own field names (distinct from our SpinResult) so the adapter's job
// is a real PROJECTION, not a rename. The live engine is wired in WP-4.14; here the shape is fixed so the
// mapping + its money-boundary and consistency guards are unit-testable against a stubbed client.
//
// `boardInitial` and a per-cascade `runningTotal` are OPTIONAL: a real engine that does not expose the
// pre-cascade board or the per-step authoritative running total triggers the adapter's typed
// unavailable errors (phase-4 section 5.5/5.6) rather than the adapter fabricating them (LAW 1).

export interface NativeCascade {
  // [row, col] cells removed at this step.
  readonly removedCells: readonly (readonly [number, number])[];
  // Per-column top-down refill pieces (native symbol codes).
  readonly fill: readonly { readonly column: number; readonly pieces: readonly string[] }[];
  readonly winThisStep: number;
  // The engine's authoritative running total through this step. OPTIONAL: absence is a typed error for a
  // cascade result (the adapter never synthesizes it).
  readonly runningTotal?: number;
}

export interface NativeResolveOutput {
  readonly id: string;
  readonly stake: number;
  // The final (post-cascade) board, native symbol codes, rows of columns.
  readonly boardFinal: readonly (readonly string[])[];
  // The pre-cascade board. OPTIONAL: required only for a genuine cascade result (else a typed error).
  readonly boardInitial?: readonly (readonly string[])[];
  readonly paylines: readonly {
    readonly sym: string;
    readonly cells: readonly (readonly [number, number])[];
    readonly pay: number;
    readonly line?: number;
  }[];
  readonly bonuses: readonly {
    readonly kind: string;
    readonly payload: Readonly<Record<string, number | string | boolean | readonly number[]>>;
  }[];
  readonly tumbles?: readonly NativeCascade[];
  readonly total: number;
  readonly proof?: string;
}
