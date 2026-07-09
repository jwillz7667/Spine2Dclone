# ADR-0012 (ADR-B2.GEOM): clipping evaluation, bounding-box hit testing, and point resolution

Status: Accepted (2026-07-09)
Owner: Lane B (Core solve and conformance)
Gates: the PP-B2 runtime behavior for the three attachment kinds that exist in the format
(`clipping`, `boundingbox`, `point`, `packages/format/src/schema/attachment.ts`) but had no runtime
meaning. These are non-drawing geometry attachments: a clip region, a hit-test volume, and a named
world anchor. This ADR pins the exact, first-principles math and data flow for all three so the three
runtimes (TS, Unity C#, Godot) compute the identical result and the conformance corpus can lock it.
Cross-ref: `CLAUDE.md` per-frame solve order (this is post-step-4 geometry that reads the solved world
pass); `docs/adr/0002-weighted-vertex-encoding.md` and `docs/adr/0003-constraint-solve-semantics.md`
section 9 (the vertex-to-world transform paths this reuses); `docs/plan/pro-parity-execution-plan.md`
section 4 Lane B (PP-B2); `docs/plan/cross-cutting/conformance-and-ci.md` (the fixture/tolerance policy).

Every rule below is designed from the published CONCEPTS of polygon clipping (Sutherland-Hodgman),
even-odd point-in-polygon ray casting, ear-clipping triangulation, and 2D affine anchoring (Law 4). No
Spine runtime or editor source was consulted; the decomposition choice, the winding rule, the emission
ordering, and the pooled-buffer worst-case bounds are our own design and derivation.

## Context

The format has carried three attachment kinds with structural shape but no solve since Phase 0:

- **`clipping`**: `{ end: string, vertices: number[], color }`. A polygon (vertex stream) plus the name of
  the slot at which clipping ENDS. Renderers must clip the geometry of the slots between the clip slot and
  the `end` slot (in draw order) to the polygon.
- **`boundingbox`**: `{ vertices: number[] }`. A polygon used for hit testing (a punch, a pickup, a
  clickable region). No drawing.
- **`point`**: `{ x, y, rotation }`. A single local transform used as a named anchor (muzzle, hand,
  attach point) whose world position and rotation a game reads.

None of the three carries a `bones` weight manifest in our format (unlike `mesh`, which optionally does,
ADR-0002). So in our format a `clipping` or `boundingbox` vertex stream is ALWAYS an unweighted, flat
`[x0, y0, x1, y1, ...]` stream rigidly attached to the attachment's slot bone; the transform is exactly
`solveSkinUnweighted`'s `world = slotBoneWorld * (x, y)`. If Lane A ever adds a weighted encoding to these
kinds, the same generic transform path (the weighted branch of `solveSkin`) handles it with no semantic
change; this ADR pins the unweighted path the current format expresses. A `point` is a single local
`(x, y, rotation)` composed with the slot bone's world.

Our format restricts deform timelines to `mesh`/`linkedmesh` attachments (`DEFORM_NOT_MESH`,
`packages/format/src/validate/semantic.ts`), so a clip polygon is NOT itself deformable in our format:
the clip polygon animates ONLY by its slot bone moving. The `rig-clipping` conformance rig therefore
animates the clip bone (moving the world polygon) AND clips a MESH that carries a deform timeline (so the
clipped triangle stream is a skinned-plus-deformed mesh), which exercises the clip geometry against
non-trivial, animated, deformed content without inventing a format capability (Law 3/4).

Two invariants bound every rule here, matching the rest of the solve:

1. **Determinism.** Same document, animation, and time in produces byte-portable results out: a fixed
   vertex-emission order, a fixed winding convention, and a fixed inside test, with no data-dependent
   branch that could reorder floating operations across languages. Booleans (hit results, clipped-slot
   membership) are EXACT; positions ride the shared VERTEX tolerance.
2. **No steady-state allocation.** The convex decomposition and buffer sizing are precomputed once per
   attachment; the per-frame world transform, clip, and hit test write into pooled buffers grown only
   when a larger job than any before appears (the same size-keyed growth `mesh-sample.ts` uses).

## Decision

### 1. The vertex-to-world transform (shared)

A `clipping` or `boundingbox` polygon rides its slot's bone. For each local vertex `(x, y)` the world
position is `world = slotBoneWorld * (x, y) = (a*x + c*y + tx, b*x + d*y + ty)` where `slotBoneWorld` is
the six-lane world matrix of the slot's driving bone (read from `pose.world` at `slotBoneIndex`, exactly as
the unweighted mesh path reads it). This is the single, allocation-free transform both clip and bounding
box use. World polygons are stored as `Float64Array` (not the `Float32Array` the mesh vertex path uses):
a clip/box world vertex is a single affine of a point (no weighted summation), so f64 carries the lowest
cross-language reordering noise and the ear-clip/inside-test arithmetic downstream stays clean.

### 2. Point attachment world resolution

A `point`'s world state is:

