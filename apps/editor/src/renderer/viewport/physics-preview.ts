// The viewport's physics live-preview clock policy (ADR-0014 section 2.2). PHYSICS carries velocity across
// frames, so the solve must advance its simulation clock by the REAL elapsed animation time each frame while
// playing, and by NOTHING when the playhead is not moving. This module is the pure decision that turns the
// transport state plus the playback ticker's wall-clock delta into that per-frame physics delta; the viewport
// tick (viewport-panel-content.tsx) reads it and forwards it to SkeletonView.syncAnimated. No React, no
// document, no store access: it is a pure function of its inputs, unit tested here (the editor vitest env is
// `node`, so decisions live in modules like this and the .tsx is glue covered by typecheck and lint).
//
// This never reads Date.now: the delta comes from the SAME playback ticker the transport advances the playhead
// with (the playback clock owns time), so physics stays in lockstep with the animation it rides on. The inputs
// are positional primitives and the result is a number, so calling it per frame allocates nothing.

// The largest physics simulation step taken in a single frame (seconds). A backgrounded tab or a GC stall can
// hand the ticker a very large delta; feeding that straight into the physics clock would make the sim take one
// violent catch-up step (a spring launched across the screen). Capping the per-frame advance lets a hitch
// settle smoothly instead of exploding. This bounds ONLY the physics clock, never the animation playhead (the
// transport advances that on its own), so authored timing is unchanged; real-time playback is already
// wall-clock dependent, so a stalled frame is non-deterministic regardless and the cap only tames the spike.
// 0.064s is roughly four frames at 60fps: generous enough that normal frame pacing is never clamped, tight
// enough that a multi-second stall cannot detonate the sim.
export const MAX_PHYSICS_FRAME_DT = 0.064;

// Derive the physics simulation delta for this frame (seconds) from the transport:
//   - PLAYING          => realDelta * speed, capped at MAX_PHYSICS_FRAME_DT (a stalled frame cannot explode
//                         the sim); this is the elapsed animation time this frame, so physics tracks playback.
//   - PAUSED / IDLE    => 0: a stationary playhead is not a simulation step, so physics is inert and every
//                         idle frame is bit-stable (no perpetual motion, no allocation, deterministic).
//   - SCRUB            => 0: a scrub is a manual playhead SET while paused (isPlaying is false), so it also
//                         yields 0. A jump larger than the solve's RESET_DISTANCE teleports through the solve's
//                         own contract (ADR-0014); the editor adds no reset hack of its own.
// `isPlaying` is passed by the caller as "the transport is advancing the playhead this frame" (playing AND an
// animation of non-zero duration is active), so physics steps exactly when playback moves. A non-positive or
// non-finite advance (a zero, backward, or garbage delta) floors to 0: the clock never runs backward or NaN.
export function derivePhysicsFrameDt(
  isPlaying: boolean,
  realDeltaSeconds: number,
  playbackSpeed: number,
): number {
  if (!isPlaying) return 0;
  const advance = realDeltaSeconds * playbackSpeed;
  if (!Number.isFinite(advance) || advance <= 0) return 0;
  return advance < MAX_PHYSICS_FRAME_DT ? advance : MAX_PHYSICS_FRAME_DT;
}
