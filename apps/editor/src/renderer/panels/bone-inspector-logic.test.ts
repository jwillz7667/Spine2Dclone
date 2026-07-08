import { describe, expect, it } from 'vitest';
import { buildBoneEdit, parseBoneField, type BoneTransformValues } from './bone-inspector-logic';

const LIVE: BoneTransformValues = {
  x: 10,
  y: -5,
  rotation: 30,
  scaleX: 2,
  scaleY: 0.5,
  shearX: 4,
  shearY: -3,
};

describe('parseBoneField', () => {
  it('accepts a finite change and returns the parsed value', () => {
    expect(parseBoneField('x', '42.5', 10)).toBe(42.5);
    expect(parseBoneField('rotation', '-90', 30)).toBe(-90);
  });

  it('rejects empty and non-finite input (no dispatch)', () => {
    expect(parseBoneField('x', '', 10)).toBeNull();
    expect(parseBoneField('x', '   ', 10)).toBeNull();
    expect(parseBoneField('rotation', 'abc', 30)).toBeNull();
    expect(parseBoneField('y', 'NaN', -5)).toBeNull();
    expect(parseBoneField('x', 'Infinity', 10)).toBeNull();
  });

  it('rejects an unchanged value so an idempotent commit creates no undo step', () => {
    expect(parseBoneField('x', '10', 10)).toBeNull();
    expect(parseBoneField('scaleX', '2', 2)).toBeNull();
  });

  it('rejects zero for scale (division-by-zero and degenerate bone) but allows negative scale', () => {
    expect(parseBoneField('scaleX', '0', 2)).toBeNull();
    expect(parseBoneField('scaleY', '0', 0.5)).toBeNull();
    expect(parseBoneField('scaleX', '-1.5', 2)).toBe(-1.5); // reflection is valid
  });

  it('allows zero for the non-scale channels', () => {
    expect(parseBoneField('x', '0', 10)).toBe(0);
    expect(parseBoneField('rotation', '0', 30)).toBe(0);
    expect(parseBoneField('shearX', '0', 4)).toBe(0);
  });
});

describe('buildBoneEdit', () => {
  it('routes each field to its channel, reading the unchanged component from live', () => {
    expect(buildBoneEdit('x', 99, LIVE)).toEqual({ channel: 'translate', x: 99, y: -5 });
    expect(buildBoneEdit('y', 99, LIVE)).toEqual({ channel: 'translate', x: 10, y: 99 });
    expect(buildBoneEdit('rotation', 45, LIVE)).toEqual({ channel: 'rotate', rotation: 45 });
    expect(buildBoneEdit('scaleX', 3, LIVE)).toEqual({ channel: 'scale', scaleX: 3, scaleY: 0.5 });
    expect(buildBoneEdit('scaleY', 3, LIVE)).toEqual({ channel: 'scale', scaleX: 2, scaleY: 3 });
    expect(buildBoneEdit('shearX', 7, LIVE)).toEqual({ channel: 'shear', shearX: 7, shearY: -3 });
    expect(buildBoneEdit('shearY', 7, LIVE)).toEqual({ channel: 'shear', shearX: 4, shearY: 7 });
  });
});