- **position** `= slotBoneWorld * (point.x, point.y)`, the same affine as a polygon vertex.
- **rotation (degrees)** `= point.rotation + worldRotationDeg(slotBoneWorld)`, where
  `worldRotationDeg(m) = atan2(m.b, m.a) * 180/PI` (the world x-axis angle, i.e. `getRotationDeg`). This is
  the bone's world rotation added to the point's local rotation. Under a sheared or reflected slot bone the
  x-axis-angle convention is the deterministic definition all runtimes reproduce (there is no unique
  "rotation" of a sheared frame; the x-axis angle is the chosen, pinned convention). `atan2` differs by a
  few ULPs across language math libs, so rotation rides a tolerance (the WORLD_BASIS-class angle tolerance,
  a small absolute degrees band), while position rides VERTEX; both are far below real-bug magnitude.

### 3. Clipping evaluation

Clipping has two products a renderer consumes: the CLIP STATE (what to clip, and the world polygon to clip
to) and the GEOMETRY OPERATION (clip a triangle stream to that polygon).

#### 3.1 Clip state: the affected slot range

The clip attachment lives on a slot (the CLIP slot) and names an `end` slot. In the CURRENT resolved draw
order (`pose.drawOrder`, the render-position -> slot-index permutation the solve writes each frame), let
`pClip` be the render position of the clip slot and `pEnd` the render position of the `end` slot. The
CLIPPED slot set is the slots at render positions `pClip+1 .. pEnd` inclusive (the slots drawn AFTER the
clip slot up to and including the end slot). When `pEnd <= pClip` (the `end` slot is at or before the clip
slot in draw order, degenerate authoring) the clipped set is EMPTY. The set is emitted as slot indices in
RENDER-POSITION ORDER (ascending render position), a discrete list compared EXACT in conformance. This
reads the per-frame draw order, so a draw-order timeline that reorders slots changes which slots a clip
affects, correctly and deterministically.

#### 3.2 Clip geometry: convex vs concave, and the winding rule

Sutherland-Hodgman clips a subject polygon against a CONVEX clip polygon. A clip attachment's polygon may
be concave. The decomposition choice (pinned):

- **Convexity is decided ONCE on the LOCAL polygon** in `prepareClipping`, because convexity is affine
  invariant: an affine (including a reflection, `det < 0`) maps a convex polygon to a convex polygon, so
  the world polygon has the same convexity as its local source every frame. A polygon is convex iff every
  consecutive-edge cross product shares one sign (collinear zeros allowed); a reflection flips all signs
  together, so the "all one sign" test still holds. This avoids a per-frame convexity test.
- **Convex clip polygon:** clip each input triangle against the WHOLE polygon in a single
  Sutherland-Hodgman pass, producing ONE output convex polygon. No decomposition, so no shared-diagonal
  double region.
- **Concave clip polygon:** ear-clip the LOCAL polygon into triangles ONCE in `prepareClipping` (the
  triangle index topology is affine invariant, so it is reused every frame with world vertices). Clip each
  input triangle against EACH clip triangle (each is convex) via Sutherland-Hodgman and emit each nonempty
  intersection as its own output ring. The clip region is the UNION of the clip triangles, so the union of
  the per-piece intersections is the triangle clipped to the concave region, expressed as a list of convex
  rings the renderer fan-triangulates.

