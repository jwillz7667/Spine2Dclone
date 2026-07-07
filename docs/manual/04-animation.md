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

There is currently no animation event track (named triggers with payloads fired mid-animation).
Hosts that need frame-accurate triggers (footsteps, sound cues) key a sentinel channel or drive
cues from their own clock against known times. An event system is on the roadmap; when it
lands it will arrive as a format version bump with migrations.

## 4.9 Workflow advice

- Block first: key only the storytelling poses with stepped curves, get the timing right,
  then convert to beziers and add breakdowns. Timing errors are cheap to fix before polish.
- Key the extremes of a channel, let curves do the in-betweens; a channel with keys every
  tenth of a second is usually a curve problem being brute-forced.
- Name animations for the state machine that will play them (`idle`, `walk`, `attack-1`), and
  keep loop points consistent across them (same foot forward) so crossfades look continuous.
- Duplicate an animation (`anim.duplicate`) before experimenting with an alternative take.
- Render spot frames (`render_frame`) at the extremes and at transition times; poses that read
  in stills read in motion.
