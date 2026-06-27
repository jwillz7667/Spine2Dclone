import { describe, expect, it } from 'vitest';
import { advance, keyframeValueEquals, loopEndpointsDiffer, loopTime } from './transport';
import { addAnimation, addBone, createEmptyDocument, setRotateKeys } from './seed-document';

describe('transport math', () => {
  it('loopTime folds elapsed into [0, duration) including negative and zero duration', () => {
    expect(loopTime(0, 1.2)).toBeCloseTo(0, 12);
    expect(loopTime(1.35, 1.2)).toBeCloseTo(0.15, 12);
    expect(loopTime(2.4, 1.2)).toBeCloseTo(0, 12);
    expect(loopTime(-0.1, 1.2)).toBeCloseTo(1.1, 12);
    expect(loopTime(5, 0)).toBe(0);
  });

  it('advance wraps when looping and clamps with reachedEnd when not', () => {
    expect(advance(1.1, 0.25, 1.2, true)).toEqual({
      playhead: loopTime(1.35, 1.2),
      reachedEnd: false,
    });
    expect(advance(1.1, 0.25, 1.2, false)).toEqual({ playhead: 1.2, reachedEnd: true });
    expect(advance(0.5, 0.25, 1.2, false)).toEqual({ playhead: 0.75, reachedEnd: false });
    expect(advance(0.1, -0.5, 1.2, false)).toEqual({ playhead: 0, reachedEnd: false });
    expect(advance(0.5, 1, 0, true)).toEqual({ playhead: 0, reachedEnd: true });
  });

  it('keyframeValueEquals compares per channel shape and rejects mismatched shapes', () => {
    expect(keyframeValueEquals({ angle: 8 }, { angle: 8 })).toBe(true);
    expect(keyframeValueEquals({ angle: 8 }, { angle: 9 })).toBe(false);
    expect(keyframeValueEquals({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
    expect(keyframeValueEquals({ x: 1, y: 2 }, { x: 1, y: 3 })).toBe(false);
    expect(
      keyframeValueEquals(
        { color: { r: 1, g: 1, b: 1, a: 1 } },
        { color: { r: 1, g: 1, b: 1, a: 1 } },
      ),
    ).toBe(true);
    expect(keyframeValueEquals({ angle: 1 }, { x: 1, y: 1 })).toBe(false);
  });

  it('flags loop-endpoint mismatch only when a channel first and last differ', () => {
    const matched = createEmptyDocument();
    const matchedBone = addBone(matched, 'root');
    const matchedAnim = addAnimation(matched, 'idle', 1.2);
    setRotateKeys(matched, matchedAnim, matchedBone, [
      { time: 0, value: { angle: 0 } },
      { time: 0.6, value: { angle: 8 } },
      { time: 1.2, value: { angle: 0 } },
    ]);
    expect(loopEndpointsDiffer(matched.model.getAnimation(matchedAnim)!)).toBe(false);

    const popped = createEmptyDocument();
    const poppedBone = addBone(popped, 'root');
    const poppedAnim = addAnimation(popped, 'idle', 1.2);
    setRotateKeys(popped, poppedAnim, poppedBone, [
      { time: 0, value: { angle: 0 } },
      { time: 1.2, value: { angle: 12 } },
    ]);
    expect(loopEndpointsDiffer(popped.model.getAnimation(poppedAnim)!)).toBe(true);
  });
});
