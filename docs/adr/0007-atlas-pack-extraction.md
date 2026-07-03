# ADR-0007: Extract the deterministic atlas pipeline into @marionette/atlas-pack

Status: Accepted

## Context

The deterministic atlas pack pipeline (import source PNGs, alpha-trim to tight bounding boxes,
maxrects-pack into square pages, emit one PNG per page) was written for Phase 1 (WP-1.3) and lived
entirely under `apps/editor/src/main/atlas`. It is pure and seamed: it shells out to nothing, contains
no clock or RNG, reads and writes through an injected `AtlasFileStore`, and given identical sprites it
produces an identical `AtlasRef` (region coordinates, offsets, page assignment) and byte-identical page
pixels.

Only the Electron editor could run it. The headless MCP control surface (ADR-0001) can install an atlas
onto the live document (`atlas.set`, the only legal `SetAtlasRefCommand` path, LAW 2) but had no way to
PRODUCE one. An LLM authoring over MCP could therefore reference regions it could not pack, so the
render_frame authoring loop (ADR-0006) could never show real textured output from a headless session:
the pipeline was trapped behind Electron. Two consumers now need the same pure pipeline, and only one
could reach it.

The single editor-only concern in that directory is `rembg` (background removal): an env-gated
(`MARIONETTE_REMBG_BIN`) child-process step that spawns an external binary. It is asset PREP that runs
before, and separately from, the pack pipeline; the pack path never imports or calls it. It is not
deterministic-by-construction (it shells out) and is meaningless headless, so it must not travel with the
shared pipeline.

## Decision

Extract the seamed pipeline into a new leaf package, `@marionette/atlas-pack`:

- Move `pipeline.ts`, `import-sprites.ts`, `trim.ts`, `pack.ts`, `emit.ts`, `png.ts`, `file-store.ts`
  (with `createNodeFileStore`), `concurrency.ts`, `errors.ts`, and their unit tests. The in-memory
  `memory-file-store.ts` and the synthetic sprite/PNG generators (`synthetic.ts`) move too but are test
  support: they are exposed only from the `@marionette/atlas-pack/testing` subpath, never the production
  barrel.
- The package depends only on `@marionette/format` (for `AtlasRef` types), `pngjs` (a pure-JS codec, so
  the decoded-pixel determinism contract does not depend on a native library version), and
  `maxrects-packer`. It is a dependency-graph leaf over `format`, enforced by the boundaries lint.
- `rembg.ts` stays in `apps/editor/src/main/atlas`. It reuses the package's `AtlasError` class, so the
  `ATLAS_REMBG_*` codes remain in the shared error union rather than forking a parallel error type.
- `apps/editor/src/main/atlas/index.ts` becomes a thin barrel: `export * from '@marionette/atlas-pack'`
  plus the local rembg exports. The IPC layer imports only from that barrel, so no editor call site
  changed.
- The MCP server gains an `atlas.pack` tool that runs the pipeline through a `FileStore`-backed
  `AtlasFileStore` adapter (source and output directories are project-relative and confined to the
  project root by the existing `createNodeFileStore` policy; a traversal is rejected `PATH_FORBIDDEN`),
  then installs the emitted `AtlasRef` through `SetAtlasRefCommand` on the live History (LAW 2). Page
  file paths are recorded project-relative (output-directory-prefixed) so `render_frame` reads them back
  through the same `FileStore`. This required adding `writeBinary` and `listDir` to the MCP `FileStore`
  interface (mirroring the confinement of the existing `readBinary`).

## Consequences

- One pure pipeline, two consumers: the editor main process (`atlas-import.ts`) and the headless MCP
  `atlas.pack` tool run identical, deterministic packing code. The headless authoring loop can now pack,
  attach a packed region, and render real textured output end to end.
- The determinism contract is now guarded by the package's own suite (the moved trim/pack/pipeline/PNG
  tests) rather than the editor's, and by a leaf-only boundaries rule (no PixiJS, no runtime-web, no
  React; `Date.now` / `new Date` / `Math.random` banned).
- `rembg` no longer sits next to the shared pipeline, making the "pack never shells out" invariant
  structural: the package cannot import the child-process step because it does not contain it.
- The editor drops its direct `pngjs`, `@types/pngjs`, and `maxrects-packer` dependencies (now
  transitive through `@marionette/atlas-pack`).
- New sanctioned package (LAW 5): `atlas-pack` joins the allowed set in `tools/check-packages.mjs` and
  its guard test, citing this ADR.
- The `ATLAS_REMBG_*` codes live in a package that no longer contains rembg. This is a deliberate
  trade: a shared `AtlasError` vocabulary over a second error type, so rembg's typed failures keep
  branching on `AtlasError.code`.
