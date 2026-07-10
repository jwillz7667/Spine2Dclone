# editor (Armature 2D desktop app)

The Electron + React + PixiJS v8 authoring application. The renderer hosts the editor UI over the
shared `@marionette/document-core` command layer (ADR-0001); the viewport draws with the shared
`@marionette/runtime-web` `SkeletonView`, so the editor cannot drift from the playback runtime.

## Run

```sh
pnpm --filter editor dev    # electron-vite dev: HMR renderer, relaxed dev CSP
pnpm --filter editor build  # electron-vite build: out/main, preload.cjs, renderer bundle
pnpm --filter editor start  # electron-vite preview of the built bundle
pnpm --filter editor test   # vitest, 38 colocated test files
```

There is intentionally no packaging/installer step yet (no electron-builder or forge); the release
pipeline is Phase 5 WP-5.7.

## Process architecture

- **`src/main/`**: app lifecycle, the hardened `BrowserWindow`, the CSP header, the native menu,
  and the IPC handlers. Subsystems: `ipc/` (handler registration with Zod validation), `menu/`,
  `atlas/` (re-exports `@marionette/atlas-pack` plus the Node file store; `rembg.ts` background
  removal gated by the `MARIONETTE_REMBG_BIN` env var), `export-profile/` (WP-5.0 export-profile
  schema and loader), `file-io.ts` (save/open dialogs and disk IO), `csp.ts`,
  `window-options.ts`. Import entry points (PP-D5): `atlas-premade*.ts` (import an existing packed
  atlas or slice a plain sprite sheet, no repack), `psd-parse.ts` / `ora-parse.ts` /
  `layered-*.ts` (parse a PSD or ORA in-process and project its raster layers into a rig), and
  `spine-import*.ts` (the clean-room Spine importer, PP-A5).
- **Import dependencies** (pure-JS, no native binaries): `ag-psd@31.0.2` (MIT; Photoshop .psd
  reader, pulls `base64-js@1.5.1` MIT + `pako@2.1.0` MIT) and `fflate@0.8.3` (MIT; the zip reader
  for OpenRaster .ora). PNG decode/encode reuses `@marionette/atlas-pack` (`pngjs`); ORA's
  stack.xml is parsed by a small dependency-free reader in `ora-parse.ts`.
- **`src/preload/preload.ts`**: the sandboxed `contextBridge` exposing `window.marionette`.
  Bundled as CJS with Zod inlined (a sandboxed preload cannot `require` at runtime).
- **`src/shared/ipc-contract.ts`**: the isomorphic IPC contract imported by main, preload, and
  renderer: the channel allowlist, request/response Zod schemas, and the menu-action allowlist.
- **`src/renderer/`**: the React UI (below).

## Security posture

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`. The CSP
is single-sourced in `csp.ts` and applied both as an HTTP header and a build-time meta tag:
production is strict `script-src 'self'` with no remote origins; dev adds what Vite HMR needs.
Channels are a frozen allowlist (`app:getVersion`, `file:save`, `file:open`, `atlas:import`,
`atlas:importImages`, `atlas:importPremade`, `atlas:importGrid`, `layered:import`, `spine:import`,
and the main-to-renderer `menu:action` push); every payload is Zod-validated at the main boundary
and returns a typed `IpcResult`. Documents cross IPC as opaque values and are deep-validated by
`@marionette/format` with `verifyHash: true` before any disk write and after every read. Save and
open paths come from main-process dialogs, never from the renderer.

## Renderer structure

- **`document/`**: the `DocumentHost` singleton owning the single live `Document` (deliberately
  NOT in Zustand; the document/editor state wall), atomic load/new swaps, and the save/open flows.
- **`editor-state/`**: ephemeral Zustand stores, never serialized: camera, selection, slot
  selection, active tool, playback (playhead, mode, auto-key), mesh-edit, weight-paint, and the
  non-hook atlas texture store.
- **`viewport/`**: the PixiJS application, camera controller, layers, the `MoveRotateGizmo`,
  mesh-edit and weight-paint overlays, keybindings, and four tools: select/move (V), create bone
  (B), mesh (M), weight paint (W). Each frame the ticker polls the document revision and, on
  change, re-exports a validated `SkeletonDocument` and syncs the shared `SkeletonView` (setup pose
  or the sampled animation time).
- **`panels/`** (all nine registered in the default dockview layout): Hierarchy, Assets, Slot
  composer, Viewport, Inspector, Effects designer, Animations, Dopesheet, Curve Editor.
- **`dopesheet/`**: timeline math, keyframe and curve editing, transport logic.
- **`modules/`**: `mesh/` (triangulation via ear clipping, grid fill, marching squares, perimeter
  trace, Douglas-Peucker simplification, weight brush and paint sessions) and `constraints/`
  (the IK gizmo).

## Current GUI status

The command layer beneath the GUI is complete (Phases 0 to 4); the authoring surfaces trail it and
are being built in phase order (see `docs/DEV_PLAN.md` section 9). Working today: the four viewport
tools, the move/rotate gizmo, all nine panels, animation-mode editing with auto-key, and JSON
save/open. Mesh, particle, and slot-scene GL rendering in the viewport follow the corresponding
`runtime-web` work packages (WP-2.11, WP-3.5, WP-4.11 remainders).
