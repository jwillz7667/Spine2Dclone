# ADR-0006: Headless render feedback (render-to-PNG over MCP) via a CPU rasterizer

- Status: ACCEPTED 2026-07-03
- Deciders: lead + product owner (the LLM-authoring priority amendment, DEV_PLAN section 9)
- Cross-refs: ADR-0001 (MCP control surface), the dependency rules in CLAUDE.md (runtime-core has no
  PixiJS; the MCP server is headless Node)

## Context

An LLM authoring over MCP today works BLIND: it can read back document state, sampled bone worlds, and
mesh vertices, but never pixels. Art direction (silhouette readability, easing feel, effect intensity)
requires looking at the result and iterating; the product owner named this the highest-leverage gap in
the LLM-authoring path. The MCP server is a plain Node stdio process: no browser, no GPU, no WebGL
context, and it must stay trivially runnable in CI and inside agent sandboxes.

Options considered:

1. **headless-gl / node WebGL binding driving PixiJS.** Real GL output, but a native binary dependency
   that is notoriously platform-fragile (mac arm64 + Windows are both first-class targets, ADR-0001),
   drags PixiJS into a headless process, and produces driver-dependent pixels (hostile to this repo's
   byte-locked golden philosophy).
2. **An offscreen Electron render service.** Pixel-identical to the editor, but the MCP server would
   depend on a windowing stack; headless CI containers and agent sandboxes cannot assume it, and spawn
   cost per frame is terrible for an iterate-look-iterate loop.
3. **A pure-TypeScript CPU rasterizer package.** No GL, no native deps, byte-deterministic output on
   every platform, testable with committed golden PNGs like everything else in this repo. The cost:
   it is a SECOND raster path (preview-quality, not the shipped renderer), and it must be clearly
   scoped so nobody mistakes it for the product renderer.

## Decision

Option 3: a new `packages/render-preview` package, pure TypeScript, depending only on `format`,
`runtime-core`, and a PNG codec (`pngjs`). It is an AUTHORING PREVIEW, not a runtime: runtimes ship
PixiJS/Unity/Godot renderers; this package exists so headless tools (the MCP server first, CI visual
smoke tests later) can SEE a frame.

### Scope (v1)

- Inputs: a validated `SkeletonDocument`, optional animation id + time (setup pose when omitted), the
  atlas page PNGs (by path or bytes), viewport (width, height, world-rect or fit-to-content), and a
  background color.
- Renders, in draw order, with per-slot blend modes (normal/additive/multiply/screen) and slot x
  attachment tint/alpha: region attachments (textured quads) and mesh attachments (textured triangles
  fed by the SAME `sampleSkeleton`/`sampleMeshVertices` outputs the runtimes consume). Bilinear
  sampling, straight-alpha over-compositing, deterministic scanline triangle fill with a pinned
  top-left rule so output is byte-identical across platforms.
- Output: PNG bytes.
- Out of scope for v1 (documented, not silently missing): particles/effects frames, clipping masks,
  tint-black, the slot-scene composition. Each lands as a follow-up scope extension of this package.

### The MCP tool

`render_frame` in `@marionette/mcp-server`: Zod-validated input `{ animation?: string, time?: number,
width?, height?, fit?: 'content' | rect, background? }`, resolves atlas pages from the project root the
server was started with, and returns the PNG as base64 with its dimensions. Errors are typed and loud
(unknown animation, missing atlas page, zero-content fit).

### Determinism contract

Same document + same inputs => byte-identical PNG on every platform and Node version. No wall clock,
no platform text rendering, no floating-point-order dependence in compositing (fixed loop order). The
package's tests commit small golden PNGs and compare bytes, exactly like the conformance fixtures.

## Consequences

- The authoring loop closes: an LLM can author, render, look, and refine without a GUI or GPU.
- A second raster path exists and must not drift: it consumes the SAME solve outputs as the runtimes
  (never re-solving), so geometry cannot drift; only shading could, and its scope is pinned above.
- `pngjs` joins the dependency set (pure JS, no native code).
- Later phases get a free asset: CI visual smoke tests and documentation screenshots without a GPU.
