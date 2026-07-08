# @marionette/format

The data-format contract for Armature 2D (LAW 3: the format is the one expensive-to-change
artifact). This package owns the document type models, the import-time validators, content hashing,
the version gate and migration framework, and the MRNT binary container. It is the dependency-graph
leaf: it imports nothing in-repo (external deps are `zod` and `@noble/hashes` only, both pinned
exact).

The authoritative design document is `docs/plan/cross-cutting/format-contract.md`. Version bumps are
recorded in this package's `CHANGELOG.md`.

## Version lines

The package carries four independent semver lines (all in `src/version/constants.ts`):

| Constant | Value | Governs |
|---|---|---|
| `CURRENT_FORMAT_VERSION` | `0.3.0` | `SkeletonDocument` (`formatVersion` field) |
| `EFFECTS_FORMAT_VERSION` | `1.0.0` | `EffectsDocument` (`effectsFormatVersion` field) |
| `SLOT_SCENE_FORMAT_VERSION` | `0.1.0` | `SlotSceneDocument` |
| `FORMAT_COMMON_VERSION` | `1.0.0` | The frozen shared primitives (`src/common`) |

`SUPPORTED_FORMAT_MAJOR = 0` for the skeleton line. Each version is the semver of THE FORMAT,
independent of the app version. A schema or semantic change is classified MAJOR/MINOR/PATCH per
`format-contract.md` section 10 and bumps the version with a tested migration; pre-1.0 breaking
changes bump MINOR. A non-schema change (validator refactor, comment, error wording) does NOT bump
it. CI enforces this with `check:format-semver` (a change under `src/` requires a matching change to
`version/constants.ts`) and `check:format-version-stable`.

## Document types

Three top-level document families, each with its own schema, validator, error-code set, and content
hash:

- **`SkeletonDocument`** (`src/schema/document.ts`, strict): `formatVersion`, `name`, `hash`,
  `bones`, `slots`, `skins`, `ikConstraints`, `transformConstraints`, `events`, `animations`, `atlas`,
  and an optional `metadata` block. Each animation carries bone/slot/ik/transform/deform timelines plus
  the `drawOrder` and `events` timelines. The core skeletal-animation format (Layer A of the product).
- **`EffectsDocument`** (`src/effects/schema/document.ts`): `effectsFormatVersion`, `name`, `hash`,
  `atlas`, `effects`, `bundles`. The particle/VFX format (Layer B), exposed via the `./effects` and
  `./effects-types` subpaths.
- **`SlotSceneDocument`** (`src/slot/scene-document.ts`): the slot-composition authoring format
  (Layer C): grid config, symbol animation sets, win sequences, feature-flow graphs, tumble
  choreography, rollup curves. Exposed via the `./slot` and `./slot-types` subpaths.

Project envelopes (`ProjectManifest`, slot project manifests) tie multi-document projects together
with per-member content hashes.

## Public surface (the `.` barrel)

- `validateDocument(input, { verifyHash? })` returns a collect-all `ValidationReport` (never throws
  on malformed data). `parseDocument` is the throwing wrapper (`FormatValidationError`).
- `computeContentHash` / `verifyContentHash`: SHA-256 over canonical JSON with the `hash` field
  excluded, lowercase hex. The same canonicalizer backs the effects and slot hash functions.
- `migrateToCurrent` / `runMigrations` / `MIGRATIONS`: the migration framework. The registry holds two
  steps: `0.1.x -> 0.2.0` (adds the constraint arrays and the ik/transform/deform animation timelines)
  and `0.2.x -> 0.3.0` (adds the root `events` collection and the per-animation `drawOrder` and `events`
  timelines), each recomputing the hash. The runner walks the contiguous chain and validates the final
  result against the current schema; the gate keys on the migration key (the MINOR digit while MAJOR
  is 0).
- `encodeBinary` / `decodeBinary` / `crc32`: the MRNT binary container (below).
- `encodeWeightedVertices` / `decodeWeightedVertices` / `isWeightedMesh` plus
  `MAX_BONE_INFLUENCES` and `WEIGHT_SUM_EPSILON`: the weighted-vertex codec (ADR-0002).
