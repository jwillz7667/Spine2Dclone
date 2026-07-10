# Chapter 9: Tool Reference (MCP Control Surface)

Armature 2D exposes its entire authoring surface as a set of MCP (Model Context Protocol) tools.
The GUI panels and the MCP tools drive the exact same command layer (`@marionette/document-core`),
so everything in this reference is also a precise description of what the editor itself can do.
Anything you can click, you can script; anything you can script, you can undo.

This chapter is the complete reference: 187 tools across 24 namespaces. For a guided walkthrough
that uses a small subset of these, read Chapter 1 (Getting Started) first.

## Conventions used by every tool

- Every tool validates its input against a strict schema. Unknown fields are rejected, and
  malformed input returns a typed `INVALID_INPUT` error rather than a partial edit.
- Almost every tool takes a `documentId`, the handle returned by `document.new` or
  `document.open`. An unknown id returns `DOCUMENT_NOT_FOUND`.
- Every **mutating** tool executes a document-core command through the session's History.
  Mutations return `{ revision }` (the document revision after the edit); creation tools return
  the new id instead (`{ boneId }`, `{ slotId }`, `{ animationId }`, and so on).
- Failures are typed. Domain errors carry a `reason` code, for example `CONSTRAINT` (with reasons
  like `cycle`, `chainArity`, `targetMissing`), `SKIN` (`defaultProtected`, `duplicateName`),
  `MESH_BINDING`, `MESH_TOPOLOGY_LOCKED`, `DEFORM` (`notMesh`, `offsetLength`),
  `KEYFRAME_COLLISION`, `REPARENT_CYCLE`, `ANIMATION_DURATION`, `EFFECT_EDIT`, `SLOT_EDIT`.
- Colors are always RGBA objects `{ r, g, b, a }` with each channel in `0..1`.
- Angles are degrees. Times are seconds unless a field is explicitly named `...Ms`.
- Consecutive MCP calls never auto-coalesce into one undo step. To group a gesture (for example a
  scripted drag) into a single undo entry, wrap it in `history.beginInteraction` /
  `history.endInteraction`.

## Session and document lifecycle: `document.*`

Sessions are in-memory documents managed by the server (up to 16 at once). The lifecycle is:
create or open, edit through commands, validate, save, close.

| Tool | Purpose | Input | Returns |
|---|---|---|---|
| `document.new` | Create a new empty skeleton document | `name` | `{ documentId }` |
| `document.open` | Read a document from disk, validate it, open a session | `path` | `{ documentId, document }` |
| `document.save` | Export to portable format JSON and write to disk | `documentId`, `path` | `{ path }` |
| `document.close` | Discard the session | `documentId` | `{ closed: true }` |
| `document.validate` | Validate the current state against the format contract | `documentId` | `{ ok, errors }` |
| `document.export` | Project the session to a portable `SkeletonDocument` | `documentId` | `{ document }` |
| `document.getSnapshot` | Internal snapshot (bones, ordering) for inspection | `documentId` | `{ snapshot }` |
| `document.setMetadata` | Set the authoring metadata block (`fps`, `imagesPath`, `audioPath`); all absent clears it | `documentId`, optional `fps`/`imagesPath`/`audioPath` | `{ revision }` |
| `document.getWorldTransforms` | Solve the setup pose and return each bone's world matrix | `documentId` | `{ transforms: [{ name, world: [a,b,c,d,tx,ty] }] }` |

Always check `document.validate` returns `{ ok: true }` before treating a document as done; the
`errors` array carries the typed `FormatError` list when it is not.

## Undo and redo: `history.*`

| Tool | Purpose | Input | Returns |
|---|---|---|---|
| `history.undo` | Undo the most recent change | `documentId` | `{ event }` |
| `history.redo` | Redo the most recently undone change | `documentId` | `{ event }` |
| `history.getState` | Query undo/redo availability and labels | `documentId` | `{ canUndo, canRedo, undoLabel, redoLabel }` |
| `history.beginInteraction` | Start a coalescing interaction (a "gesture") | `documentId` | `{ ok: true }` |
| `history.endInteraction` | Commit the interaction as ONE undo step | `documentId`, `label` | `{ event }` |

## Bones: `bone.*`

