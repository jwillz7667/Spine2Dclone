import { afterEach, describe, expect, it, vi } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import {
  createGlobalResolveFetch,
  createRealHttpEngine,
  HttpResolveClient,
  isRetryableTransportError,
  parseHttpTransportConfig,
  RealEngineConfigError,
  RealEngineMappingError,
  RealEngineTransportError,
} from '../src/real/index';
import type {
  HttpResolveResponse,
  HttpResolveRequest,
  HttpTransportConfig,
  ResolveFetch,
} from '../src/real/index';
import type { NativeResolveOutput } from '../src/real/native';
import type { SpinInput } from '../src/types';

// WP-5.8 contract tests: the HTTP non-transacting resolve transport against an in-memory fake fetch (no
// real network, no wall-clock). Every typed failure is provoked and asserted by exact code; timeout/abort
// are proven with fake timers; retry is proven bounded and only on safe causes; and a malformed engine
// response never escapes as a partial result. LAW 1: the fakes REPLAY fixed committed native payloads;
// none computes an outcome (no RNG, no symbol/win derivation).

const INPUT: SpinInput = { bet: 100, seed: { serverSeedHash: 'h', clientSeed: 'c', nonce: 1 } };

const CONFIG: HttpTransportConfig = parseHttpTransportConfig({
  baseUrl: 'https://engine.test/resolve',
  timeoutMs: 1_000,
  retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 40 },
});

// A fixed, committed 2x2 native payload (identical in spirit to the WP-4.3 fixtures). Not computed.
const NATIVE: NativeResolveOutput = {
  id: 'real-1',
  stake: 100,
  boardFinal: [
    ['A', 'B'],
    ['C', 'D'],
  ],
  paylines: [{ sym: 'A', cells: [[0, 0]], pay: 50, line: 2 }],
  bonuses: [{ kind: 'freeSpinsAwarded', payload: { count: 10 } }],
  total: 50,
  proof: 'proof-blob',
};

function jsonResponse(status: number, body: unknown): HttpResolveResponse {
  return { status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

// A fetch that returns a fixed sequence of responses (or throws a fixed sequence of errors), recording the
// requests it received. Determinism only: it replays committed data, it never derives an outcome.
function sequenceFetch(steps: readonly (HttpResolveResponse | Error)[]): {
  fetch: ResolveFetch;
  calls: HttpResolveRequest[];
} {
  const calls: HttpResolveRequest[] = [];
  let i = 0;
  const fetch: ResolveFetch = async (request) => {
    calls.push(request);
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetch, calls };
}

// Deps that make backoff instant and jitter deterministic (no real timer, no Math.random).
const FAST_DEPS = { sleep: async () => {}, random: () => 0.5 };

function clientWith(fetch: ResolveFetch): HttpResolveClient {
  return new HttpResolveClient(CONFIG, { fetch, ...FAST_DEPS });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HttpResolveClient happy path (WP-5.8)', () => {
  it('returns the schema-validated native output for a 200 response', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(200, NATIVE)]);
    const out = await clientWith(fetch).resolve(INPUT);

    expect(out).toEqual(NATIVE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://engine.test/resolve');
    expect(calls[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0]!.body)).toEqual(INPUT);
  });

  it('applies the configured auth header to the request', async () => {
    const config = parseHttpTransportConfig({
      baseUrl: 'https://engine.test/resolve',
      authHeader: { name: 'authorization', value: 'Bearer token-123' },
    });
    const { fetch, calls } = sequenceFetch([jsonResponse(200, NATIVE)]);
    await new HttpResolveClient(config, { fetch, ...FAST_DEPS }).resolve(INPUT);

    expect(calls[0]!.headers['authorization']).toBe('Bearer token-123');
  });

  it('drives the RealEngineAdapter end to end into a validated SpinResult', async () => {
    const { fetch } = sequenceFetch([jsonResponse(200, NATIVE)]);
    const engine = createRealHttpEngine({
      config: { baseUrl: 'https://engine.test/resolve' },
      gridSize: { rows: 2, cols: 2 },
      deps: { fetch, ...FAST_DEPS },
    });
    const result = await engine.spin(INPUT);

    expect(result.spinId).toBe('real-1');
    expect(result.totalWin).toBe(50);
    expect(result.grid).toEqual([
      [symbolId('A'), symbolId('B')],
      [symbolId('C'), symbolId('D')],
    ]);
  });
});

