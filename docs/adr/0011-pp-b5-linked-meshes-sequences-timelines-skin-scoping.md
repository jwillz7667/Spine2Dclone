# ADR-0011 (ADR-B5.SOLVE.2): linked-mesh, sequence, timeline-granularity, and skin-scoping solve semantics

Status: Accepted (2026-07-09)
Owner: Lane B (Core solve and conformance)
Gates: the PP-B5 solve behavior for the NON-constraint stage F2 fields that ADR-0009 carried as data at
no-op defaults (constraint depth and order are the sibling ADR-0010). Every default (a plain mesh, no
sequence, joint timelines only, no skin scoping) reproduces the pre-F2 solve, so pre-F2 fixtures stay
byte-identical.
Cross-ref: `docs/adr/0009-*` sections 2 (linked meshes), 3 (sequences), 4 (timeline granularity), 5 (skin
scoping); `docs/adr/0003-constraint-solve-semantics.md` section 9 (deform); `CLAUDE.md` per-frame solve
order steps 2 and 5; `docs/plan/pro-parity-execution-plan.md` Lane B (PP-B5).

## Context

ADR-0009 (format 0.4.0) added linked meshes, sequence attachments, per-component and split-color and dark
slot timelines, and skin-scoped bone/constraint lists to the format, and deferred every solve meaning to
Lane B. This ADR pins that meaning, from the published CONCEPT of each feature (Law 4), so all three
runtimes compute identically and conformance locks it. It is landed as sequential vertical slices; each
section below is marked with its slice as it lands.

## Decision

### 1. Linked meshes (ADR-0009 section 2) [IMPLEMENTED, PP-B5 slice 4]

A `linkedmesh` attachment has no geometry of its own; it reuses a parent mesh's geometry and optionally
its deform timeline. Two independent resolutions, each a bounded walk of the parent chain (the format
guarantees it is acyclic via `LINKED_MESH_CYCLE` and resolvable via `LINKED_MESH_PARENT_*`):

- **Geometry source.** Starting at the linked mesh, follow `parent` (an attachment named on the SAME slot
  in skin `skin ?? the linked mesh's skin`) until a `type: 'mesh'` node is reached. That ROOT mesh supplies
  `uvs`, `triangles`, `hullLength`, `vertices`, and the weight manifest `bones`. The linked mesh is skinned
  exactly as that geometry would be, using the pose's current bone world matrices and the LINKED MESH's own
  slot bone (the slot is shared, so the slot bone is the same). The linked mesh's own `color`, `path`,
  `width`, `height` are RENDER inputs, not vertex-solve inputs, so runtime-core (which solves, never
  renders) ignores them; the vertex stream is a pure function of the inherited geometry and the pose.

- **Deform source (the `timelines` flag).** `timelines: false` means the linked mesh has its OWN deform
  timeline, looked up under its own `(skin, slot, name)`. `timelines: true` means it SHARES the deform of
  the attachment it links to: walk the parent chain while the current node is a linked mesh with
  `timelines: true`, stopping at the first node that is a real mesh or a linked mesh with `timelines:
  false`; that node's `(skin, slot, name)` is the deform key. The deform offsets there are authored against
  the same inherited geometry (same vertex count), so `applyDeform` adds them on the skinned vertices
  exactly as for a plain mesh (ADR-0003 section 9, post-skin, world-space, additive).

A plain `mesh` is unchanged: geometry source is itself, deform source is its own `(skin, slot, name)`, so
every existing mesh fixture is byte-identical. `DEFORM_NOT_MESH` continues to fire only for an attachment
that is neither a mesh nor a linked mesh.

### 2. Sequence attachments (ADR-0009 section 3) [IMPLEMENTED, PP-B5 slice 5]

A region or mesh attachment may carry a `sequence` block (`count` frames, `start`, `digits`, `setupIndex`);
a per-slot `sequence` timeline of keyframes `{ time, mode, index, delay }` then drives which frame plays.
The solve resolves a DISCRETE integer frame in `[0, count)` per sample, by pure integer arithmetic so all
runtimes agree EXACTLY (the fixture compares it with no tolerance). Turning the frame into an atlas region
name (`path` + zero-padded `start + frame` to `digits`) is a renderer concern, not a solve concern, so
runtime-core resolves only the index.

Resolution at time `t` for a slot:

1. If the slot's resolved active attachment (the animatable attachment state, read from the solved pose)
   has no `sequence` block, there is nothing to resolve (the fixture omits the slot; the query returns -1).
2. Else, find the active `sequence` timeline key (the last key with `time <= t`; keys are strict-ascending).
   Before the first key, or with no `sequence` timeline, the attachment shows its `setupIndex`.
3. Else, with active key `{ time: kt, mode, index, delay }`, let `elapsed = t - kt` and `advanced =
   (delay > 0 && elapsed > 0) ? floor(elapsed / delay) : 0` (a non-positive delay advances no frames). The
   mode maps `index` and `advanced` to a frame:
   - `hold`: `index` (clamped to `[0, count)`); `advanced` is ignored.
   - `once`: `min(index + advanced, count - 1)` (plays forward, stops on the last frame).
   - `loop`: `(index + advanced) mod count`.
   - `pingpong`: a triangle wave over `[0, count-1]` with period `2*(count-1)`, sampled at `index +
     advanced` (bounces between the ends).
   - `onceReverse`: `max(index - advanced, 0)` (plays backward, stops on frame 0).
   - `loopReverse`: `(index - advanced) mod count` with a non-negative residue.
   - `pingpongReverse`: the same triangle wave sampled at `index - advanced` (bounces starting downward).
   `count <= 1` resolves to frame 0 (a single-frame sequence has nowhere to advance).

A rig with no sequence attachment and no `sequence` timeline resolves nothing, so no existing fixture gains
a sequence lane and all stay byte-identical.


### 3. Timeline granularity: per-component, split color, dark color (ADR-0009 section 4) [PLANNED, slice 6]

### 4. Skin scoping (ADR-0009 section 5) [PLANNED, PP-B5 slice 7]

## Consequences

- `runtime-core` mesh sampling resolves a linked mesh to its geometry root and its deform source before
  skinning; a plain mesh takes the identity resolution, so its fixtures are byte-identical.
- The conformance corpus gains `rig-linked-mesh` (a linked mesh inheriting a weighted mesh's geometry,
  with both `timelines` values), observed on the existing mesh-vertex lane.
- Unity and Godot mirror the same two walks (the one-stage-lag rule).

## Alternatives considered

- Modeling the linked mesh's geometry inline (copying uvs/vertices at load). Rejected: it duplicates the
  data the format deliberately shares and drifts if the parent is edited; resolving through the chain at
  sample time keeps one source of truth, matching the format's intent.
- Using the ROOT mesh's deform for `timelines: true` rather than the immediate shared ancestor's. Rejected:
  the flag's meaning is "share the parent's timeline," so the walk stops at the first non-sharing ancestor,
  which is the attachment whose deform is actually authored.