| Tool | Purpose | Key input |
|---|---|---|
| `bone.create` | Create a bone, optionally parented | `parentId` (or `null` for a root), `name`, `x`, `y`, `rotation`, `length`, `scaleX`, `scaleY`, `shearX`, `shearY`, `transformMode` |
| `bone.move` | Set local translation | `boneId`, `x`, `y` |
| `bone.rotate` | Set local rotation in degrees | `boneId`, `rotation` |
| `bone.scale` | Set local scale | `boneId`, `scaleX`, `scaleY` |
| `bone.shear` | Set local shear in degrees | `boneId`, `shearX`, `shearY` |
| `bone.setLength` | Set the bone's length | `boneId`, `length` |
| `bone.rename` | Rename a bone | `boneId`, `name` |
| `bone.delete` | Delete a bone and all of its descendants | `boneId` |
| `bone.reparent` | Reparent while holding the world transform; rejects cycles | `boneId`, `newParentId` |
| `bone.transformMode` | Set how the bone inherits from its parent | `boneId`, `mode` |
| `bone.list` | List all bones in document order | (documentId only) |
| `bone.get` | Get a single bone | `boneId` |

`transformMode` values: `normal`, `onlyTranslation`, `noRotationOrReflection`, `noScale`,
`noScaleOrReflection`. See Chapter 3 for what each mode means.

## Slots (skeletal draw slots): `slot.*`

Note: the `slot.` prefix is shared with the slot-game composer namespaces further down. The nine
tools here operate on skeletal draw slots.

| Tool | Purpose | Key input |
|---|---|---|
| `slot.create` | Create a slot attached to a bone | `boneId`, `name`, optional `color`, `darkColor`, `attachment`, `blendMode` |
| `slot.delete` | Delete a slot and its attachments | `slotId` |
| `slot.rename` | Rename a slot | `slotId`, `name` |
| `slot.blend` | Set the slot's blend mode | `slotId`, `blendMode` (`normal`, `additive`, `multiply`, `screen`) |
| `slot.color` | Set the slot tint | `slotId`, `color` |
| `slot.darkColor` | Set or clear the slot's setup two-color DARK tint (Stage F2) | `slotId`, `darkColor` (RGBA) or `null` |
| `slot.reorder` | Move the slot within the draw order | `slotId`, `toIndex` |
| `slot.activeAttachment` | Set the setup-pose active attachment (or `null` to hide) | `slotId`, `attachment` |
| `slot.list` | List slots in draw order | (documentId only) |
| `slot.get` | Get a slot plus its attachment names | `slotId` |

A common trap: adding an attachment does NOT make it visible. Call `slot.activeAttachment`
after `attach.region.add` or nothing renders.

## Region attachments: `attach.*`

| Tool | Purpose | Key input |
|---|---|---|
| `attach.region.add` | Add a region (image) attachment to a slot | `slotId`, `name`, `path` (atlas region), `x`, `y`, `rotation`, `scaleX`, `scaleY`, `width`, `height`, `color` |
| `attach.region.transform` | Update placement/size; omitted fields keep their value | `slotId`, `name`, any of the transform fields |
| `attach.linkedmesh.create` | Add a linked mesh reusing a parent mesh's geometry | `slotId`, `name`, `path`, `parent`, `skin?`, `timelines`, `width`, `height`, `color` |
| `attach.linkedmesh.unlink` | Bake a linked mesh to a plain mesh | `slotId`, `name` |
| `attach.sequence.set` | Set or clear a region/mesh frame-sequence | `slotId`, `name`, `sequence` (count/start/digits/setupIndex) or null |
| `attach.path.add` | Add a path (cubic Bezier rail) attachment; omit `vertices` for the default two-curve open path | `slotId`, `name`, `closed`, `constantSpeed`, `vertices?` (flat [x0,y0,...] control points) |
| `attach.remove` | Remove an attachment from a slot | `slotId`, `name` |

## Paths (Bezier rails): `path.*`

A path attachment is an unweighted piecewise cubic Bezier spline on a slot, used as a rail that a path
constraint distributes bones along. The cumulative arc-length `lengths` table is recomputed by the tool on
every control-point edit (authoring owns it, ADR-0011); callers never supply it. Control points are the flat
`[x0, y0, x1, y1, ...]` stream laid out anchor, handle, handle, anchor; `pointIndex` addresses a logical
control point. Edits are rejected as `PATH` with a `reason` (`notFound`, `pointRange`, `minCurves`).