describe('HttpResolveClient typed failures (WP-5.8)', () => {
  it('maps a network rejection to code "network"', async () => {
    const { fetch } = sequenceFetch([new Error('ECONNREFUSED')]);
    // Single attempt so we assert the terminal code, not a retry.
    const client = new HttpResolveClient(
      parseHttpTransportConfig({ baseUrl: 'https://engine.test/resolve', retry: { maxRetries: 0 } }),
      { fetch, ...FAST_DEPS },
    );
    await expect(client.resolve(INPUT)).rejects.toMatchObject({
      name: 'RealEngineTransportError',
      code: 'network',
    });
  });

  it('maps a 4xx to code "httpClientError" with the status, and does NOT retry it', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(400, { error: 'bad request' })]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({
      code: 'httpClientError',
      status: 400,
    });
    expect(calls).toHaveLength(1);
  });

  it('maps a 5xx to code "httpServerError"', async () => {
    // 5xx on every attempt: after exhausting retries the terminal error is httpServerError.
    const { fetch } = sequenceFetch([jsonResponse(503, 'unavailable')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({
      code: 'httpServerError',
      status: 503,
    });
  });

  it('maps a 429 to code "httpRateLimited"', async () => {
    const { fetch } = sequenceFetch([jsonResponse(429, 'slow down')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({
      code: 'httpRateLimited',
      status: 429,
    });
  });

  it('maps an unexpected 3xx to code "httpUnexpectedStatus" and does NOT retry it', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(302, '')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({
      code: 'httpUnexpectedStatus',
      status: 302,
    });
    expect(calls).toHaveLength(1);
  });

  it('maps a non-JSON 200 body to code "malformedBody" and does NOT retry it', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(200, 'not-json{')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({ code: 'malformedBody' });
    expect(calls).toHaveLength(1);
  });

  it('maps a schema-invalid 200 body to code "schemaInvalid" and does NOT retry it', async () => {
    // `total` is required; omit it so the native-output schema rejects the payload.
    const { total: _total, ...missingTotal } = NATIVE;
    const { fetch, calls } = sequenceFetch([jsonResponse(200, missingTotal)]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({ code: 'schemaInvalid' });
    expect(calls).toHaveLength(1);
  });

  it('rejects a malformed outbound SpinInput before any request (code "schemaInvalid")', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(200, NATIVE)]);
    const bad = { bet: 0, seed: { serverSeedHash: 'h', clientSeed: 'c', nonce: 1 } } as unknown as SpinInput;
    await expect(clientWith(fetch).resolve(bad)).rejects.toMatchObject({ code: 'schemaInvalid' });
    expect(calls).toHaveLength(0);
  });

  it('a malformed engine response never escapes as a partial result', async () => {
    // A board of the wrong element type: the schema rejects it; nothing partial is returned.
    const broken = { ...NATIVE, boardFinal: [[1, 2]] };
    const { fetch } = sequenceFetch([jsonResponse(200, broken)]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toBeInstanceOf(RealEngineTransportError);
  });
});

describe('HttpResolveClient retry policy (WP-5.8, idempotent resolve only)', () => {
  it('retries a transient 5xx then succeeds, bounded by maxRetries', async () => {
    const { fetch, calls } = sequenceFetch([
      jsonResponse(503, 'x'),
      jsonResponse(500, 'x'),
      jsonResponse(200, NATIVE),
    ]);
    const out = await clientWith(fetch).resolve(INPUT);

    expect(out).toEqual(NATIVE);
    expect(calls).toHaveLength(3);
  });

  it('gives up after maxRetries+1 attempts on a persistent retryable cause', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(503, 'x')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({ code: 'httpServerError' });
    // maxRetries=3 => 4 total attempts.
    expect(calls).toHaveLength(4);
  });

  it('does NOT retry a non-retryable cause (single attempt)', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(422, 'x')]);
    await expect(clientWith(fetch).resolve(INPUT)).rejects.toMatchObject({ code: 'httpClientError' });
    expect(calls).toHaveLength(1);
  });

  it('exposes the safe-cause classification for the retry decision', () => {
    const safe = new RealEngineTransportError('network', 'x');
    const rate = new RealEngineTransportError('httpRateLimited', 'x');
    const server = new RealEngineTransportError('httpServerError', 'x');
    const timeout = new RealEngineTransportError('timeout', 'x');
    const client = new RealEngineTransportError('httpClientError', 'x');
    const aborted = new RealEngineTransportError('aborted', 'x');

    expect([safe, rate, server, timeout].every(isRetryableTransportError)).toBe(true);
    expect([client, aborted].some(isRetryableTransportError)).toBe(false);
  });
});

