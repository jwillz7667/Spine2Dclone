# Chapter 3: Rigging

Rigging turns a stack of images into a puppet: a bone hierarchy, draw slots riding those bones,
attachments in the slots, and (for organic motion) meshes, weights, and constraints.

## 3.1 Bones

A bone has a local transform relative to its parent: `x`, `y`, `rotation` (degrees),
`scaleX`/`scaleY` (negative values mirror), `shearX`/`shearY` (degrees), and a display
`length`. Bones form a tree; the document stores them parents-before-children, which is what
lets every runtime compute world transforms in a single forward pass.

Guidelines that hold for every rig:

- **One root.** Give the character a single root bone (a hip or a "character" bone) so you can
  move, flip, or scale the whole figure with one channel.
- **Bone per moving thing.** If it should ever move independently, it gets a bone. If two parts
  always move together, they share one.
- **Point bones down their limb.** Set `rotation` so the bone's +X axis runs along the limb and
  `length` spans it. IK and your future self both depend on this.
- **Name for the animator.** `arm-upper-L`, not `bone_017`. Renaming is safe at any time
  (references are by internal id, so renames never break animations or constraints).

### Transform inheritance modes

Each bone has a `transformMode` deciding what it inherits from its parent chain:

| Mode | Inherits | Typical use |
|---|---|---|
| `normal` | everything | default |
| `onlyTranslation` | position only | items that follow but never rotate (a held lantern that stays upright) |
| `noRotationOrReflection` | position + scale, no rotation/flip | heads or eyes that stay level while the body leans |
| `noScale` | position + rotation, no scale | props that must not squash with a squash-and-stretch parent |
| `noScaleOrReflection` | position + rotation, no scale and never mirrored | same, but also immune to a parent's negative scale |

### Structural edits

Reparenting keeps the bone's WORLD transform (the bone does not jump on screen; its local
values are recomputed), and reparenting a bone under its own descendant is rejected as a cycle.
Deleting a bone cascades: descendants, their slots, their attachments, and every timeline that
targeted any of them go too, and one undo restores all of it.

## 3.2 Slots and draw order

A slot is a named draw position owned by exactly one bone. The slot list IS the draw order:
index 0 paints first (back), the last slot paints on top. Slots carry:

