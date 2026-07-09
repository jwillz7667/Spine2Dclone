import { describe, expect, it } from 'vitest';
import { makeKeyframe, type KeyframeValue } from '../src/index';
import type { KeyframeId } from '../src/model/ids';

// The Stage F2 (ADR-0009, PP-D10) value-union threading: makeKeyframe deep-copies (via cloneKeyframeValue)
// and deep-freezes EVERY channel value shape, including the added scalar (`value`), rgb (`rgb`), and alpha
// (`alpha`) split shapes. A copy must never alias the source, and the source must be safe to mutate after.
const id = 'keyframe_1' as KeyframeId;

function roundTrip(value: KeyframeValue): KeyframeValue {
  return makeKeyframe(id, 0, value, 'linear').value;
}

describe('keyframe value union (Stage F2 scalar/rgb/alpha)', () => {
  it('deep-copies a scalar value without aliasing the source', () => {
    const source = { value: 3 };
    const copy = roundTrip(source);

    expect(copy).toEqual({ value: 3 });
    expect(copy).not.toBe(source);
    expect(Object.isFrozen(copy)).toBe(true);
  });

  it('deep-copies an rgb value, cloning the RGB triple', () => {
    const source = { rgb: { r: 0.1, g: 0.2, b: 0.3 } };
    const copy = roundTrip(source);

    expect(copy).toEqual({ rgb: { r: 0.1, g: 0.2, b: 0.3 } });
    if ('rgb' in copy) expect(copy.rgb).not.toBe(source.rgb);
  });

  it('deep-copies an alpha value', () => {
    const copy = roundTrip({ alpha: 0.75 });

    expect(copy).toEqual({ alpha: 0.75 });
    expect(Object.isFrozen(copy)).toBe(true);
  });
});