| Tool | Purpose | Key input |
|---|---|---|
| `path.get` | Read a path's openness, parametrization flag, control points, and arc-length table | `slotId`, `name` |
| `path.moveControlPoint` | Move one control point (anchor or handle); recomputes lengths | `slotId`, `name`, `pointIndex`, `x`, `y` |
| `path.addCurve` | Append one cubic curve (three control points) to the end | `slotId`, `name` |
| `path.removeCurve` | Drop the last curve (a path keeps at least one) | `slotId`, `name` |
| `path.setClosed` | Toggle openness; adjusts the control-point stream to stay valid | `slotId`, `name`, `closed` |
| `path.setConstantSpeed` | Flip arc-length vs naive-`t` parametrization | `slotId`, `name`, `constantSpeed` |

## Meshes and weights: `mesh.*`

Mesh geometry (vertices, UVs, triangles, hull) is computed by the caller and passed as flat
number arrays; the commands validate and install it. Topology edits fail with
`MESH_TOPOLOGY_LOCKED` when deform keys exist on the mesh (clear them first with
`deform.clearAttachment`), and weight edits fail with `MESH_BINDING` plus a reason.

Topology:

| Tool | Purpose |
|---|---|
| `mesh.generateFromRegion` | Replace a region attachment with a mesh (initial quad or custom geometry) |
| `mesh.addVertex` | Add an interior vertex (caller supplies re-triangulated arrays) |
| `mesh.moveVertex` | Move one vertex; indices stay stable |
| `mesh.deleteVertex` | Delete a vertex (caller supplies re-triangulated arrays) |
| `mesh.setEdges` | Set the wireframe edge pairs |
| `mesh.autoGridFill` | Replace the interior with a regular grid |
| `mesh.autoPerimeterTrace` | Replace geometry with a silhouette-traced hull plus fill |

Skinning:

| Tool | Purpose |
|---|---|
| `mesh.bindToBones` | Convert an unweighted mesh to a weighted one (`boneIds`, `weightMode`: `rigidNearest` or `equalSplit`) |
| `mesh.addBoneBinding` | Add one bone influence |
| `mesh.removeBoneBinding` | Remove one bone influence |
| `mesh.unbind` | Clear all weights, back to unweighted |
| `mesh.autoWeight` | Re-seed all weights by proximity |
| `mesh.paintWeight` | Apply a weight-paint stroke: `activeBoneId`, `dabs` of `{ vertexIndex, deltaWeight }`, `mode` (`add`, `subtract`, `smooth`) |
| `mesh.normalizeWeights` | Re-normalize every vertex to sum 1 with at most 4 influences |

## IK constraints: `ik.*`

| Tool | Purpose | Key input |
|---|---|---|
| `ik.createConstraint` | Create an IK constraint over a 1 or 2 bone chain | `name`, `boneIds` (1 or 2, parent-child), `targetId`, `mix` (0..1), `bendPositive` |
| `ik.setMix` | Set the mix | `ikConstraintId`, `mix` |
| `ik.setBendPositive` | Flip the bend direction | `ikConstraintId`, `bendPositive` |
| `ik.setDepth` | Patch the Stage F2 depth fields | `ikConstraintId`, any of `softness` / `stretch` / `compress` / `uniform` |
| `ik.deleteConstraint` | Delete the constraint and cascade its timelines | `ikConstraintId` |
| `ik.setKeyframe` | Key mix + bend in an animation | `animationId`, `ikConstraintId`, `time`, `mix`, `bendPositive`, optional `curve` |
| `ik.deleteKeyframe` | Delete an IK keyframe | `animationId`, `ikConstraintId`, `keyframeId` |
| `ik.moveKeyframe` | Move an IK keyframe to a new time (rejects a collision) | `animationId`, `ikConstraintId`, `keyframeId`, `time` |
| `ik.list` | List IK constraints in solve order | |
| `ik.get` | Get one constraint | `ikConstraintId` |

## Transform constraints: `transform.*`

A transform constraint drives one or more bones toward a target bone through twelve channels:
six mix factors (`mixRotate`, `mixX`, `mixY`, `mixScaleX`, `mixScaleY`, `mixShearY`, each 0..1)
and six offsets (`offsetRotation`, `offsetX`, `offsetY`, `offsetScaleX`, `offsetScaleY`,
`offsetShearY`).