- a `color` tint (RGBA, multiplied with the attachment's own color) and an optional
  `darkColor` for two-color tinting;
- a `blendMode`: `normal`, `additive` (glows, fire), `multiply` (shadows), `screen`
  (light bloom);
- an active `attachment` name, or `null` to draw nothing.

Design rule of thumb: slots are for layering and swapping, bones are for motion. A character
usually has more slots than bones near the face (eyes, brows, mouth states) and fewer along
plain limbs.

## 3.3 Region attachments

A region attachment is a textured rectangle: an atlas region (`path`) plus a placement relative
to the slot's bone (`x`, `y`, `rotation`, `scaleX`, `scaleY`) and the source pixel size
(`width`, `height`). It is the cheapest attachment and the right one for anything rigid: heads,
props, hard armor plates, background pieces.

Multiple attachments can live in one slot with only one active. That is the mechanism for mouth
shapes, hand poses, blinking eyes, and damage states: add `mouth-open`, `mouth-closed`,
`mouth-oo` to the mouth slot and swap the active one with keyframes (Chapter 4.4).

Facing flips deserve care: a character authored facing right is usually flipped by negating
scale on the root bone or on the host container, not by re-authoring attachments.

## 3.4 Meshes

A mesh attachment replaces the rectangle with a textured triangle net you can deform. Use a
mesh when a part must bend (limbs in one piece, hair, cloth, tails, faces) or when you want to
save fill-rate by hugging the silhouette.

A mesh is defined by:

- `uvs`: vertex positions in texture space;
- `triangles`: the triangulation;
- `hullLength`: how many vertices form the outer perimeter (the hull comes first in vertex
  order);
- `vertices`: the vertex positions (see weights below);
- optional `edges`: the editor's wireframe hints.

You get a mesh by converting a region (`mesh.generateFromRegion` starts as a quad), then
editing: add/move/delete vertices, or use the two automatic generators:
`mesh.autoGridFill` (regular interior grid, good for cloth-like deformation) and
`mesh.autoPerimeterTrace` (traces the image silhouette, good for tight outlines).

Two topology rules:

- Vertex indices stay stable through moves, so animations survive vertex tweaks.
- Once DEFORM keyframes exist on a mesh, its topology locks (adding or deleting vertices would
  invalidate the keyed offsets). Clear the attachment's deform keys first if you must
  re-topologize; this is the `MESH_TOPOLOGY_LOCKED` error.

## 3.5 Weights (skinning)

An unweighted mesh rides its slot's bone rigidly. Binding it to bones makes each vertex a
weighted blend of up to **4 bone influences**, weights summing to 1, which is what makes a knee
bend smoothly instead of creasing.

The workflow:

1. `mesh.bindToBones` with the bones that should influence the mesh. Seed weights with
   `rigidNearest` (each vertex fully follows its nearest bone; a clean starting point) or
   `equalSplit`.
2. `mesh.autoWeight` re-seeds by proximity if you added bones later.
3. Paint: `mesh.paintWeight` applies stroke dabs for one active bone in `add`, `subtract`, or
   `smooth` mode. In the editor this is the weight-paint brush; a whole stroke is one undo.
4. `mesh.normalizeWeights` re-normalizes everything to sum 1 under the 4-influence cap.

Painting advice: work one joint at a time, keep the falloff band across a joint roughly as wide
as the art's own bend region, and use `smooth` to fix candy-wrapper pinching. Verify by rotating
the bones to extremes, not by staring at the weight colors.

## 3.6 IK constraints

An IK constraint points a chain of one or two bones at a target bone, solving rotations so the
chain reaches toward it. Two-bone IK is the classic leg/arm setup: thigh and shin chain, a
"foot target" bone as the target.

Parameters:

- `bones`: the chain, which for two bones must be a parent and its DIRECT child;
- `target`: any bone (conventionally a dedicated target bone parented to the root, so it moves
  independently of the leg);
- `mix` (0..1): how strongly IK overrides the animated rotation; 0 is pure FK, 1 is pure IK,
  and values between blend. `mix` is keyframable per animation, so you can hand-animate a kick
  in FK and let IK plant the foot the rest of the time;
- `bendPositive`: which way the knee/elbow folds.

Remember the geometry: an IK chain can only reach `L1 + L2`. Rotation shortens vertical reach
(a leg rotated forward reaches less far down), so planting feet during extreme poses sometimes
needs translate keys on top of IK, not more rotation.

## 3.7 Transform constraints

A transform constraint copies channels from a target bone onto one or more constrained bones,
each channel with its own mix: `mixRotate`, `mixX`, `mixY`, `mixScaleX`, `mixScaleY`,
`mixShearY`, plus constant offsets per channel. The mixes are keyframable.

This is the rig-mechanics workhorse:

- **Follow**: wheels that counter-rotate, a hat that partially follows head tilt
  (`mixRotate: 0.6`).
- **Driven keys**: one controller bone driving several bones at fixed ratios (fingers curling
  together from one "fist" controller).
- **Offset copies**: a cape bone that tracks the shoulder with a lag offset.

Constraints solve in a fixed order after timelines: all IK constraints first, then all
transform constraints, then all path constraints, each in creation order. Order within a list
matters when constraints chain off each other's results; create them in dependency order. When
you need a different order (for example a path constraint that must run before a transform
constraint that reads its result), set an explicit cross-array solve order in the Constraints
panel (the Up/Down controls) or over the MCP `constraints.reorder` surface.

## 3.8 Path constraints

A path constraint distributes and orients a list of bones ALONG a path attachment: a smooth
piecewise cubic Bezier spline that lives on a slot (a conveyor rail, a tentacle spine, a
text-on-a-curve baseline, a motion guide). The constraint names the SLOT that carries the path
(not a bone, the one structural difference from IK and transform), plus the bones it drives.

Author it in two parts:

- **The rail (a path attachment).** Add a path attachment to a slot (the inspector, the viewport
  Path tool, or `attach.path.add`). It is a chain of cubic curves stored as control points laid
  out anchor, handle, handle, anchor: drag the anchors to shape the rail and the handles to bend
  each curve. Add or drop a curve to lengthen or shorten it, and toggle **Closed** to make it a
  loop. The editor recomputes the rail's arc-length table on every edit; you never enter it.
- **The constraint.** Point a path constraint at that slot and list the bones to ride the rail.
  Its parameters (edited in the Constraints panel or `path.setParams`, and keyframable in the
  dopesheet):
  - **`position`** slides the bones along the rail. **`positionMode`** reads it as an absolute
    arc length (`fixed`) or a `[0,1]` fraction of the whole (`percent`).
  - **`spacing`** sets the gap between consecutive bones. **`spacingMode`** distributes them by
    each bone's own `length`, a fixed arc distance (`fixed`), a fraction of the total (`percent`),
    or a proportional stretch-to-fit (`proportional`).
  - **`rotateMode`** orients each bone: to the path tangent (`tangent`, points downstream), toward
    the next bone (`chain`), or chain with length preservation (`chainScale`).
  - **`offsetRotation`** adds a constant degrees offset, and **`mixRotate`/`mixX`/`mixY`** blend
    how strongly the constraint writes each channel (a path constraint writes rotation and x/y
    translation only).
- **Constant speed.** Toggle **Constant speed** on the rail so a runtime advances `position` at
  uniform arc-length speed (using the committed length table) rather than the naive Bezier
  parameter, which bunches near tight curves. Leave it off for the raw parameter.

Path constraints are the tool for anything that follows a curve: a line of ducks gliding down a
stream, a train on a track, letters riding a banner, a chain of segments whipping along a spline.

## 3.9 Skins

A skin is a named set of attachments overlaying the default one, resolved per (slot,
attachment-name) address: at runtime the active skin is checked first, then the default skin.
Every document has a protected `default` skin.

Skins let one skeleton, one set of animations, and one set of weights serve many looks:
costume variants, palette swaps done with different atlas regions, seasonal reskins, or
character variants sharing a body plan. Author the rig and animations once against the default
skin, then `skin.create` and `skin.setAttachment` the variant art at the same addresses.

Deleting a skin cascades its deform timelines; the default skin cannot be renamed or deleted.

In the editor, the Skins panel manages this: create, rename, duplicate, or delete named skins, and
assign a per-slot region override for each slot's active attachment (the override is keyed by the
slot's placeholder name, so a live switch swaps that geometry in and inherits the rest from the
default skin). Duplicating a skin copies its assignments in one undo step. Selecting a skin also
PREVIEWS it in the viewport: the previewed skin is editor state, not part of the document, so
switching costumes to check them is never an undoable change and is never saved. The default skin is
listed for preview but is edited through the Inspector (its attachments are the default-slot
attachments).

