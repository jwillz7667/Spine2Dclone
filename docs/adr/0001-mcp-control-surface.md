# ADR-0001: Renderer-agnostic document core for MCP control (user + AI)

Status: Accepted (2026-06-27)
Owner: Editor Core
Supersedes the placement clause of `docs/plan/cross-cutting/command-history.md` line 6.

## Context

Marionette must let BOTH a human (through the GUI) AND an AI (through MCP, the Model Context
Protocol) fully control and build scenes: create rigs, bones, slots, attachments, animations,
particles, and slot compositions; validate; and export the portable format. This is a stated
product requirement, not a future nicety.

The architecture already makes this natural. Law 2 (all mutations are commands) means every document
change is a discrete, labeled, reversible `Command` executed by `History`. Law 3 (the format is the
contract) means output is validated and content-hashed by `packages/format`. Law 1 (math vs
presentation) means a command has no handle to a `SpinResult`, so it cannot decide an outcome. An MCP
tool that mutates is therefore structurally identical to a gizmo drag: it calls `history.execute(cmd)`.

The one obstacle is placement. The command-history plan put the document model, History, and commands
under `apps/editor/src/renderer/document/`. The Electron renderer is a sandboxed process
(`contextIsolation`, `sandbox`, no `nodeIntegration`); the Electron main process is a separate Node
context. Renderer code cannot be imported by main, and the WP-0.1 boundary lint enforces that split.
An MCP server that lets an AI build headlessly (no GUI) must run in the main process (or a headless
Node entry), so it cannot reach a document core that lives in the renderer without routing every
mutation over IPC, losing synchronous command semantics and the undo/redo and coalescing guarantees.

## Decision

1. The document model, `History`, `Command`, `CompositeCommand`, the `Mutator` capability, the
   `IdFactory`, the command catalog, and the save/load seam live in a new renderer-agnostic package,
   `packages/document-core`. It imports only `@marionette/format` (and, where a transform command
   needs affine math, `@marionette/runtime-core`). It has NO React, NO PixiJS, NO DOM, NO Electron,
   NO Node built-ins, so it runs identically in the renderer, the main process, and Vitest.

2. The editor renderer consumes `@marionette/document-core`. Renderer-only concerns (the composition
   root that injects the real clock and id factory, the Zustand selection/tool stores, the
   create-by-drag tool, the gizmo, keybindings, and the document host that adapts History events to
   editor state) stay under `apps/editor/src/renderer/`.

3. The headless MCP server (WP-M.1, after Phase 0) lives in `packages/mcp-server` plus a thin
   `apps/editor/src/main/mcp/` transport entry. Every mutating MCP tool calls the SAME
   `history.execute(cmd)` on the SAME commands the UI uses (Law 2; no second mutation path). Tool
   input schemas are DERIVED from the `packages/format` Zod schemas (Law 3; the format surface and the
   MCP surface cannot drift). Read tools project the model, run `validateDocument`, or compute world
   transforms via `runtime-core`.

4. Law 1 stays structural for MCP: `CommandContext` has no `SpinResult` field, and `mcp-server` never
   imports `packages/math-bridge`.

## Consequences

- Phase 0 now allows up to six workspace packages: `format`, `runtime-core`, `runtime-web`,
  `document-core`, `mcp-server`, and `apps/editor`. The forbidden-package CI guard is updated to match.
  `mcp-server` is created in WP-M.1 (when it gains logic), not scaffolded empty in Phase 0.
- The boundary lint gains a `document-core` element (imports format and runtime-core only; no
  PixiJS/React/DOM/Electron/Node) and grants the renderer and main process access to it.
- An AI can fully author headlessly from WP-M.1 onward, before later GUI features exist, because the
  command core does not depend on the renderer.
- Simultaneous co-control (a human and an AI editing the SAME live document at once) needs a single
  document authority (likely the main process, with the renderer as a command client over IPC). That
  is a later decision; for now the renderer and an MCP session each own their own `Document` instance,
  and a user-triggered "import from session" is the explicit sync. Keeping the core renderer-agnostic
  is exactly what keeps that future open.

## Alternatives considered

- Build the core in the renderer and extract later. Rejected: WP-0.7 is the work package that writes
  the core, so building it in the wrong place and moving it after is strictly more rework than placing
  it correctly now.
- Keep the core in the renderer and reach it from main over IPC for MCP. Rejected: every AI mutation
  would pay IPC serialization and lose synchronous undo/redo/coalescing semantics, and a headless
  (no-GUI) build mode would still require spinning up a renderer with nothing to render.