| Tool | Purpose | Key input |
|---|---|---|
| `transform.createConstraint` | Create a constraint | `name`, `boneIds`, `targetId`, `params` (any of the 12 channels) |
| `transform.setParams` | Patch one or more channels | `transformConstraintId`, `patch` |
| `transform.setVariants` | Patch the Stage F2 local/relative flags | `transformConstraintId`, any of `local` / `relative` |
| `transform.deleteConstraint` | Delete and cascade timelines | `transformConstraintId` |
| `transform.setKeyframe` | Key the mix factors in an animation | `animationId`, `transformConstraintId`, `time`, `mix` (any of the 6 factors), optional `curve` |
| `transform.deleteKeyframe` | Delete a keyframe | `animationId`, `transformConstraintId`, `keyframeId` |
| `transform.moveKeyframe` | Move a keyframe to a new time (rejects a collision) | `animationId`, `transformConstraintId`, `keyframeId`, `time` |
| `transform.list` | List in solve order | |
| `transform.get` | Get one constraint | `transformConstraintId` |

## Path constraints and timelines: `path.*`

A path constraint distributes and orients a list of bones along the path attachment carried by a target
SLOT (Stage F3, ADR-0011). It shares the single combined solve-order namespace with IK and transform. The
`position`/`spacing`/`offsetRotation` scalars are unbounded; the three mix channels are in `[0,1]`. Create and
param edits are rejected as `CONSTRAINT` with a `reason` (`targetMissing`, `targetNotPath`, `boneMissing`,
`chainArity`, `duplicateName`). The timeline tools mirror `ik.*`: each keyframe carries a partial set of the
five channels (an omitted channel keeps its base value at solve time).

| Tool | Purpose | Key input |
|---|---|---|
| `path.createConstraint` | Create a path constraint over a target slot and a bone list | `name`, `targetSlotId`, `boneIds`, `params` (modes + scalars + mix) |
| `path.setParams` | Patch modes/scalars/mix (only the named fields) | `pathConstraintId`, any of the parameter fields |
| `path.deleteConstraint` | Delete a constraint, cascading its path timelines | `pathConstraintId` |
| `path.listConstraints` | List path constraints in solve order | `documentId` |
| `path.getConstraint` | Get one path constraint by id | `pathConstraintId` |
| `path.setKeyframe` | Insert or update a path keyframe | `animationId`, `pathConstraintId`, `time`, optional `position`/`spacing`/`mixRotate`/`mixX`/`mixY`, `curve?` |
| `path.moveKeyframe` | Retime a keyframe (`KEYFRAME_COLLISION` if occupied) | `animationId`, `pathConstraintId`, `keyframeId`, `time` |
| `path.deleteKeyframe` | Delete a keyframe by id | `animationId`, `pathConstraintId`, `keyframeId` |

## Constraint order: `constraints.*`

| Tool | Purpose | Key input |
|---|---|---|
| `constraints.reorder` | Set the explicit cross-array solve order, or clear it | `order` (combined IK-then-transform-then-path ids), or `order: null` to restore the default |

## Skins: `skin.*`

The default skin always exists and cannot be renamed or deleted (`SKIN` error, reason
`defaultProtected`). Named skins overlay it.

| Tool | Purpose | Key input |
|---|---|---|
| `skin.create` | Create a named skin | `name` |
| `skin.rename` | Rename a named skin | `skinId`, `name` |
| `skin.delete` | Delete a named skin and cascade its deform timelines | `skinId` |
| `skin.scope.add` | Add a bone or constraint NAME to the skin's Stage F2 active-only scoping list | `skinId`, `scope` (`bones`/`constraints`), `name` |
| `skin.scope.remove` | Remove a name from the skin's scoping list (clears the dimension when empty) | `skinId`, `scope`, `name` |
| `skin.setAttachment` | Add or replace a region attachment in the skin at (slot, name) | `skinId`, `slotId`, `attachment` (full region description) |
| `skin.removeAttachment` | Remove the attachment at (slot, name) | `skinId`, `slotId`, `name` |
| `skin.list` | List named skins | |
| `skin.get` | Get one named skin | `skinId` |

## Deform timelines: `deform.*`

Deform keyframes store per-vertex offsets for a mesh attachment inside an animation, addressed
by skin (`"default"` or a named skin id), slot, and attachment name.

