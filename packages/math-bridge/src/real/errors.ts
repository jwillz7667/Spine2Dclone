// Typed transport failures for the HTTP non-transacting resolve (WP-5.8). Following the MathBridgeError /
// RealEngineMappingError pattern: a named error class carrying a discriminated `code` (never a bare
// string), the originating `cause`, and, for HTTP failures, the `status`. Every distinct cause the
// transport can hit has its own code so a host can branch (surface, alert, retry, fail) on the exact
// reason. `validation-failed` is deliberately NOT here: a mapped-but-invalid SpinResult is the adapter's
// RealEngineMappingError('validation'), so the two layers keep distinct error surfaces.

export type RealEngineTransportErrorCode =
  // The fetch itself rejected (DNS failure, connection refused, TLS error, socket reset). Transient +
  // safe to retry (the resolve is non-transacting, so a repeat has no side effect).
  | 'network'
  // The per-attempt timeout fired and aborted the request. Transient + safe to retry.
  | 'timeout'
  // The caller's AbortSignal fired (host shutdown, superseded request). NOT retried: the caller asked to
  // stop.
  | 'aborted'
  // HTTP 4xx other than 429. A deterministic client-side fault (bad URL, bad auth, bad request); retrying
  // the identical request cannot help, so it is NOT retried.
  | 'httpClientError'
  // HTTP 429. The engine asked us to back off; safe to retry with backoff (idempotent resolve).
  | 'httpRateLimited'
  // HTTP 5xx. A transient server fault; safe to retry with backoff.
  | 'httpServerError'
  // A status outside 2xx/4xx/5xx (a 1xx/3xx from a resolve endpoint is a misconfiguration). NOT retried.
  | 'httpUnexpectedStatus'
  // The 2xx response body was not valid JSON. Deterministic for this response; NOT retried.
  | 'malformedBody'
  // The decoded JSON failed the native-output schema. Deterministic for this response; NOT retried.
  | 'schemaInvalid';

export interface RealEngineTransportErrorOptions {
  readonly cause?: unknown;
  readonly status?: number;
  readonly detail?: unknown;
}

export class RealEngineTransportError extends Error {
  readonly code: RealEngineTransportErrorCode;
  readonly status?: number;
  readonly detail?: unknown;

  constructor(
    code: RealEngineTransportErrorCode,
    message: string,
    options: RealEngineTransportErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RealEngineTransportError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

// The ONLY codes safe to retry: transient faults on a NON-TRANSACTING (idempotent, no wallet debit, no
// ledger advance, section 4.3) resolve. Repeating such a resolve yields the same deterministic outcome and
// causes no side effect, so a bounded retry cannot double-charge or corrupt state. Deterministic faults
// (4xx, malformed/invalid body, unexpected status) and caller cancellation (`aborted`) are never retried.
const RETRYABLE_CODES: ReadonlySet<RealEngineTransportErrorCode> = new Set([
  'network',
  'timeout',
  'httpRateLimited',
  'httpServerError',
]);

export function isRetryableTransportError(error: RealEngineTransportError): boolean {
  return RETRYABLE_CODES.has(error.code);
}
