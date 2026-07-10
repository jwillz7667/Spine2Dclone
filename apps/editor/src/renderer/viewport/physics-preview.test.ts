import { describe, expect, it } from 'vitest';
import { derivePhysicsFrameDt, MAX_PHYSICS_FRAME_DT } from './physics-preview';

describe('derivePhysicsFrameDt (the viewport physics live-preview clock, ADR-0014)', () => {
  it('advances by the real delta scaled by speed while playing', () => {
    expect(derivePhysicsFrameDt(true, 1 / 60, 1)).toBeCloseTo(1 / 60, 12);
    // Half speed steps physics at half rate so it stays in lockstep with the slowed playhead.
    expect(derivePhysicsFrameDt(true, 1 / 60, 0.5)).toBeCloseTo(1 / 120, 12);
  });

  it('is inert (0) while paused, regardless of the elapsed wall-clock delta', () => {
    // Paused: a stationary playhead is not a simulation step, so physics does not move (settles when stopped).
    expect(derivePhysicsFrameDt(false, 1 / 60, 1)).toBe(0);
    expect(derivePhysicsFrameDt(false, 5, 2)).toBe(0);
  });

  it('treats a scrub (paused playhead set) as 0 so the solve teleports through its own RESET_DISTANCE', () => {
    // A scrub is a manual playhead SET while paused: isPlaying is false, so the physics delta is 0 and the
    // editor adds no reset hack; a large jump teleports through the solve's RESET_DISTANCE contract.
    expect(derivePhysicsFrameDt(false, 0, 1)).toBe(0);
  });

  it('caps a stalled frame at MAX_PHYSICS_FRAME_DT so the sim cannot explode', () => {
    // A backgrounded tab hands back a multi-second delta; the physics step is capped even though the playhead
    // itself would advance further.
    expect(derivePhysicsFrameDt(true, 3, 1)).toBe(MAX_PHYSICS_FRAME_DT);
    // The cap is applied AFTER the speed scale, so a fast speed on a moderate delta still clamps.
    expect(derivePhysicsFrameDt(true, 0.05, 2)).toBe(MAX_PHYSICS_FRAME_DT);
  });

  it('floors a zero, backward, or non-finite advance to 0', () => {
    expect(derivePhysicsFrameDt(true, 0, 1)).toBe(0);
    expect(derivePhysicsFrameDt(true, -1 / 60, 1)).toBe(0);
    expect(derivePhysicsFrameDt(true, Number.NaN, 1)).toBe(0);
    expect(derivePhysicsFrameDt(true, Number.POSITIVE_INFINITY, 1)).toBe(0);
  });

  it('does not clamp a normal 60fps frame (the cap only tames spikes)', () => {
    const dt = derivePhysicsFrameDt(true, 1 / 60, 1);
    expect(dt).toBeLessThan(MAX_PHYSICS_FRAME_DT);
    expect(dt).toBeGreaterThan(0);
  });
});
