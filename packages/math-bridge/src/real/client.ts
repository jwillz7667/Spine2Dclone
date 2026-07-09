import type { SpinInput } from '../types';
import type { NativeResolveOutput } from './native';

// Per-call resolve options (WP-5.8). `signal` lets a host cancel an in-flight resolve (process shutdown,
// a superseded preview request). It is OPTIONAL so a client that ignores cancellation (the mock, an
// in-memory fake) still satisfies the interface; a transport that honors it aborts the underlying request.
export interface RealResolveOptions {
  readonly signal?: AbortSignal;
}

// The NON-TRANSACTING resolve client (phase-4 WP-4.3, section 4.3). This interface exposes ONLY
// `resolve`: a deterministic, provably-fair resolution of a SpinInput that returns the engine's native
// output with NO wallet debit and NO ledger advance. There is deliberately NO transacting method here, so
// the adapter constructed with this client CANNOT perform a money operation (the money boundary is
// structural, not a runtime check). The transacting production spin is the game host's concern and is
// out of project. `options` is optional so widening it never breaks an existing single-argument client.
export interface NonTransactingResolveClient {
  resolve(input: SpinInput, options?: RealResolveOptions): Promise<NativeResolveOutput>;
}
