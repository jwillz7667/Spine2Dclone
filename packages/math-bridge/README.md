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

## Run

```sh
pnpm --filter @marionette/math-bridge typecheck
pnpm --filter @marionette/math-bridge test       # vitest: mock engine, real adapter, validator, vocabulary
pnpm --filter @marionette/math-bridge build
```

Dependencies: `@marionette/format` (workspace) and `zod`.