**Winding rule (pinned):** each convex clip piece (the whole polygon in the convex case, or one ear-clip
triangle in the concave case) is oriented COUNTER-CLOCKWISE per frame by the sign of its world signed area
(reverse the piece iff signed area `< 0`). Sutherland-Hodgman then uses the CCW inside test "a point is
inside a clip edge iff it is to the LEFT of (or on) the directed edge," i.e. `cross(edge, point - edgeA)
>= 0`. Reorienting per frame makes the inside test correct even under a reflecting slot bone
(`det < 0` flips winding), with no data-dependent branch beyond the single sign check. The input triangle's
own winding is irrelevant (it is clipped as a ring).

**Intersection point convention (pinned):** when a subject edge from `A` (inside) to `B` (outside) crosses
a clip edge, the emitted vertex is `A + t*(B - A)` with `t = dA / (dA - dB)`, `dA`, `dB` the signed
left-of-edge distances of `A`, `B`. Barycentric coordinates of every output vertex with respect to the
SOURCE input triangle are carried alongside (computed by the same `t` lerp on the source-triangle
barycentrics of `A` and `B`), so a renderer interpolates UVs and vertex colors of the clipped triangle
without re-solving barycentrics. Original triangle corners carry their canonical barycentrics
`(1,0,0)`, `(0,1,0)`, `(0,0,1)`.

#### 3.3 Pooled output and the documented worst case

The clip output is written into pooled buffers (positions, barycentrics, per-ring vertex counts, per-ring
source-triangle index) grown only when a larger job appears. Worst-case output size per input triangle:

- **Convex** polygon with `V` vertices (`V` edges): one ring of at most `3 + V` vertices
  (Sutherland-Hodgman adds at most one vertex per clip edge to the 3-gon subject).
- **Concave** polygon with `V` vertices ear-clipped into `V - 2` triangles: each piece is a 3-edge convex
  clip, so at most `3 + 3 = 6` vertices per ring, over `V - 2` rings, i.e. at most `6*(V - 2)` vertices and
  `V - 2` rings.

So for a triangle stream of `T` triangles the pooled buffers are sized to
`T * max(3 + V, 6*(V - 2))` output vertices and (concave) `T*(V - 2)` rings; the convex case is `T` rings.
`prepareClipping` records `V`, the convex flag, and these per-triangle bounds so a caller sizes the pool
once for its largest expected triangle stream.

### 4. Bounding-box hit testing

- **World vertices:** the same section-1 unweighted transform of the box's polygon into world space, a
  pure accessor renderers/tools read (to draw a debug outline or feed a physics broadphase).
- **Point-in-polygon (pinned): even-odd (crossing number) ray casting.** A world point `(px, py)` is
  inside iff a ray from it (conventionally toward `+x`) crosses an odd number of polygon edges. The pinned
  edge-crossing test is the standard half-open convention that counts each edge on its `[yMin, yMax)` span
  so a vertex shared by two edges is not double-counted:
  `((ay > py) != (by > py)) && (px < (bx - ax) * (py - ay) / (by - ay) + ax)` toggles the inside flag per
  edge `A -> B`. Even-odd (not nonzero winding) is chosen because a bounding box is a simple hit volume
  whose "inside" is unambiguous under even-odd and because even-odd needs no winding normalization, so it
  is orientation-independent by construction (a CW or CCW authored box hits identically). The boolean is
  EXACT in conformance (a hit is a hit); a point exactly on an edge is a measure-zero authoring case whose
  result is whatever the half-open convention yields, deterministically.

### 5. Where this sits in the solve, and the math boundary

All three operations READ the solved pose (`pose.world`, `pose.drawOrder`) and never write it: they are
post-step-4 geometry accessors, not part of steps 1 to 6 of the per-frame pose solve, so they change no
existing fixture (every pre-PP-B2 fixture regenerates byte-identical). They consume only presentation
state; none reads RNG or a `SpinResult` or influences an outcome (Law 1 intact).

## Consequences

- `runtime-core` gains `skeleton/attachment-geometry.ts`: the shared unweighted world transform,
  `prepareClipping` (convexity + ear-clip topology + worst-case bounds), `resolveClipWorldPolygon`,
  `computeClippedSlotRange`, `clipTriangleList` (the pooled Sutherland-Hodgman with barycentrics),
  `boundingBoxWorldVertices`, `hitTestBoundingBox` (even-odd), and `resolvePointWorld`. All are
  allocation-free in steady state and PixiJS/DOM/Zod-free, so they port unchanged to C#/GDScript.
- The conformance corpus gains two rigs and new capture lanes: `rig-clipping` (an animated clip bone over a
  deforming mesh, capturing the world clip polygon on the VERTEX class and the clipped-slot set EXACT) and
  `rig-hit-point` (bounding boxes and points, capturing box world vertices on VERTEX, point world x/y on
  VERTEX and rotation on the angle tolerance, and hit-test booleans for committed probe points EXACT). The
  Sutherland-Hodgman geometry operation is locked cross-language by a committed golden vector
  (`cross-language/clip-geometry-vectors.json`, input polygon + triangle -> expected output rings +
  barycentrics), the same single-source mechanism the integer PRNG/CRC vectors use, so the clipper has real
  cross-implementation verification (the a2-coverage compensating control) beyond the per-frame rigs.
- Unity and Godot mirror the same three modules, the same winding and inside-test conventions, and the same
  pooled worst-case bounds, gated by the same fixtures and the same clip-geometry vector (the
  one-stage-lag rule).
- No format change and no bump: the attachment shapes already exist; this ADR adds only runtime behavior.

## Alternatives considered

- **Nonzero-winding point-in-polygon for hit testing.** Rejected: it requires a consistent input winding
  (or a per-call normalization) and diverges from even-odd only for self-overlapping polygons, which a hit
  volume should not be; even-odd is orientation-free and simpler to reproduce identically across languages.
- **A single Sutherland-Hodgman pass against a concave polygon.** Rejected: SH is only correct for a convex
  clip polygon; against a concave polygon it produces spurious geometry. The convex-piece decomposition is
  the standard correct construction.
- **Greiner-Hormann (general polygon-polygon clipping) for the concave case.** Rejected: it is more general
  than needed (the subject is always a triangle), and its degenerate-intersection handling is notoriously
  hard to make bit-portable across three languages; ear-clip-plus-per-triangle-SH is elementary, its
  determinism is obvious, and the triangle-vs-convex primitive is trivially portable.
- **Triangulating the concave clip polygon once GLOBALLY and clipping each ring against the whole polygon
  by point-membership.** Rejected: membership clipping does not produce the boundary intersection vertices a
  rasterizer needs; SH produces exact clipped boundaries with interpolable barycentrics.
- **Storing clip/box world polygons as Float32Array to match the mesh vertex path.** Rejected here: a
  clip/box vertex is a single affine (not a weighted sum), so f64 costs nothing and minimizes the
  cross-language noise feeding the ear-clip and inside tests; the mesh path's f32 is a memory choice for
  large vertex buffers that does not apply to these small polygons.