| Tool | Purpose | Key input |
|---|---|---|
| `deform.setKeyframe` | Insert or update a deform key | `animationId`, `skin`, `slotId`, `name`, `time`, `offsets` (must match the mesh vertex count), optional `curve` |
| `deform.deleteKeyframe` | Delete a deform key | ..., `keyframeId` |
| `deform.moveKeyframe` | Move a key to a new time (`KEYFRAME_COLLISION` if occupied) | ..., `keyframeId`, `time` |
| `deform.clearAttachment` | Remove ALL deform keys for (slot, attachment) across every animation and skin; unlocks topology editing | `slotId`, `name` |

## Animations: `anim.*`

| Tool | Purpose | Key input |
|---|---|---|
| `anim.create` | Create an empty animation | `name`, `duration` (seconds) |
| `anim.delete` | Delete an animation and all of its timelines | `animationId` |
| `anim.rename` | Rename | `animationId`, `name` |
| `anim.duration` | Set the duration; rejects shrinking below the last keyframe (`ANIMATION_DURATION`) | `animationId`, `duration` |
| `anim.duplicate` | Duplicate under a new name | `animationId`, `name` |
| `anim.list` | List animations with track counts | |
| `anim.get` | Get an animation with all timelines and keyframes | `animationId` |
| `anim.sequence.set` | Insert or update a slot frame-sequence key (Stage F2) | `animationId`, `slotId`, `time`, `mode`, `index`, `delay` |
| `anim.sequence.move` | Move a sequence key (by id) to a new time (rejects a collision) | `animationId`, `slotId`, `keyframeId`, `time` |
| `anim.sequence.delete` | Delete a sequence key at a time | `animationId`, `slotId`, `time` |

## Keyframes: `kf.*`

The channel selects the target kind. The bone channels take a `boneId`: the joint channels `rotate`,
`translate`, `scale`, `shear`, plus the Stage F2 per-component split channels `translateX`, `translateY`,
`scaleX`, `scaleY`, `shearX`, `shearY`. The slot channels take a `slotId`: the joint `color`, the two-color
`dark` tint, and the Stage F2 split color channels `rgb` and `alpha`. The value shape must match the
channel: `{ angle }` for rotate, `{ x, y }` for translate/scale/shear, `{ value }` for the split bone
components, `{ color }` for color/dark, `{ rgb }` for rgb, and `{ alpha }` for alpha. A joint channel and
its split components never coexist on one bone/slot (`TIMELINE`, reason `componentConflict`): key
`translate` OR `translateX`/`translateY` (likewise scale/shear), and `color` OR `rgb`/`alpha`.

Curves are per-key outgoing interpolation: `"linear"`, `"stepped"`, or
`{ type: "bezier", cx1, cy1, cx2, cy2 }`.

| Tool | Purpose | Key input |
|---|---|---|
| `kf.set` | Insert or update a keyframe | `animationId`, `channel`, `boneId`/`slotId`, `time`, `value`, optional `curve` |
| `kf.move` | Move a key to a new time (`KEYFRAME_COLLISION` if occupied) | ..., `keyframeId`, `time` |
| `kf.delete` | Delete a key | ..., `keyframeId` |
| `kf.curve` | Set a key's outgoing curve | ..., `keyframeId`, `curve` |
| `kf.paste` | Insert many keys as ONE undo step | `animationId`, `items[]` of `{ channel, boneId?/slotId?, time, value, curve }` |
| `kf.attachment.set` | Key an attachment swap (or `null` to hide) at a time | `animationId`, `slotId`, `time`, `name` |
| `kf.attachment.delete` | Delete the attachment key at a time | `animationId`, `slotId`, `time` |
| `kf.attachment.move` | Move an attachment key (by id) to a new time (rejects a collision) | `animationId`, `slotId`, `keyframeId`, `time` |

## Events and draw order: `event.*` and `draworder.*`

Events are named triggers (with optional int/float/string payload defaults and an audio hint) defined
once on the document, then fired at keyed times on an animation's event timeline. A key references its
definition by id, so a rename never breaks the keys that fire it; deleting a definition removes every key
that fired it in one undo step. Event times are non-decreasing (coincident firings are legal) and carry no
curve. A draw-order timeline reorders which slot draws in front of which over time; each key stores a
compact list of signed slot offsets from the setup order (an empty list restores the setup order). Both
are animation timelines, so their keys move and delete by `keyframeId` like value keys; draw-order times
are strictly ascending (`KEYFRAME_COLLISION` on an occupied move) while event moves never collide.

