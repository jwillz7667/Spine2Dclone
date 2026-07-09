# @marionette/math-bridge

The LAW 1 boundary package: the typed contract between the certified math engine (which decides
outcomes) and everything presentational (which never does). It owns the `SpinResult` shape, the
boundary validator, the committed mock engine used by tests and demos, and the adapter to the real
engine. Presentation packages consume `SpinResult` values; they never see RNG.

`BOUNDARY_CONTRACT_VERSION = '1.0.0'` (`src/version.ts`).

## The contract

- **`SpinResult`** (`src/schema.ts`, strict Zod; types inferred in `src/types.ts`): `spinId`,
  `bet` (positive integer base units), `initialGrid` and `grid` (`SymbolId[][]`), `wins`
  (`WinLine[]`), `totalWin` (integer base units), `features` (`FeatureEvent[]`), optional
  `cascades` (`CascadeStep[]`), optional `rngProof`. Money is always integer base units; positions
  are `[row, col]` integer tuples.
- **`MathEngine`** (`src/types.ts`): a single method, `spin(input: SpinInput): Promise<SpinResult>`.
  A non-transacting resolve; the mock and the real engine present the identical shape.
- **`validateSpinResult(input, { rows, cols })`** (`src/validate.ts`): returns a discriminated
  `Result`, never throws. It checks Zod shape, board dimensions, index bounds, structural cascade
  placement (forward-applying each `CascadeStep` under column-down gravity and deep-equaling the
  final board), and a non-decreasing `cumulativeWin` rollup ending on `totalWin`. It never sums or
  recomputes money (that is the engine's certified job). Error codes: `schema`,
  `dimensionMismatch`, `outOfBounds`, `nonCascadeBoardMismatch`, `cascadeInconsistent`,
  `cumulativeInconsistent`.

## The mock engine

`MockMathEngine` (`src/mock-engine.ts`) replays one of five committed scenarios
(`src/scenarios.ts`): `base-win`, `freespin-trigger`, `tumble-cascade`, `mega-escalation`,
`retrigger`. The scenario id is a constructor argument, results are deep clones, calls are
idempotent, and a single-in-flight guard rejects re-entrancy. Exposed via `MOCK_SCENARIOS` /
`MOCK_SCENARIO_IDS`.

## Entry points

- `@marionette/math-bridge`: the value barrel (schemas, validator, mock engine, vocabulary).
- `@marionette/math-bridge/types`: type-only, zero runtime.
- `@marionette/math-bridge/real`: the real-engine adapter (`adapter`, `client`, `config`,
  `native`). Deliberately NOT re-exported from the main barrel, and lint-banned inside
  `runtime-core`: presentation code can hold `SpinResult` types but can never reach the engine
  client.

## Boundary rules (lint-enforced)

`runtime-core/slot` may import `@marionette/math-bridge/types` and `spinResultSchema` (the WP-4.7
carve-out); `runtime-core/effects` may not import this package at all; nothing in `runtime-core`
may import `./real`.

## The real engine (`./real`, WP-5.8)

This is the production transport for the day a certified engine endpoint exists. It binds to the engine's
**non-transacting resolve** only (`NonTransactingResolveClient` exposes a single `resolve` method: a
deterministic, provably-fair resolution of a `SpinInput` with NO wallet debit and NO ledger advance). The
money boundary is structural, not a runtime check: there is no transacting method to call, and the
env-level `resolveRealEngineConfig` additionally refuses a configured transacting endpoint for preview.

### Data flow

```
SpinInput
  -> spinInputSchema (validate outbound)                 [http-transport]
  -> POST baseUrl (auth header, per-attempt timeout)     [ResolveFetch, injected]
  -> classify HTTP status                                [errors: httpClientError / 5xx / 429 / ...]
  -> JSON.parse + nativeResolveOutputSchema (validate)   [malformedBody / schemaInvalid]
  -> NativeResolveOutput
  -> RealEngineAdapter.project (pure projection, LAW 1)  [adapter]
  -> validateSpinResult(mapped, gridSize)                [RealEngineMappingError('validation')]
  -> SpinResult
```

`HttpResolveClient` implements `NonTransactingResolveClient`, so a `RealEngineAdapter` wrapping it is a
drop-in swap for `MockMathEngine` behind the `MathEngine` interface. `createRealHttpEngine({ config,
gridSize, symbolMap?, deps? })` is the one-call integrator entrypoint: it validates the config, builds the
client, and returns a plain `MathEngine`.

### Isomorphic and injectable

The transport uses the global `fetch` and `AbortController` (present in browsers and Node 18+), never a
Node-only API, matching the package's isomorphic constraint. Every ambient dependency is injectable via
`HttpResolveDeps` so the whole path is unit-testable with no real I/O and no wall-clock:

- `fetch`: a `ResolveFetch` over a minimal request/response surface (defaults to a wrapper on the global).
- `sleep`: backoff delay (defaults to a `setTimeout` delay; tests inject an instant resolve).
- `random`: jitter source in `[0, 1)` (defaults to `Math.random`). It influences retry TIMING only and
  never the resolved `SpinResult` (LAW 1).
- `encodeRequest` / `decodeResponse`: identity by default. A future integrator whose engine uses a
  different request envelope or response field names supplies the mapping here (see below).

### Failure taxonomy (`RealEngineTransportError.code`)

Every distinct cause has its own typed code so a host can branch on the exact reason:

| code | cause | retried? |
| --- | --- | --- |
| `network` | the fetch rejected (DNS, refused, TLS, reset) | yes |
| `timeout` | the per-attempt timeout fired and aborted the request | yes |
| `aborted` | the caller's `AbortSignal` fired (shutdown, superseded request) | no |
| `httpClientError` | HTTP 4xx other than 429 | no |
| `httpRateLimited` | HTTP 429 | yes |
| `httpServerError` | HTTP 5xx | yes |
| `httpUnexpectedStatus` | a 1xx/3xx from a resolve endpoint (misconfiguration) | no |
| `malformedBody` | a 2xx body that is not valid JSON | no |
| `schemaInvalid` | decoded JSON fails the native-output schema (also: a malformed outbound `SpinInput`) | no |

A mapped-but-structurally-invalid result is a distinct `RealEngineMappingError('validation')` from the
adapter, not a transport error, so the two layers keep separate error surfaces.

### Retry safety argument

Retry is bounded (`maxRetries`, default 3, so at most `maxRetries + 1` attempts) with full-jitter
exponential backoff, and fires **only** on transient AND safe causes: `network`, `timeout`,
`httpRateLimited`, `httpServerError`. This is safe because the resolve is **non-transacting by contract**
(section 4.3): it performs no wallet debit and no ledger advance, and a provably-fair resolve of the same
seed yields the same deterministic outcome. Repeating it therefore has no side effect and cannot
double-charge or corrupt state, so it is idempotent and safe to retry. Deterministic faults (4xx,
`malformedBody`, `schemaInvalid`, `httpUnexpectedStatus`) are never retried (a repeat cannot help), and
caller cancellation (`aborted`) is never retried (the caller asked to stop).

### What a live-engine integrator must supply

The transport is complete; wiring it to a specific certified engine requires the deployment configuration
the engine vendor owns (these values are NOT knowable here and are intentionally not invented):

1. **`baseUrl`**: the absolute non-transacting resolve endpoint (http/https). Provided via the validated
   `HttpTransportConfig` (`parseHttpTransportConfig` fails fast on a malformed value).
2. **`authHeader`** (if the engine requires auth): a `{ name, value }` pair sourced from a host env var
   (`MARIONETTE_ENGINE_*`), never committed.
3. **`timeoutMs` / `retry`**: per-attempt timeout and the retry policy, tuned to the engine's SLA.
4. **`encodeRequest`** (only if the engine expects an envelope other than the raw `SpinInput` JSON): a
   pure mapping from `SpinInput` to the engine's request body.
5. **`decodeResponse`** (only if the engine's response field names differ from `NativeResolveOutput`): a
   pure mapping from the engine's JSON to the native shape validated by `nativeResolveOutputSchema`.
   The native shape (`src/real/native.ts`) is a PLACEHOLDER model of the engine's own field names; if the
   live engine's names differ, they are re-mapped here, not by editing the schema.
6. **`gridSize`**: the grid dimensions the mapped `SpinResult` is validated against.

Env wiring: `resolveRealEngineConfig(process.env)` enforces the money boundary (requires
`MARIONETTE_ENGINE_RESOLVE_ENDPOINT`, refuses `MARIONETTE_ENGINE_TRANSACTING_ENDPOINT` for preview). Feed
its `resolveEndpoint` into the `HttpTransportConfig.baseUrl`.

### What remains unverifiable until a live engine exists

Recorded honestly: the tests exercise the transport against an in-memory fake fetch that replays committed
scenario data (no network, no wall-clock). They prove the happy path, every typed failure by exact code,
timeout/abort with fake timers, bounded and safe-only retry, and that a malformed response never escapes
as a partial result. They CANNOT prove what only a live certified endpoint reveals:

- the engine's **actual request envelope and response field names** (hence `encodeRequest` /
  `decodeResponse` are injection points, defaulting to identity against the placeholder native shape);
- real **network behavior** (TLS, real timeouts, real 4xx/5xx bodies, real rate-limit headers);
- the engine's **authentication scheme** and token lifecycle;
- that the live resolve is genuinely **non-transacting** in production (asserted by contract and by the
  structural absence of a transacting method here; final confirmation is an integration acceptance step,
  Phase 4 WP-4.14 / the live real-engine acceptance noted in the project CLAUDE.md as not headless-CI
  exercisable).

Until then the mock is the driver of record, and the swap-in guarantee is proven by the conformance shim
(`test/real-conformance.test.ts`): for every committed scenario, the real HTTP adapter and `MockMathEngine`
produce a deep-equal, identically-validated `SpinResult` for the same input.

## Run

```sh
pnpm --filter @marionette/math-bridge typecheck
pnpm --filter @marionette/math-bridge test       # vitest: mock engine, real adapter, validator, vocabulary
pnpm --filter @marionette/math-bridge build
```

Dependencies: `@marionette/format` (workspace) and `zod`.