### Skin scoping (Stage F2)

A named skin can also declare bones and constraints that are ACTIVE ONLY while it is the active
skin. This is how one skeleton carries structure that only some costumes need: extra bones for a
cape or a tail, or a constraint that should drive the rig only in a particular look. Each entry is
a NAME reference (a bone name, or a constraint name resolved across both the IK and transform
arrays, which share one namespace), so a rename never breaks the scoping. In the Skins panel, the
"Active only in this skin" section on the selected skin lists its scoped bones and constraints as
chips: add one from the dropdown of available names, or remove one with its `x`. Adding a name that
does not resolve, adding a duplicate, or removing one that is not scoped is rejected at the command
boundary; clearing the last entry in a dimension leaves the skin unscoped there. The runtime
activation semantics (which scoped bones and constraints participate under a given active skin) are
the player's to honor; the editor authors and validates the lists.

## 3.10 A rigging order that works

For a typical character:

1. Pack the atlas (Chapter 5) so region names exist.
2. Root bone, then spine chain, head, then limbs, in draw-order-friendly naming.
3. Slots back-to-front: far limbs, torso, near limbs, head, face details.
4. Region attachments everywhere first; get the whole character assembled and layered at setup
   pose before any mesh work.
5. Convert only the parts that must bend into meshes; bind and paint weights joint by joint.
6. Add IK last (legs, sometimes arms), then transform constraints for mechanics.
7. Validate (`document.validate`) and render a setup-pose frame before animating.
