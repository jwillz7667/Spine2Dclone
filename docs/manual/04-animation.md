# Chapter 4: Animation

An animation is a named set of keyframed timelines over the rig, with a duration in seconds.
A document holds any number of animations (`idle`, `walk`, `jump`, `talk`), and the runtime can
layer and crossfade them.

## 4.1 Timelines and channels

Each animation may key, independently per target:

| Target | Channels | Key value |
|---|---|---|
| Bone | `rotate` | `{ angle }` degrees |
| Bone | `translate` | `{ x, y }` |
| Bone | `scale` | `{ x, y }` |
| Bone | `shear` | `{ x, y }` degrees |
| Slot | `color` | `{ color: { r, g, b, a } }` |
| Slot | attachment swap | attachment name or `null` |
| IK constraint | mix + bend | `{ mix, bendPositive }` |
| Transform constraint | mixes | any subset of the six mix factors |
| Mesh attachment | deform | per-vertex offset array |

Unkeyed channels stay at the setup pose. Keyed values are ABSOLUTE: a rotate key of
`{ angle: 20 }` means the bone's local rotation IS 20 degrees at that time, replacing (not
adding to) the setup value. If you want "setup plus a wiggle", key the setup value at the
loop's rest points explicitly.

## 4.2 Keyframes

A keyframe is `(time, value, curve)`. Rules:

- Times are seconds within `[0, duration]`, unique per timeline (setting a key at an occupied
  time replaces it; moving a key onto another is a collision error).
- The duration cannot shrink below the last key; extend or delete keys first.
- The `curve` is the OUTGOING interpolation, describing the segment from this key to the next:
  - `linear`: constant speed;
  - `stepped`: hold this value, then jump at the next key (mouth shapes, eye states, anything
    that must not tween);
  - `bezier { cx1, cy1, cx2, cy2 }`: a cubic easing curve. The x controls are in `[0, 1]`
    (they warp time); the y controls are unbounded, so overshoot and anticipation are legal.
    `(0.25, 0, 0.75, 1)` is a pleasant ease-in-out; `(0.5, 0, 0.5, 1.4)` overshoots.
- The last key's curve is ignored (nothing follows it).

The attachment-swap timeline has no curves; swaps are instantaneous by nature. The IK
`bendPositive` boolean is likewise sampled stepped even when the surrounding key has a curve.

## 4.3 Looping

The runtime samples a single period; looping is the transport's job (`syncAnimatedLoop` or a
looping track wraps time for you). For a seamless loop, make the value at `duration` equal the
value at `0` on every keyed channel. The classic walk-cycle layout keys contact poses at
`0`, `duration/2`, and `duration`, with passing poses between.

## 4.4 Attachment swap animation

Keying the attachment timeline switches which attachment a slot shows, or hides the slot with
`null`. This drives:

- **Lip sync**: one `mouth` slot, one attachment per mouth shape, stepped keys on dialog
  timing.
- **Blinks**: `eyes-open`/`eyes-closed` keys a few frames apart.
- **State changes**: weapon drawn/holstered, damage overlays.

Because swaps are per-slot, keep swap art registered to a common anchor (same origin, same
scale) so the head does not appear to move when only the mouth should change.

## 4.5 Deform keyframes

A deform key stores per-vertex offsets for one mesh attachment, on top of skinning: the mesh is
skinned by its weights first, then keyed offsets add on the result. Deform keys are addressed
by skin, so a costume variant can deform differently.

Use deform keys for what bones do badly: breathing chests, cheek squash, cloth ripples,
squints. Use them sparingly; each key stores `2 x vertexCount` floats, and a mesh with deform
keys locks its topology (Chapter 3.4).

## 4.6 The solve order

Every runtime executes exactly this per frame, and authoring assumes it:

1. Reset every bone, slot color, and active attachment to the setup pose.
2. Apply animation timelines (bone locals, slot colors, attachment swaps, constraint mixes,
   deform offsets).
3. Solve constraints: all IK first, then all transform constraints, in order.
4. Compute world transforms in one pass down the tree.
5. Skin meshes with weights, then add deform offsets.
6. Render slots in draw order with each slot's blend mode and color.

Consequences worth internalizing:

- Constraints run AFTER timelines, so IK overrides animated rotation (blended by its mix).
- Deform is applied after skinning, so offsets ride the bones rather than fighting them.
- Because step 1 resets everything, animations do not leak into each other between frames;
  what you key is all that plays.

## 4.7 Tracks, mixing, and crossfades (runtime)

Authoring produces individual animations; the runtime's **animation state** layers them:

- **Tracks** are numbered layers. Track 0 is the base (walk); higher tracks apply on top
  (aim, talk, hit reactions). Each track has an `alpha` (blend weight) and can be `additive`.
- `setAnimation(track, name, loop)` snaps a track to an animation.
- `crossfadeTo(track, name, loop, mixDuration)` eases from the current animation into the next:
  the outgoing animation fades out exactly as the incoming fades in, with rotation blending
  along the shortest arc. Starting a new crossfade mid-crossfade drops the oldest layer rather
  than stacking.
