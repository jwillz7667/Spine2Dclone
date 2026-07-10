import { spinInputSchema } from '../schema';
import type { MathEngine, SpinInput } from '../types';
import type { GridSize } from '../validate';
import { RealEngineAdapter } from './adapter';
import type { SymbolMap } from './adapter';
import type { NonTransactingResolveClient, RealResolveOptions } from './client';
import type { NativeResolveOutput } from './native';
import { nativeResolveOutputSchema } from './native-schema';
import { parseHttpTransportConfig } from './http-config';
import type { HttpTransportConfig } from './http-config';
import { isRetryableTransportError, RealEngineTransportError } from './errors';

// The concrete HTTP transport for the certified engine's NON-TRANSACTING resolve (WP-5.8). It implements
// NonTransactingResolveClient, so a RealEngineAdapter wrapping it is a drop-in swap for MockMathEngine
// behind the MathEngine interface. It is isomorphic: it uses the global `fetch` and `AbortController`
// (both present in browsers and Node 18+), never a Node-only API, and every ambient dependency (fetch,
// backoff sleep, jitter source) is injectable so the whole path is unit-testable with no real I/O and no
// wall-clock. LAW 1: it moves an opaque SpinInput to the engine and returns the engine's native output
// verbatim (validated on receipt); it invents no outcome and reads no RNG that affects the result (the
// only randomness, retry jitter, affects scheduling ONLY, never the resolved value).

// The request the transport hands to the fetch implementation. The transport is POST-only against a
// single resolve endpoint; the fetch adapter decides how to issue it.
export interface HttpResolveRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

// The minimal response surface the transport reads. Keeping it structural (not the global Response) makes
// the injected fake trivial and decouples the transport from any one fetch typing.
export interface HttpResolveResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type ResolveFetch = (request: HttpResolveRequest) => Promise<HttpResolveResponse>;

export interface HttpResolveDeps {
  // The fetch implementation. Defaults to a wrapper over the global `fetch`.
  readonly fetch?: ResolveFetch;
  // Backoff sleep. Injected so tests resolve instantly and never touch a real timer. Defaults to a
  // setTimeout-based delay.
  readonly sleep?: (ms: number) => Promise<void>;
  // Jitter source in [0, 1). Injected so backoff is deterministic under test. Defaults to Math.random.
  // This influences retry TIMING only; it never touches the resolved SpinResult (LAW 1).
  readonly random?: () => number;
  // Map an engine JSON payload to the native output shape before schema validation. Defaults to identity.
  // A future integrator whose engine uses different field names supplies the mapping here (see README).
  readonly decodeResponse?: (json: unknown) => unknown;
  // Map a SpinInput to the request-body JSON value before serialization. Defaults to identity (the
  // SpinInput is sent as-is). A future integrator whose engine expects a different envelope maps it here.
  readonly encodeRequest?: (input: SpinInput) => unknown;
}

// Wrap the ambient global `fetch` into a ResolveFetch. Throws at construction if no global fetch exists
// and none was injected (fail fast rather than at the first request).
export function createGlobalResolveFetch(fetchImpl: typeof fetch = globalThis.fetch): ResolveFetch {
  if (typeof fetchImpl !== 'function') {
    throw new RealEngineTransportError(
      'network',
      'no global fetch is available; inject a ResolveFetch via HttpResolveDeps.fetch.',
    );
  }
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: { ...request.headers },
      body: request.body,
      signal: request.signal,
    });
    return { status: response.status, text: () => response.text() };
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Classify a completed HTTP status into either a success (undefined) or a typed transport error.
function classifyStatus(status: number): RealEngineTransportError | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 429) {
    return new RealEngineTransportError('httpRateLimited', `engine returned HTTP ${status}`, {
      status,
    });
  }
  if (status >= 400 && status < 500) {
    return new RealEngineTransportError('httpClientError', `engine returned HTTP ${status}`, {
      status,
    });
  }
  if (status >= 500 && status < 600) {
    return new RealEngineTransportError('httpServerError', `engine returned HTTP ${status}`, {
      status,
    });
  }
  return new RealEngineTransportError('httpUnexpectedStatus', `engine returned HTTP ${status}`, {
    status,
  });
}

export class HttpResolveClient implements NonTransactingResolveClient {
  private readonly config: HttpTransportConfig;
  private readonly fetchImpl: ResolveFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly decodeResponse: (json: unknown) => unknown;
  private readonly encodeRequest: (input: SpinInput) => unknown;

  constructor(config: HttpTransportConfig, deps: HttpResolveDeps = {}) {
    this.config = config;
    this.fetchImpl = deps.fetch ?? createGlobalResolveFetch();
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.decodeResponse = deps.decodeResponse ?? ((json) => json);
    this.encodeRequest = deps.encodeRequest ?? ((input) => input);
  }