| Tool | Purpose | Key input |
|---|---|---|
| `event.define` | Define an event and return its id | `documentId`, `name`, optional `int`/`float`/`string`, optional `audio` (`{ path, volume, balance }`) |
| `event.rename` | Rename an event (unique names, `EVENT_EDIT`) | `documentId`, `eventId`, `name` |
| `event.delete` | Delete an event and cascade its keys | `documentId`, `eventId` |
| `event.setDefaults` | Set the payload defaults (absent field clears it) | `documentId`, `eventId`, optional `int`/`float`/`string` |
| `event.setAudio` | Set or clear the audio hint (range-checked, `EVENT_EDIT`) | `documentId`, `eventId`, optional `audio` |
| `event.list` | List event definitions | `documentId` |
| `event.get` | Get one event definition | `documentId`, `eventId` |
| `event.key.set` | Insert or update a firing at a time (optional per-firing payload override) | `documentId`, `animationId`, `eventId`, `time`, optional `int`/`float`/`string` |
| `event.key.move` | Move a firing (no collision) | `documentId`, `animationId`, `keyframeId`, `time` |
| `event.key.delete` | Delete a firing | `documentId`, `animationId`, `keyframeId` |
| `draworder.key.set` | Insert or update a reorder at a time (`offsets` of `{ slot, offset }`; `DRAW_ORDER` if inconsistent) | `documentId`, `animationId`, `time`, `offsets[]` |
| `draworder.key.move` | Move a reorder (`KEYFRAME_COLLISION` if occupied) | `documentId`, `animationId`, `keyframeId`, `time` |
| `draworder.key.delete` | Delete a reorder | `documentId`, `animationId`, `keyframeId` |

`anim.get` includes the animation's `events` and `drawOrder` timelines; `document.setMetadata` (in the
lifecycle section) sets the authoring `fps` and the source-asset directories that pair with events.

## Atlas: `atlas.*`

| Tool | Purpose | Key input |
|---|---|---|
| `atlas.pack` | Headless pipeline: read source PNGs, pack deterministic atlas pages, write them, install the atlas reference | `sourceDir`, `outputDir` (project-relative, confined to the project root), optional `maxPageSize` (up to 4096), `padding` |
| `atlas.set` | Install a pre-built atlas reference (pages and regions) | `atlas` |
| `atlas.get` | Return the current atlas reference | |

## Headless rendering: `render_frame`

Rasterizes the current document to a PNG so a scripted or AI-driven session can SEE its work.

Input: optional `animation` name and `time` to pose, `width`/`height` (default 512, max 2048),
`fit` (`"content"` or an explicit `{ x, y, w, h }` window), `background` color, and an optional
`effect` overlay (`{ effect?or bundle?, seed, time, anchors }`) to composite VFX.
Returns `{ pngBase64, width, height, bytes, placeholders }`; `placeholders` lists regions that
had no texture and rendered as tinted stand-ins.

## Effects (VFX): `effect.*` and `bundle.*`

Effects are simulation-deterministic particle/VFX definitions: same seed, same frames. An effect
is a stack of layers; each layer is an `emitter`, `spriteAnimator`, or `ribbonTrail`.

Library and metadata:

| Tool | Purpose | Key input |
|---|---|---|
| `effect.create` | Create an empty effect | `name`, optional `duration` (or `null` for looping), `deterministic`, `simulationDt`, `blendMode` |
| `effect.delete` | Delete an effect (cascades bundle items that used it) | `effectId` |
| `effect.rename` | Rename | `effectId`, `name` |
| `effect.setMeta` | Patch duration / determinism / simulation step | `effectId`, fields |
| `effect.setAtlas` | Replace the VFX atlas (rejects dangling region references) | `atlas` |
| `effect.getAtlas` / `effect.getSnapshot` / `effect.list` / `effect.get` | Read back | |

Layers:

| Tool | Purpose | Key input |
|---|---|---|
| `effect.layer.add` | Append a layer | `effectId`, `kind` (`emitter`, `spriteAnimator`, `ribbonTrail`), `blendMode` (default additive), `region` |
| `effect.layer.remove` | Remove a layer | `effectId`, `layerId` |
| `effect.layer.reorder` | Reorder layers (z order) | `effectId`, `order[]` |
| `effect.layer.setField` | Replace the layer body (emitter spawn/shape/texture/ranges/gravity/drag/trail and so on) | `effectId`, `layerId`, `field`, `body` |
| `effect.layer.setBlendMode` | Per-layer blend | `effectId`, `layerId`, `blendMode` |