describe('HttpResolveClient timeout and abort (WP-5.8, fake timers)', () => {
  it('aborts an attempt that exceeds the per-attempt timeout and maps it to code "timeout"', async () => {
    vi.useFakeTimers();
    // A fetch that never resolves on its own; it rejects only when its AbortSignal fires.
    const hangingFetch: ResolveFetch = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    // No retries so the terminal error is the timeout itself (not a later attempt's outcome).
    const config = parseHttpTransportConfig({
      baseUrl: 'https://engine.test/resolve',
      timeoutMs: 1_000,
      retry: { maxRetries: 0 },
    });
    const client = new HttpResolveClient(config, { fetch: hangingFetch, ...FAST_DEPS });

    const pending = client.resolve(INPUT);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('does not dispatch when the caller signal is already aborted (code "aborted")', async () => {
    const { fetch, calls } = sequenceFetch([jsonResponse(200, NATIVE)]);
    const controller = new AbortController();
    controller.abort();
    await expect(clientWith(fetch).resolve(INPUT, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(calls).toHaveLength(0);
  });

  it('aborts an in-flight attempt when the caller signal fires (code "aborted")', async () => {
    const controller = new AbortController();
    const abortingFetch: ResolveFetch = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        controller.abort();
      });
    const config = parseHttpTransportConfig({
      baseUrl: 'https://engine.test/resolve',
      retry: { maxRetries: 0 },
    });
    const client = new HttpResolveClient(config, { fetch: abortingFetch, ...FAST_DEPS });
    await expect(client.resolve(INPUT, { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});

describe('config and construction guards (WP-5.8)', () => {
  it('parseHttpTransportConfig fills defaults for a minimal config', () => {
    const config = parseHttpTransportConfig({ baseUrl: 'https://engine.test/resolve' });
    expect(config.timeoutMs).toBe(10_000);
    expect(config.retry).toEqual({ maxRetries: 3, baseDelayMs: 200, maxDelayMs: 5_000 });
  });

  it('parseHttpTransportConfig rejects a non-http base URL with a typed error', () => {
    expect(() => parseHttpTransportConfig({ baseUrl: 'ftp://engine.test' })).toThrow(RealEngineConfigError);
    expect(() => parseHttpTransportConfig({ baseUrl: 'not a url' })).toThrow(RealEngineConfigError);
  });

  it('parseHttpTransportConfig rejects maxDelayMs < baseDelayMs', () => {
    expect(() =>
      parseHttpTransportConfig({
        baseUrl: 'https://engine.test/resolve',
        retry: { baseDelayMs: 1_000, maxDelayMs: 100 },
      }),
    ).toThrow(RealEngineConfigError);
  });

  it('createGlobalResolveFetch fails fast when no global fetch is available', () => {
    // Pass a non-undefined non-function so the parameter default does not re-supply the real global fetch.
    expect(() => createGlobalResolveFetch(null as unknown as typeof fetch)).toThrow(
      RealEngineTransportError,
    );
  });

  it('surfaces an adapter validation failure as RealEngineMappingError, not a partial result', async () => {
    // Structurally inconsistent cascade: boardFinal does not match the forward-applied tumble, so the
    // adapter's validateSpinResult rejects the PROJECTED result (distinct from a transport error).
    const inconsistent: NativeResolveOutput = {
      id: 'casc',
      stake: 100,
      boardInitial: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      boardFinal: [
        ['Z', 'B'],
        ['A', 'D'],
      ],
      paylines: [],
      bonuses: [],
      total: 100,
      tumbles: [
        { removedCells: [[1, 0]], fill: [{ column: 0, pieces: ['E'] }], winThisStep: 100, runningTotal: 100 },
      ],
    };
    const { fetch } = sequenceFetch([jsonResponse(200, inconsistent)]);
    const engine = createRealHttpEngine({
      config: { baseUrl: 'https://engine.test/resolve' },
      gridSize: { rows: 2, cols: 2 },
      deps: { fetch, ...FAST_DEPS },
    });
    await expect(engine.spin(INPUT)).rejects.toBeInstanceOf(RealEngineMappingError);
  });
});