  // Resolve a spin over HTTP with bounded, jittered-backoff retry on transient+safe causes only. Returns
  // the schema-validated native output; throws a typed RealEngineTransportError otherwise.
  async resolve(input: SpinInput, options?: RealResolveOptions): Promise<NativeResolveOutput> {
    // Validate the outbound input at the boundary so a malformed SpinInput never leaves the process.
    const parsedInput = spinInputSchema.safeParse(input);
    if (!parsedInput.success) {
      const issue = parsedInput.error.issues[0];
      throw new RealEngineTransportError(
        'schemaInvalid',
        `outbound SpinInput failed validation at /${issue?.path.join('/') ?? ''}: ${issue?.message ?? 'invalid'}`,
        { detail: parsedInput.error.issues },
      );
    }
    const body = JSON.stringify(this.encodeRequest(parsedInput.data));

    const { maxRetries, baseDelayMs, maxDelayMs } = this.config.retry;
    let lastError: RealEngineTransportError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.attempt(body, options?.signal);
      } catch (error) {
        if (!(error instanceof RealEngineTransportError)) throw error;
        lastError = error;
        // A non-retryable cause (4xx, malformed/invalid body, unexpected status, caller abort) fails
        // immediately. A retryable cause on the last attempt also fails.
        if (!isRetryableTransportError(error) || attempt === maxRetries) throw error;
        // Full-jitter exponential backoff, bounded by maxDelayMs. Jitter (scheduling only, LAW 1 safe)
        // spreads retries so a fleet does not synchronize its retry storm.
        const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        await this.sleep(Math.floor(this.random() * ceiling));
      }
    }
    // Unreachable: the loop either returns or throws. Guard for the type checker.
    throw (
      lastError ??
      new RealEngineTransportError('network', 'resolve exhausted with no error recorded')
    );
  }

  // One HTTP attempt: enforce the per-attempt timeout and caller abort, issue the request, classify the
  // status, and parse + schema-validate the body. Every failure is a typed RealEngineTransportError.
  private async attempt(body: string, externalSignal?: AbortSignal): Promise<NativeResolveOutput> {
    if (externalSignal?.aborted) {
      throw new RealEngineTransportError('aborted', 'resolve aborted by caller before dispatch');
    }
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = (): void => controller.abort();
    if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    let response: HttpResolveResponse;
    try {
      response = await this.fetchImpl({
        url: this.config.baseUrl,
        method: 'POST',
        headers: this.buildHeaders(),
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) {
        throw new RealEngineTransportError(
          'timeout',
          `resolve exceeded the ${this.config.timeoutMs}ms per-attempt timeout`,
          { cause },
        );
      }
      if (externalSignal?.aborted) {
        throw new RealEngineTransportError('aborted', 'resolve aborted by caller', { cause });
      }
      throw new RealEngineTransportError('network', 'resolve request failed', { cause });
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }

    const statusError = classifyStatus(response.status);
    if (statusError) throw statusError;

    return this.parseBody(response);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.config.authHeader) headers[this.config.authHeader.name] = this.config.authHeader.value;
    return headers;
  }

  // Parse the 2xx body as JSON, decode it, and validate it against the native-output schema. A body that
  // is not JSON is `malformedBody`; a body that does not match the schema is `schemaInvalid`. Neither ever
  // escapes as a partial result: the method returns only a fully-validated NativeResolveOutput.
  private async parseBody(response: HttpResolveResponse): Promise<NativeResolveOutput> {
    const raw = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new RealEngineTransportError(
        'malformedBody',
        'engine response body is not valid JSON',
        {
          cause,
        },
      );
    }
    const parsed = nativeResolveOutputSchema.safeParse(this.decodeResponse(json));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new RealEngineTransportError(
        'schemaInvalid',
        `engine response failed native-output validation at /${issue?.path.join('/') ?? ''}: ${issue?.message ?? 'invalid'}`,
        { detail: parsed.error.issues },
      );
    }
    return parsed.data;
  }
}

export interface CreateRealHttpEngineParams {
  // Raw or already-validated HTTP transport config. A raw object is validated via parseHttpTransportConfig
  // (fail fast on malformed config, LAW 3).
  readonly config: unknown;
  // The grid dimensions the mapped SpinResult is validated against (validateSpinResult).
  readonly gridSize: GridSize;
  // Optional native-symbol-code to canonical-id remap (identity by default).
  readonly symbolMap?: SymbolMap;
  // Optional transport dependency overrides (fetch, sleep, jitter, request/response codecs).
  readonly deps?: HttpResolveDeps;
}

// The integrator entrypoint (WP-5.8): validate the transport config, build the HTTP resolve client, and
// wrap it in the RealEngineAdapter so the returned value is a plain MathEngine, swappable with
// MockMathEngine at the call site. This is the ONLY function a host needs to stand up the real engine.
export function createRealHttpEngine(params: CreateRealHttpEngineParams): MathEngine {
  const config = parseHttpTransportConfig(params.config);
  const client = new HttpResolveClient(config, params.deps ?? {});
  return new RealEngineAdapter(client, params.gridSize, params.symbolMap ?? ((s) => s));
}
