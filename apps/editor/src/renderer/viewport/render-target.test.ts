import { describe, expect, it } from 'vitest';
import { renderTargetsEqual, resolveRenderTarget, type RenderTarget } from './render-target';

describe('resolveRenderTarget (the viewport render-target decision, WP-1.10)', () => {
  it('renders setup in setup mode, independent of any active animation or playhead', () => {
    expect(resolveRenderTarget('setup', 'idle', 0)).toEqual({ kind: 'setup' });
    expect(resolveRenderTarget('setup', 'idle', 3.5)).toEqual({ kind: 'setup' });
  });

  it('renders the sampled animated target in animation mode with a resolved name', () => {
    expect(resolveRenderTarget('animation', 'idle', 1.25)).toEqual({
      kind: 'animated',
      animation: 'idle',
      time: 1.25,
    });
  });

  it('falls back to setup in animation mode when no animation name resolves', () => {
    expect(resolveRenderTarget('animation', null, 2)).toEqual({ kind: 'setup' });
  });

  it('maps two playheads to different animated targets but identical setup targets', () => {
    const early = resolveRenderTarget('animation', 'idle', 0.5);
    const late = resolveRenderTarget('animation', 'idle', 1.5);

    expect(early).not.toEqual(late);
    expect(renderTargetsEqual(early, late)).toBe(false);

    // Setup is playhead-independent: equal by value AND the same shared reference (allocation-free idle).
    const setupAtZero = resolveRenderTarget('setup', null, 0);
    const setupAtNine = resolveRenderTarget('setup', null, 9);
    expect(setupAtZero).toEqual(setupAtNine);
    expect(setupAtZero).toBe(setupAtNine);
    expect(renderTargetsEqual(setupAtZero, setupAtNine)).toBe(true);
  });
});

describe('renderTargetsEqual (the ticker re-render gate)', () => {
  it('treats every setup target as equal, and setup versus animated as unequal', () => {
    const setup: RenderTarget = { kind: 'setup' };
    const animated: RenderTarget = { kind: 'animated', animation: 'idle', time: 0 };

    expect(renderTargetsEqual(setup, { kind: 'setup' })).toBe(true);
    expect(renderTargetsEqual(setup, animated)).toBe(false);
    expect(renderTargetsEqual(animated, setup)).toBe(false);
  });

  it('matches animated targets only when both the name and the time agree', () => {
    const base: RenderTarget = { kind: 'animated', animation: 'idle', time: 1 };

    expect(renderTargetsEqual(base, { kind: 'animated', animation: 'idle', time: 1 })).toBe(true);
    expect(renderTargetsEqual(base, { kind: 'animated', animation: 'idle', time: 2 })).toBe(false);
    expect(renderTargetsEqual(base, { kind: 'animated', animation: 'walk', time: 1 })).toBe(false);
  });
});
