import type { SpinInput } from '../types';
import type { NativeResolveOutput } from './native';

// The NON-TRANSACTING resolve client (phase-4 WP-4.3, section 4.3). This interface exposes ONLY
// `resolve`: a deterministic, provably-fair resolution of a SpinInput that returns the engine's native
// output with NO wallet debit and NO ledger advance. There is deliberately NO transacting method here, so
// the adapter constructed with this client CANNOT perform a money operation (the money boundary is
// structural, not a runtime check). The transacting production spin is the game host's concern and is
// out of project.
export interface NonTransactingResolveClient {
  resolve(input: SpinInput): Promise<NativeResolveOutput>;
}
