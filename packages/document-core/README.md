# @marionette/document-core

The renderer-agnostic document spine (ADR-0001): the `DocumentModel`, every command, and the
`History`. The Electron editor GUI and the headless MCP server drive this exact same command layer,
which is what makes dual control (human and AI) safe: one mutation path, one undo stack, no
divergence. No React, no PixiJS, no DOM, no Electron (lint-enforced).

LAW 2 governs this package: every document mutation is a `Command` with `do`/`undo`; there is no
other legal path. The write-capable internals (`Mutator`, `DocumentModelInternal`) are deliberately
excluded from the barrel; a `Mutator` is only handed to a command by `History` during `do`/`undo`.

## The command layer

- **`Command`** (`src/command/command.ts`): `kind`, `label`, `do(ctx)`, `undo(ctx)`, optional
  `coalesceWith(prev)` (same kind and same target only; omitted means never coalesces), optional
  `selectionHint(phase)`. `CommandContext` is `{ mutate, effects, ids }` and nothing else.
- **100 commands total**, registered in two CI-guarded registries (a discovery guard globs
  `*.command.ts` and asserts one registered spec per file):
  - **79 skeletal commands** (`src/commands/registry.ts`): bone (create/move/rotate/scale/length/
    transform-mode/rename/reparent/delete/normalize-rotation), slot, region attachment, animation,
    keyframe and curve, mesh creation and topology editing (WP-2.1), mesh-to-bone binding (WP-2.3),
    weight painting (WP-2.4), IK constraints (WP-2.6), transform constraints (WP-2.7), skins
    (WP-2.8), deform timelines (WP-2.9), and the slot-composer family (grid config, symbol mapping,
    win sequences, escalation, feature flows, tumble; WP-4.5 to 4.10).
  - **21 effects commands** (`src/effects-commands/registry.ts`): effect lifecycle, layers, life
    curves, bundles.
- **`History`** (`src/command/history.ts`): `HISTORY_DEFAULTS = { maxDepth: 500,
  coalesceWindowMs: 250 }`. Two coalescing mechanisms:
  - **Window coalescing**: outside a gesture, a command merges into the stack top only if the
    previous command is the same kind and target and arrived within the 250 ms window. The merged
    command keeps the original `before` and the latest `after`, so one undo returns to the start.
  - **Interaction sessions** (`beginInteraction` / `endInteraction` / `cancelInteraction`): a drag,
    scrub, or paint stroke becomes exactly one undo step (a `CompositeCommand` when it touches more
    than one target). Ending a session sets the window stamp to negative infinity so a later
    discrete edit can never merge into a completed gesture. Re-entrancy throws
    `HistoryReentrancyError`.
- Skeletal and effects models share ONE history: undo is global and ordered.

## Save / load / export

`src/save-load/` owns the seam. `loadDocument(json, env)` validates through
`@marionette/format` first (a malformed file throws a typed error and builds nothing, LAW 3), then
resolves all name references to ids and returns a fresh `Document` aggregate
(`{ model, effects, history, ids }`) with EMPTY history: loading is not a command and is not
undoable. `loadDocumentWithEffects` resolves both documents against one shared `IdFactory`.
`exportDocument` projects the model back to validated, content-hashed portable format (failures
throw `ExportValidationError` carrying the full report); `exportSlotSceneDocument` and
`loadSlotSceneState` cover the slot-scene document.

## Public surface (barrel highlights)

`History`, `HISTORY_DEFAULTS`, `CompositeCommand`, the `Command`/`CommandContext` types, the typed
command-error set (`CommandTargetMissingError`, `ReparentCycleError`, `KeyframeCollisionError`,
`MeshTopologyLockedError`, `ConstraintError`, `SkinError`, `DeformError`, `EffectEditError`,
`SlotEditError`, and more), `assertInvariants`, the read-only model surface (entities, snapshots,
`DocumentReadModel`, `EffectsReadModel`, `SlotSceneState`), branded ids plus `makeIdFactory`, the
weight-math helpers (`normalizeInfluences`, `capInfluences`, `finalizeVertexWeights`,
`distanceToSegment`), and the save/load entry points above.

## Tests

34 test files. The load-bearing ones: `round-trip.harness.test.ts` iterates every registered
command against every applicable seed document and asserts do-then-undo is bit-exact, redo returns
the post-do state, and `assertInvariants` holds after every step (the LAW 2 mandatory harness;
`effects-round-trip.harness.test.ts` mirrors it), the two discovery guards, `coalesce.test.ts` and
`cancel-interaction.test.ts` (the merged-sequence and 250 ms window pins), per-category command
suites, `save-load.test.ts`, `export-acceptance.test.ts`, and `fuzz.test.ts`.

```sh
pnpm --filter @marionette/document-core typecheck
pnpm --filter @marionette/document-core test
pnpm --filter @marionette/document-core build
```

Dependencies: `@marionette/format`, `@marionette/runtime-core` (workspace). Adding a command means
adding its `*.command.ts` file, its registry entry, and its round-trip coverage; the discovery
guard fails CI if any of the three is missing.