- `CURRENT_FORMAT_VERSION`, `SUPPORTED_FORMAT_MAJOR`, and the full type surface re-exported from
  `./types`.

Sibling barrels: `./effects` (`validateEffectsDocument`, `parseEffectsDocument`,
`validateProjectManifest`, effects hashing, `EffectsValidationError`) and `./slot`
(`validateSlotScene`, `parseSlotSceneDocument`, `validateSlotProjectManifest`, slot hashing,
`SlotSceneValidationError`, plus every sub-schema: grid, win sequence, feature flow, tumble).

## Typed errors

`FormatError` is `{ code, path, message, detail? }` with `path` a JSON Pointer. Codes come from the
single `FORMAT_ERROR_CODES` const array (55 codes today, for example `SCHEMA_SHAPE`,
`UNSUPPORTED_FORMAT_VERSION`, `MIGRATION_REQUIRED`, `BONE_NAME_DUPLICATE`, `MESH_WEIGHT_SUM`,
`IK_CHAIN_DISCONTINUOUS`, `ANIM_TIME_ORDER`, `DRAWORDER_INCOMPLETE`, `EVENT_NAME_DUPLICATE`,
`ANIM_EVENT_UNKNOWN`, `EVENT_AUDIO_RANGE`, `HASH_MISMATCH`); warnings are `HASH_ABSENT` and
`DUPLICATE_RECORD_KEY`. The effects family has its own 17-code set (`EFFECT_*`, `BUNDLE_*`,
`PROJECT_*`) and the slot family its own 18-code set. Binary decoding fails with a typed
`BinaryDecodeError` (`badMagic`, `unsupportedContainerVersion`, `unsupportedFormatMajor`,
`crcMismatch`, `truncated`, `malformed`).

## The MRNT binary container (WP-5.1)

`src/binary/` implements a deterministic binary encoding of any JSON document tree: magic bytes
`MRNT`, container version 1, a flags byte (bit 0 marks the lossless float64 profile), the
`formatVersion` string, a deduplicated string table, a length-checked tagged value tree, and a
CRC-32/ISO-HDLC trailer. Re-encoding is byte-identical and the JSON round trip is lossless
(float64). The editor save format stays JSON; MRNT is the shipping/export container. A float32
transport profile is reserved but not implemented.

## Two entry points per family

`@marionette/format` (the value barrel, links Zod) and `@marionette/format/types` (type-only, zero
runtime), and likewise `./effects` vs `./effects-types` and `./slot` vs `./slot-types`.
`runtime-core` MUST import types only, via `import type { ... } from '@marionette/format/types'`,
so the Zod runtime never reaches the platform-agnostic core. This boundary is lint-enforced.

## Validate on import

Every external boundary (file load, IPC payload, MCP tool input) validates with this package and
fails loudly with a typed error (LAW 3). The editor import path uses the default
`verifyHash: true`; `runtime-web` passes `verifyHash: false` because runtimes treat `hash` as
opaque.

## Run

```sh
pnpm --filter @marionette/format typecheck            # tsc --noEmit
pnpm --filter @marionette/format test                 # vitest (27 test files)
pnpm --filter @marionette/format build                # tsc emit to dist (monorepo consumers use src)
pnpm --filter @marionette/format gen:fixtures         # regenerate the skeleton golden corpus
pnpm --filter @marionette/format gen:effects-fixtures # regenerate the effects corpus
pnpm --filter @marionette/format gen:slot-fixtures    # regenerate the slot-scene corpus
```

Tests pair every positive corpus with negative fixtures named by the exact error code they must
produce (`test/fixtures/invalid/`, `test/fixtures/effects/invalid/`, `fixtures/slot-scene/invalid/`),
plus purity (`validate.purity.test.ts`, the validator never mutates its input), hash-oracle and
hash-stability locks, barrel-surface guards, and migration tests.

No environment variables. The package is pure: deterministic, no I/O, no mutation of its input.

## Dependencies

- `zod` (pinned exact) is the schema source of truth; types are derived via `z.infer`.
- `@noble/hashes` (pinned exact) provides SHA-256 for content hashing (tiny, dependency-free, runs
  identically in Node and the browser).
