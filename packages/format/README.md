# @marionette/format

The data-format contract for Marionette (LAW 3: the format is the one expensive-to-change artifact).
This package owns the `SkeletonDocument` type model, the import-time validator, and content hashing.
It is the dependency-graph leaf: it imports nothing in-repo.

`formatVersion` is the semver of THE FORMAT, independent of the app version. It is `0.1.0` today
(`SUPPORTED_FORMAT_MAJOR = 0`). A schema or semantic change bumps it with a tested migration; pre-1.0
breaking changes bump MINOR (see `docs/plan/cross-cutting/format-contract.md` section 10).

## Scope (Phase 0)

This is the Phase-0 subset of `docs/plan/cross-cutting/format-contract.md` (phase-0-foundations.md
WP-0.3): the Zod schema source of truth and derived types, the structural validator and typed error
model, the semantic graph validator (bone/slot/skin/atlas families plus the idle-animation timeline
checks), content hashing, the public barrel, and the `./types` boundary, with a golden corpus.

Deferred to later phases (LAW 5, do not add here yet): the mesh-encoding validator, the full
animation/deform/draw-order/event validators, the constraint schemas, the generated JSON Schema
artifact, and the migration framework. The full `FormatErrorCode` union is already the stable
contract surface; the Phase-0 validators reach the subset of codes exercised by `test/fixtures/invalid`.

## Public surface

- `validateDocument(input, { verifyHash? })` returns a collect-all `ValidationReport` (never throws on
  malformed data). `parseDocument` is the throwing wrapper (`FormatValidationError`).
- `computeContentHash` / `verifyContentHash` (SHA-256 over canonical JSON, `hash` field excluded).
- `CURRENT_FORMAT_VERSION`, `SUPPORTED_FORMAT_MAJOR`.
- Types via `@marionette/format/types` (zero runtime) or re-exported from the value barrel.

Two entry points: `@marionette/format` (the value barrel, links Zod) and `@marionette/format/types`
(type-only, zero runtime). `runtime-core` MUST import types only, via
`import type { ... } from '@marionette/format/types'`, so the Zod runtime never reaches the
platform-agnostic core. This boundary is lint-enforced.

## Validate on import

Every external boundary (file load, IPC payload) validates with this package and fails loudly with a
typed `FormatError` (LAW 3). The editor import path uses the default `verifyHash: true`; `runtime-web`
passes `verifyHash: false` because runtimes treat `hash` as opaque.

## Run

```sh
pnpm --filter @marionette/format typecheck   # tsc --noEmit
pnpm --filter @marionette/format test        # vitest
pnpm --filter @marionette/format build        # tsc emit to dist (consumers use src in the monorepo)
pnpm --filter @marionette/format gen:fixtures # regenerate the golden corpus under test/fixtures
```

No environment variables. The package is pure: deterministic, no I/O, no mutation of its input.

## Dependencies

- `zod` (pinned exact) is the schema source of truth; types are derived via `z.infer`.
- `@noble/hashes` (pinned exact) provides SHA-256 for content hashing (tiny, dependency-free, runs
  identically in Node and the browser).