- `queueAnimation(track, name, delay)` chains "play land, then idle".
- Discrete channels (attachment swaps, IK bend direction) cannot be half-blended, so during a
  mix the higher-weight side wins.

Typical character setup: `idle`/`walk`/`run` crossfading on track 0 (0.2 s mixes), blinks and
talk mouths on track 1, additive breathing on track 2.

## 4.8 Events

Events are named triggers, fired at a keyed time on an animation's event timeline, that a host reads
to drive a cue (a footstep sound, a screen shake, a coin-shower spawn) without hard-coding the time in
host code. They arrived with format 0.3.0.

An event is defined once on the document, in the Events panel: a unique `name`, optional payload
defaults (an integer, a float, and a string the host reads), and an optional audio hint (a source
`path`, a `volume` in [0, 1], and a stereo `balance` in [-1, 1]) the host may play directly. Editing a
definition (its name, its payload defaults, its audio) is undoable, and a rename never breaks the keys
that fire it (a key references the definition by identity, not by name). Deleting a definition removes
every key that fired it, in one undo step.

An animation fires an event by keying it on the events row of the dopesheet: pick a defined event, move
the playhead to the firing time, and add a key. A single key may override any of the payload defaults
for that one firing. Event times are non-decreasing (two events may fire at the same time, unlike the
strictly ordered value channels), events are discrete (they carry no curve), and a key is draggable and
deletable like any other. The meaning of a firing (which payload wins, whether it re-fires across a loop
boundary) is playback behavior the runtimes own; the editor authors only the data.

## 4.9 Draw-order animation

The setup draw order (section 4.6, step 6) is the slot order in the hierarchy; a draw-order timeline
overrides it over time, so a slot can pass in front of another for part of an animation (a hand crossing
in front of the body, a card flipping to the top of the stack) and then return. It arrived with format
0.3.0.

Author a draw-order key by reordering the slots at the playhead: move the playhead to the change time,
reorder the slots, and key the result. The whole reorder-and-key interaction is one undo step. A key
stores a compact list of the slots that moved and how far (a signed offset from each slot's setup
index), so an unchanged order is an empty key that restores the setup order after an earlier reorder,
and only the slots that actually moved are recorded. The editor rejects an inconsistent reorder (two
slots landing on the same position, or a slot pushed past the ends) before it is keyed. Draw-order
changes are discrete (stepped, no curve); keys are draggable and deletable like keyframes. Deleting a
slot drops it from every draw-order key automatically.

## 4.10 The dopesheet: editing keys

The dopesheet shows every keyed timeline of the active animation as a row: a group row per
animated bone, slot, or constraint, then one row per channel under it. Bone rows show
`Rotate`/`Translate`/`Scale`/`Shear`; a slot shows `Color`, its `Attachment` swap timeline, and a
`Deform` row per meshed attachment (with the skin in parentheses for a non-default skin); an IK or
transform constraint shows a `Mix` row; and every animation always shows the `Events` and
`Draw Order` rows so their keys stay addable even when empty. Rows appear only when they hold keys
(except the two always-on special rows), and they sort by name so they do not jump around as you
edit.

Working with keys:

- **Select** by clicking a key diamond, shift-clicking to toggle, or dragging a marquee. Selection
  is by identity, so it survives edits, renames, and reorders.
- **Move** the selected value, event, and draw-order keys by dragging (hold Alt to bypass frame
  snapping); the whole drag is one undo step, and a move onto another key is rejected rather than
  overwriting it.
- **Delete** with the Delete or Backspace key. This removes every selected key across every row
  kind (bone and slot channels, attachment, deform, IK, transform, events, draw order) in a single
  undo step.
- **Scrub** by dragging in the ruler; the transport bar plays, loops, and reports the frame.

**Playback speed.** The transport bar carries a speed control from 0.1x to 2x. Speed scales the
playback clock only; it never changes the authored timing, the keys, or the exported data, so it is
a preview aid for inspecting fast motion or checking slow ease, not an animation property.

**Manual keys.** Auto-key writes a key only when a value changes. To plant a key at the current
value without nudging it (holding a pose or a color across a span), use the inspector's `Key`
button: the bone-transform section keys all four bone channels at the playhead in one undo step, and
the slot color row keys the current color. Both work regardless of the auto-key toggle and are
disabled when no animation is active.

## 4.11 Workflow advice

- Block first: key only the storytelling poses with stepped curves, get the timing right,
  then convert to beziers and add breakdowns. Timing errors are cheap to fix before polish.
- Key the extremes of a channel, let curves do the in-betweens; a channel with keys every
  tenth of a second is usually a curve problem being brute-forced.
- Name animations for the state machine that will play them (`idle`, `walk`, `attack-1`), and
  keep loop points consistent across them (same foot forward) so crossfades look continuous.
- Duplicate an animation (`anim.duplicate`) before experimenting with an alternative take.
- Render spot frames (`render_frame`) at the extremes and at transition times; poses that read
  in stills read in motion.
