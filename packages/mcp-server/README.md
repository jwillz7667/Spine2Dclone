# @marionette/mcp-server

The headless control surface: a Model Context Protocol (MCP) server exposing the complete authoring
capability of Armature 2D as 201 tools over stdio. An AI agent (or any MCP client) can build,
inspect, render, and save everything the GUI can, because every mutating tool drives the same
`@marionette/document-core` commands through the same `History` (LAW 2, ADR-0001). The complete
tool-by-tool reference is the user manual chapter `docs/manual/09-tool-reference.md`.

## Running it

```sh
pnpm --filter @marionette/mcp-server build   # tsc + esbuild bundle -> dist/cli.js
node packages/mcp-server/dist/cli.js [projectRoot]
```

The binary name is `marionette-mcp`. The optional positional argument is the project root (defaults
to the working directory); every file path a client supplies is resolved against it and traversal
or absolute escapes are rejected with `PATH_FORBIDDEN` before any disk access. Transport is stdio;
diagnostics go to stderr only (stdout is reserved for the protocol).

MCP host configuration:

```json
{
  "mcpServers": {
    "armature": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/dist/cli.js", "<projectRoot>"]
    }
  }
}
```

## Tool catalog (201 tools)

Assembled in `src/tools.ts` (plus the spread-in effects and slot-composer tool sets); a catalog
test asserts the names are unique and the count matches.

| Namespace | Tools | Covers |
|---|---|---|
| document | 8 | new, getSnapshot, validate, export, save, open, close, setMetadata |
| bone | 12 | create, move, rotate, scale, shear, setLength, transformMode, rename, reparent, delete, list, get |
| slot | 10 | create, delete, rename, blend, color, darkColor, reorder, activeAttachment, list, get |
| attach | 6 | region add, remove, region transform, linked-mesh create/unlink, frame-sequence set |
| mesh | 14 | generate from region, vertex/edge/topology edits, auto grid fill, perimeter trace, bind to bones, binding edits, unbind, auto-weight, paint stroke, normalize weights |
| ik | 10 | constraint create/mix/bendPositive/setDepth/delete, keyframes set/delete/move, list, get |
| transform | 9 | constraint create/params/setVariants/delete, keyframes set/delete/move, list, get |
| constraints | 1 | reorder (explicit cross-array solve order) |
| physics | 13 | constraint create/delete/rename/setTargetBone/setChannels/setParams, settings get/set, keyframes set/delete/move, list, get |
| skin | 9 | create, rename, delete, scope add/remove, setAttachment, removeAttachment, list, get |
| deform | 4 | set/delete/move keyframe, clear attachment deform |
| anim | 10 | create, delete, rename, duration, duplicate, list, get, sequence set/move/delete |
| event | 10 | define, rename, delete, setDefaults, setAudio, list, get, key set/move/delete |
| draworder | 3 | key set/move/delete |
| kf | 8 | set, move, delete, curve, paste, attachment set/delete/move |
| history | 5 | undo, redo, getState, beginInteraction, endInteraction |
| query | 1 | document.getWorldTransforms |
| atlas | 3 | pack, set, get |
| render | 1 | render_frame |
| effects | 27 | effect lifecycle, layers, life stops, bundles, effects atlas |
| slot composer | 21 | grid, symbol mapping, win sequences, feature flows, tumble, scene read-back |

All inputs are strict Zod schemas. Tool failures return structured
`{ code, message, detail }` errors over the protocol, never an uncaught throw.

## Sessions and undo semantics

`SessionRegistry` (`src/session.ts`) holds up to 16 open documents (`doc_<n>` ids; beyond that,
`SESSION_LIMIT`). The injected MCP clock advances 1000 ms per call, past the 250 ms coalescing
window, so consecutive tool calls never merge by accident; a client that wants a drag-like gesture
brackets it with `history.beginInteraction` / `history.endInteraction`, which produces exactly one
undo step.

## Render feedback (ADR-0006)

`render_frame` renders the live document (optionally at a sampled animation time, optionally with a
named effect or bundle composed on top, with an explicit seed) through the
`@marionette/render-preview` CPU rasterizer and returns
`{ pngBase64, width, height, bytes, placeholders }`. Atlas page PNGs referenced by the document are
read from the sandboxed project root; `placeholders: true` signals the document has no atlas yet
(attachments render as tintable white). Dimensions are capped at 2048. Typed error codes include
`RENDER_ATLAS_PAGE_MISSING`, `RENDER_MALFORMED_ATLAS_PAGE`, `ANIMATION_NOT_FOUND`,
`RENDER_EFFECT_NOT_FOUND`, and `RENDER_BUNDLE_NOT_FOUND`. `atlas.pack` (ADR-0007) runs the
deterministic `@marionette/atlas-pack` pipeline and writes the page PNGs it renders from.

## Tests

`test/tools.test.ts` exercises every tool family end to end against real sessions (including
render_frame determinism: two identical renders produce identical bytes) plus the catalog
uniqueness test; `test/node-files.test.ts` proves the path-confinement boundary.

```sh
pnpm --filter @marionette/mcp-server typecheck
pnpm --filter @marionette/mcp-server test
```

Dependencies: `@marionette/document-core`, `@marionette/format`, `@marionette/runtime-core`,
`@marionette/render-preview`, `@marionette/atlas-pack` (workspace), `@modelcontextprotocol/sdk`,
`zod`, `pngjs`.
