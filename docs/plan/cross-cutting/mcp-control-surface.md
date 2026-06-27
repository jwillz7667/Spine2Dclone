# Cross-cutting: MCP control surface (user + AI fully control the platform)

> Plan of record. Owner: Editor Core. Status: ACCEPTED via ADR-0001.
> Consumes (never redefines): `command-history.md` (the Command/History spine it wraps),
> `format-contract.md` (the Zod schemas its tool inputs derive from).

## 1. Goal

Both a human (GUI) and an AI (MCP client) fully author scenes through the SAME command system. An MCP
tool that mutates is structurally a gizmo drag: it calls `history.execute(cmd)` on a command from
`@marionette/document-core`. Undo/redo, coalescing, validate-on-import, and the Law 1 math boundary
all hold for AI edits because there is no second mutation path.

## 2. Placement (ADR-0001)

- `packages/document-core` (renderer-agnostic) owns the model, History, commands, and the save/load
  seam. No React/PixiJS/DOM/Electron/Node.
- `packages/mcp-server` owns tool definitions, session management, and the `McpServer` builder. It
  imports `document-core`, `format`, and `runtime-core`. No `runtime-web`, no `apps/editor`.
- `apps/editor/src/main/mcp/` is the transport wiring: a headless Electron/Node entry that hosts the
  server over stdio and supplies filesystem access (`document.open`/`save`).

## 3. Tool surface (first cut)

Input schemas are DERIVED from `packages/format` Zod schemas (`.pick`/`.omit`/`.extend`), so the
format contract and the MCP surface cannot drift.

- Document lifecycle: `document.new`, `document.open`, `document.save`, `document.validate`,
  `document.export`, `document.getSnapshot`, `document.close`.
- Bone (Phase 0 commands): `bone.create`, `bone.move`, `bone.rotate`, `bone.scale`,
  `bone.setLength`, `bone.rename`, `bone.delete`, `bone.get`, `bone.list`.
- History: `history.undo`, `history.redo`, `history.getState`, `history.beginInteraction`,
  `history.endInteraction` (the correct gesture analog for a programmatic client; the 250ms time
  window is NOT used for MCP).
- Query (read-only): `document.getValidationReport`, `document.getWorldTransforms` (via
  `runtime-core`), `history.getState`.
- Later phases add slot/attachment/skin/animation/constraint/particle/slot-composer tools as those
  commands land (Law 5).

## 4. Invariants

- Law 2: every mutating tool calls `history.execute(cmd)`; `Mutator`/`createMutator` are NOT exported
  from `document-core`, so a tool handler cannot fabricate a write surface.
- Law 3: `document.open`/`save` validate via `packages/format`; a typed `FormatValidationError`
  becomes a typed MCP tool error. Tool inputs are Zod-validated at the boundary.
- Law 1: `CommandContext` has no `SpinResult` field; `mcp-server` never imports `packages/math-bridge`.

## 5. Security

Static tool allowlist (no dynamic registration). Filesystem paths resolved against a configured
project root, traversal rejected. Phase 0 of the workstream uses stdio only (local child process, no
network). Optional localhost-only streamable HTTP behind a flag later, with Host-header validation.

## 6. Work packages

- WP-M.0 (done with WP-0.7): extract `packages/document-core`, update boundary lint and the
  forbidden-package guard, ADR-0001, this doc, amend `command-history.md` placement.
- WP-M.1 (after Phase 0): `packages/mcp-server` + `apps/editor/src/main/mcp` headless entry;
  document/bone/history/query tools; positive and negative tool tests; stdio transport.
- WP-M.2+ : slot/attachment/skin/animation tools and a document resource, then constraints, particles,
  and the slot composer, each as the underlying commands land.

## 7. Co-control (future)

Simultaneous human + AI editing of one live document needs a single document authority (likely the
main process, renderer as a command client over IPC). Deferred; the renderer-agnostic core keeps it
open. For now each side owns its own `Document`; sync is an explicit user action.
