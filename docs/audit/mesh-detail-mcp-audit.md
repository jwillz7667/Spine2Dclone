# Fine mesh detail + MCP control audit (deform, squash/stretch, physics-grade animation)

Date: 2026-07-06. Scope: everything responsible for detailed sub-bone movement (mesh vertices,
triangulation, weights, per-vertex deform timelines, scale/shear channels, bezier easing), audited
end to end (format, document-core commands, runtime-core solve, MCP tool surface, render parity),
against one concrete bar: an AI speaking ONLY the MCP tool surface must be able to author AND
numerically verify a detailed, physically convincing animation (a bouncing ball with weight: gravity
parabola, restitution, volume-preserving squash and stretch, a deform-flattened contact patch).

The proof is `packages/mcp-server/test/ball-bounce.dod.test.ts`: every mutation and every
verification in it goes through the literal tool handlers (no document-core or runtime-core import).
It asserts the fall matches y = y0 - (g/2)t^2 within the pinned bezier chord error (0.75 units on a
260-unit drop), the measured restitution equals sqrt(h2/h1) within 0.02, the dwell holds y = 0
exactly, maximum squash is wide/low with total area preserved within 5% (scale product 0.95 plus the
patch bulge), three contact vertices sit on the ground plane exactly (per-vertex deform detail a
rigid scale cannot produce), nothing penetrates the ground, and repeated sampling is bit-identical.

## What was already solid (verified, with evidence)

- Format: per-keyframe curves (linear / stepped / bezier with unclamped cy for overshoot) on every
  timeline family, non-uniform scale AND shear bone channels, per-vertex deform offsets validated
  against mesh vertex count (`DEFORM_OFFSET_LENGTH`), strict-ascending key times.
- Commands (LAW 2 complete): exact vertex placement (`mesh.addVertex`/`moveVertex` take explicit
  geometry), custom triangulation and edges, bind/paint/normalize weights, full deform keyframe
  CRUD, all with do/undo round-trip coverage via the registry harness.
- Solve: deform tracks interpolate per-lane with the keyframe curve and apply post-skin in world
  space (ADR-0003 section 9); `sampleMeshVertices` is allocation-free and conformance-pinned.
- Read-back: `document.getSnapshot` exposes every timeline including deform keyframe ids, offsets,
  and curves.

## Gaps found and FIXED in this change

| # | Finding | Fix |
|---|---------|-----|
| 1 | No numeric solved-state read-back at animation time t over MCP: `document.getWorldTransforms` was hard-wired to the setup pose, and nothing exposed `sampleMeshVertices`. The only time-t observation was `render_frame`'s PNG, so an AI could author a squash but never measure it. | `document.getWorldTransforms` now accepts optional `animationId` + `time` (full solve). New `mesh.sample` tool returns final world-space vertices (skin + deform) plus triangles at any time, closing the author-sample-measure loop. |
| 2 | A deform keyframe's easing could not be changed after insert: `kf.curve` covers only bone/slot channels, and `deform.setKeyframe` on an existing time deliberately keeps the old curve. The only path was delete + re-insert, losing the keyframe id. | New `SetDeformCurveCommand` (`deform.setCurve` tool): in-place curve edit keeping id, time, and offsets, with round-trip coverage. |
| 3 | `mesh.moveVertex` on a WEIGHTED mesh silently corrupted the mesh: the command wrote flat `[2i, 2i+1]` coordinates into the self-delimiting bone-influence stream (`[boneCount, (boneIndex, vx, vy, weight)*]`), clobbering bone indices and weights, and the tool description invited the call ("always allowed"). | The command now rejects weighted meshes with `MeshTopologyLockedError('weighted')` (loud, before any mutation); the MCP tool surfaces it as `MESH_TOPOLOGY_LOCKED`. Deformed (unweighted) meshes stay movable. Proper weighted-vertex move means re-encoding bind-local influences and remains future work. |
| 4 | `anim.duration`'s shrink guard scanned only bone/slot channels, so shrinking below the last deform/ik/transform key succeeded and produced a document the exporter then rejected. | `lastKeyframeTime` now scans ik, transform, and deform timelines too. |
| 5 | `anim.get` claimed "all its timelines" but omitted ik, transform, and deform entirely, so deform keyframe ids (needed by `deform.deleteKeyframe`/`moveKeyframe`/`setCurve`) had no targeted read path. | `animationView` now projects all five timeline families. `document.getSnapshot`'s misleading description ("bones, order") corrected as well. |

## Known limitations, deliberate, documented here (not fixed)

- **One shared curve per vec2 keyframe** (translate/scale/shear key x and y together with one
  easing). Independent per-axis easing is a format change (LAW 3, formatVersion bump + migration +
  conformance regeneration). The standard rigging workaround is channel separation across bones,
  which the ball proof demonstrates (linear x on a carriage bone, eased y on the ball bone).
- **Deform offsets are world-space, post-skin, additive** (ADR-0003 section 9, conformance-pinned).
  Offsets do not rotate/scale with the bound bone between keys; authoring against a spinning bone
  needs keys computed per-pose (exactly what `mesh.sample` read-modify-write enables). Changing the
  space is a behavior-change to pinned fixtures and a cross-runtime decision, out of scope here.
- **Deform tracks sit outside the AnimationState blend layer** (crossfades pop deform to full
  strength). Real gap for production polish; it is solve-behavior work behind the behavior-change
  gate, tracked for the Phase 2 GUI remainder alongside deform authoring surfaces.
- **Bezier easing is a pinned 10-segment table** (`BEZIER_SEGMENTS`); a strong ease over a long move
  shows mild velocity faceting. The ball proof quantifies it: max 0.65 units of positional error on
  a 260-unit fall. Raising the resolution regenerates fixtures; not worth it yet.
- **Mesh geometry tools take caller-computed arrays** (`mesh.generateFromRegion`, `autoGridFill`,
  `autoPerimeterTrace` and the add/delete vertex re-triangulations). An external MCP client computes
  its own triangulation (the ball proof builds a 13-vertex disc fan inline); the editor-side helpers
  (earcut, silhouette trace) are not exposed as tools. Acceptable for AI control (the arrays are
  fully expressible); a `mesh.autoGeometry` convenience tool is a possible later ergonomic.
- **Boundary looseness noted for follow-up**: `setMeshGeometry` trusts caller arrays until
  export-time validation (a malformed triangulation is accepted into the model and only rejected on
  `document.validate`/export), and keyframe times past the animation duration also defer to the
  export gate. Both fail loudly at the LAW 3 boundary, neither corrupts state.

## Verification

- `packages/mcp-server/test/ball-bounce.dod.test.ts`: the end-to-end physics proof (2 tests).
- `packages/document-core/test/deform-commands.test.ts`: SetDeformCurve round-trip + negative,
  duration-guard regression.
- `packages/document-core/test/mesh-commands.test.ts`: weighted move rejection pinned.
- Registry round-trip harness auto-covers `deform.setCurve` on every seed.
- Full workspace suite green (document-core 1040, mcp-server 55, all 11 turbo test tasks).