Life and length curves (`effect.lifeStop.*`): every layer carries gradient-style curves such as
`scaleOverLife`, `colorOverLife`, `alphaOverLife` (particles) and `widthOverLength`,
`colorOverLength`, `alphaOverLength`, `trailWidthOverLength`, `trailAlphaOverLength` (ribbons
and trails). Each curve is a list of stops; the two anchor stops at t=0 and t=1 are protected.

| Tool | Purpose |
|---|---|
| `effect.lifeStop.add` | Insert an interior stop at `t` in (0,1) with a scalar or `{ r, g, b }` value |
| `effect.lifeStop.remove` | Remove an interior stop |
| `effect.lifeStop.move` | Move a stop to a new `t` |
| `effect.lifeStop.setValue` | Change a stop's value |
| `effect.lifeStop.setCurve` | Change a stop's easing |

Bundles (`bundle.*`) compose effects into playlists: each item is
`{ effect, startOffset, anchorRole, seedSalt }` so one trigger (say, "big win") can fire several
effects at named anchor points with staggered starts.

| Tool | Purpose |
|---|---|
| `bundle.create` / `bundle.delete` | Create or delete a named bundle |
| `bundle.item.add` / `bundle.item.remove` / `bundle.item.reorder` / `bundle.item.set` | Manage items |
| `bundle.list` / `bundle.get` | Read back |

## Slot-game composer: `slot.grid.*`, `slot.symbol.*`, `slot.winseq.*`, `slot.flow.*`, `slot.tumble.*`

These namespaces author the slot composition layer (Chapter 7). They never decide outcomes; they
map a `SpinResult` from the certified math engine to presentation.

Grid:

| Tool | Purpose | Key input |
|---|---|---|
| `slot.grid.set` | Set the grid | `grid`: topology (`reelStrip`, `scatterPay`, `cluster`), `cols`/`rows` (1..12), cell size and gap, `reelStopStaggerMs`, gravity, anticipation |
| `slot.grid.preset` | Apply a canonical preset | `preset`: `reelStrip5x3`, `scatterPay6x5`, `cluster7x7` |
| `slot.grid.get` | Read back | |

Symbols:

| Tool | Purpose | Key input |
|---|---|---|
| `slot.symbol.map` | Map a symbol id to a skeleton and its animation set | `symbolId`, `animSet` `{ skeletonRef, idle, land, win, anticipation? }` |
| `slot.symbol.unmap` | Remove a mapping | `symbolId` |
| `slot.symbol.list` / `slot.symbol.get` | Read back | |

Win sequencer:

| Tool | Purpose | Key input |
|---|---|---|
| `slot.winseq.create` | Create a named sequence | `name` |
| `slot.winseq.setStep` | Set or append a step | `sequenceName`, `index`, `step` `{ atMs, target, action }` |
| `slot.winseq.reorderSteps` | Reorder steps | `sequenceName`, `order[]` |
| `slot.winseq.setThresholds` | Big/mega/epic escalation thresholds | `thresholds` |
| `slot.winseq.get` | Read back | |

Step targets: `allWinningCells`, `byLine { index }`, `bySymbol { symbol }`.
Step actions: `animateWin`, `vfx { preset, anchorRule }`, `rollupStart { curve }`,
`escalationBanner { tier }`.

Feature flow (state machine for base game, free spins, bonuses):

| Tool | Purpose |
|---|---|
| `slot.flow.createState` / `slot.flow.deleteState` / `slot.flow.renameState` | Manage states (the base state is protected) |
| `slot.flow.addTransition` / `slot.flow.removeTransition` | Manage `{ from, on, to }` transitions |
| `slot.flow.get` | Read back |

Tumble/cascade choreography:

| Tool | Purpose |
|---|---|
| `slot.tumble.set` | Timing: `explodeMs`, `dropMs`, `dropEasing`, `refillStaggerMs`, `settleMs`, `stepGapMs`, `rollupCurve` |
| `slot.tumble.get` | Read back |

Finally, `slot.scene.get` returns the whole composition snapshot (grid, symbols, win sequencer,
flows, tumble) in one call.
