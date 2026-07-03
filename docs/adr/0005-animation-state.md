# ADR-0005: AnimationState (tracks, crossfade, additive layering) in runtime-core

- Status: ACCEPTED 2026-07-03
- Deciders: lead + product owner (the LLM-authoring priority amendment, DEV_PLAN section 9)
- Cross-refs: the locked per-frame solve order (CLAUDE.md), ADR-0003 (constraint solve semantics),
  `docs/plan/cross-cutting/conformance-and-ci.md` (fixtures from runtime-core)

## Context

Every production skeletal runtime's central game-facing feature is playing MULTIPLE animations at once:
crossfading a walk into a run, layering a "hit flash" over a base idle, queueing a win celebration after
a landing. Armature 2D has none of this anywhere: the runtime API is "sample ONE animation at time t"
(`sampleSkeleton`), and looping lives in the transport. The parity audit ranks this the single largest
missing runtime feature, and the LLM-authoring path needs it for Pragmatic-class presentation (win
overlays layered on base spins, seamless anticipation-to-celebration transitions).

Constraints that shape the design:

1. **The format is untouched.** Mixing is RUNTIME state, not document state. A `SkeletonDocument` knows
   its animations; it does not know what a game is currently playing. No `formatVersion` change.
2. **Determinism (Law 1 posture).** Same document + same sequence of (API calls, dt steps) must produce
   identical poses everywhere. No wall clock: the state advances only by an explicit `dt`.
3. **The locked solve order.** Timeline application is step 2 of the six-step order. Mixing must happen
   INSIDE step 2 (blend the applied local/slot values), never after the world pass (blending world
   matrices shears; blending locals is what every skeletal runtime does and what keeps constraints
   correct, because step 3 reads the blended locals).
4. **No per-frame allocation** in steady state, like every other solve path.
5. **Three runtimes.** Unity/Godot reimplement this from the spec + fixtures, so semantics must be
   written down exactly, with conformance fixtures generated from the TS reference.

## Decision

### API surface (runtime-core)

A new `AnimationState` (plain object + pure functions, matching the repo's stateless-by-default style):

```ts
makeAnimationState(document): AnimationState
setAnimation(state, trackIndex, animationId, loop): TrackEntry     // replaces the track, no mix
crossfadeTo(state, trackIndex, animationId, loop, mixDuration): TrackEntry // mix from current
queueAnimation(state, trackIndex, animationId, loop, delay): TrackEntry    // after the current
clearTrack(state, trackIndex): void
updateAnimationState(state, dt): void                              // advances time and mixes, fires nothing yet
applyAnimationState(state, pose): void                             // steps 1-4 with blended step 2
```

`TrackEntry` (public readonly view): `{ animationId, loop, trackTime, alpha, additive, mixFrom,
mixDuration, mixTime }`. `alpha` is the track's blend weight (default 1); `additive: boolean` selects
the layering rule below.

### Semantics (NORMATIVE; Unity/Godot build against this section plus the fixtures)

1. **Tracks apply in ascending index order** on top of the setup pose. Track 0 is the base layer.
2. **A non-additive track at weight w REPLACES toward its sampled value**: for every channel the
   animation KEYS, `result = lerp(current, sampled, w)`. Channels the animation does not key are left
   as the layers below wrote them (setup pose for track 0). Rotation lerps along the shortest arc;
   translate/scale/shear/color lerp componentwise.
3. **An additive track at weight w ADDS the sampled delta from setup**:
   `result = current + (sampled - setup) * w` per keyed channel (rotation delta normalized to
   (-180, 180]). Attachment and draw-order-like discrete channels are IGNORED by additive tracks.
4. **Crossfade**: `crossfadeTo` moves the current entry to `mixFrom`. During the mix,
   `w_in = mixTime / mixDuration` (clamped [0, 1]) eases linearly; the incoming entry applies at
   `alpha * w_in` and the outgoing at `alpha * (1 - w_in)`, outgoing first, THEN incoming (both under
   rules 2/3). When `mixTime >= mixDuration`, `mixFrom` is dropped. A crossfade from a crossfade
   drops the older `mixFrom` immediately (single-level mixing, the standard simplification; deep mix
   chains are unpredictable for authors and unbounded for runtimes).
5. **Discrete channels** (attachment swaps; ik `bendPositive`): the entry with the GREATER current
   weight wins at each frame (ties: the incoming entry). No interpolation, ever.
6. **Looping**: a looping entry wraps `trackTime` into [0, duration); a non-looping entry clamps at
   duration (matching `sampleSkeleton`'s clamp) and stays there. `queueAnimation` starts its entry when
   the current entry has completed plus `delay` seconds (delay >= 0; on a looping current entry the
   queue starts at the next loop boundary plus delay).
7. **Constraint mix channels** blend like continuous locals (rule 2/3): they are step-2 values the
   step-3 solve reads, so blending them preserves the locked order.
8. **Events (format 0.3.0, deferred)**: `updateAnimationState` will own loop-crossing event firing when
   event timelines land; the API shape reserves nothing and needs no change for it.

### Implementation shape

`sampleSkeleton`'s step 2 is refactored into an internal `applyAnimationAt(pose, prepared, t, alpha,
additive, discreteWins)` that today's single-animation path calls with `(t, 1, false, true)` (bit-for-bit
identical output; the existing conformance fixtures prove the refactor changes nothing). Blending state
(per-channel "was this channel written this frame" tracking for rule 2's keyed-channel scoping) lives in
pose-owned scratch sized once per document. `applyAnimationState` then runs: reset (step 1), the track
loop over `applyAnimationAt` (step 2), constraints (step 3), world (step 4), sharing every existing
step implementation.

`runtime-web` gains the thin mirror (`SkeletonView.syncState(document, state)`) plus mesh sampling on
top of the state-solved pose, reusing the same render path.

### Conformance

A new fixture family `anim-state` generated from runtime-core: (a) mid-crossfade poses at fixed
fractions, (b) an additive layer over a base loop, (c) discrete-channel winner flips across the 50%
weight crossing, (d) queue start timing across a loop boundary. Locked behind the same
`.fixtures.lock` tripwire; Unity/Godot assert against them in Phase 5.

## Consequences

- The game-facing API exists at last; the slot composer's win-sequencer can crossfade and layer
  presentation animations instead of hard-cutting.
- The step-2 refactor touches the hottest solve path; the existing byte-locked fixtures gate it.
- Single-level mixing is a deliberate cap; revisiting it later is additive (a deeper mixFrom chain),
  not breaking.
- Unity/Godot Phase 5 scope grows by this spec plus its fixture family.
