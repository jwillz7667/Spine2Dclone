import { describe, expect, it } from 'vitest';
import { parseHexColor } from '../src/color';
import { parseCurve } from '../src/curve';
import { Diagnostics } from '../src/diagnostics';
import { isSupportedVersion, parseMajorVersion } from '../src/version';
import { deriveWeightedBones, isWeightedStream } from '../src/vertices';

describe('parseHexColor', () => {
  it('parses an 8 digit RGBA string', () => {
    expect(parseHexColor('ff8000cc')).toEqual({
      r: 1,
      g: 0x80 / 255,
      b: 0,
      a: 0xcc / 255,
    });
  });

  it('parses a 6 digit RGB string with alpha 1', () => {
    expect(parseHexColor('00ff00')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
  });

  it('is case insensitive', () => {
    expect(parseHexColor('FFFFFFFF')).toEqual(parseHexColor('ffffffff'));
  });

  it('returns null for a wrong length or non-hex string', () => {
    expect(parseHexColor('fff')).toBeNull();
    expect(parseHexColor('fffffffff')).toBeNull();
    expect(parseHexColor('gg0000ff')).toBeNull();
  });
});

describe('parseCurve', () => {
  const parse = (rec: Record<string, unknown>) => {
    const diag = new Diagnostics();
    const curve = parseCurve(rec, '/k', diag);
    return { curve, diag };
  };

  it('reads an absent curve as linear', () => {
    expect(parse({}).curve).toBe('linear');
  });

  it('reads "stepped"', () => {
    expect(parse({ curve: 'stepped' }).curve).toBe('stepped');
  });

  it('reads the flat bezier form with c2/c3/c4', () => {
    expect(parse({ curve: 0.25, c2: 0.1, c3: 0.75, c4: 0.9 }).curve).toEqual({
      type: 'bezier',
      cx1: 0.25,
      cy1: 0.1,
      cx2: 0.75,
      cy2: 0.9,
    });
  });

  it('defaults the flat bezier siblings to cy1 0, cx2 1, cy2 1', () => {
    expect(parse({ curve: 0 }).curve).toEqual({ type: 'bezier', cx1: 0, cy1: 0, cx2: 1, cy2: 1 });
  });

  it('reads the array bezier form', () => {
    expect(parse({ curve: [0.2, 0.3, 0.8, 0.7] }).curve).toEqual({
      type: 'bezier',
      cx1: 0.2,
      cy1: 0.3,
      cx2: 0.8,
      cy2: 0.7,
    });
  });

  it('records SPINE_SCHEMA on a malformed curve and falls back to linear', () => {
    const { curve, diag } = parse({ curve: [1, 2, 3] });
    expect(curve).toBe('linear');
    expect(diag.errors[0]?.code).toBe('SPINE_SCHEMA');
  });
});

describe('version gating', () => {
  it('parses the major component', () => {
    expect(parseMajorVersion('4.1.24')).toBe(4);
    expect(parseMajorVersion('3.8.99')).toBe(3);
    expect(parseMajorVersion(' 4.2.0 ')).toBe(4);
  });

  it('returns null for a version without a dotted major', () => {
    expect(parseMajorVersion('4')).toBeNull();
    expect(parseMajorVersion('nightly')).toBeNull();
  });

  it('supports only 4.x', () => {
    expect(isSupportedVersion('4.0.0')).toBe(true);
    expect(isSupportedVersion('4.2.33')).toBe(true);
    expect(isSupportedVersion('3.8.99')).toBe(false);
    expect(isSupportedVersion('5.0.0')).toBe(false);
  });
});

describe('weighted vertex stream helpers', () => {
  it('detects an unweighted stream by length equal to 2 * vertexCount', () => {
    expect(isWeightedStream([0, 0, 1, 0, 1, 1, 0, 1], 4)).toBe(false);
    expect(isWeightedStream([1, 0, 0, 0, 1], 1)).toBe(true);
  });

  it('derives the ascending de-duplicated bones manifest from a weighted stream', () => {
    // Two logical vertices: one bound to bones 2 and 0, one bound to bone 2 only.
    const stream = [2, 2, 0, 0, 0.5, 0, 0, 0, 0.5, 1, 2, 0, 0, 1];
    expect(deriveWeightedBones(stream)).toEqual([0, 2]);
  });

  it('stops gracefully on a truncated stream', () => {
    expect(deriveWeightedBones([2, 0, 0, 0, 0.5, 1])).toEqual([0]);
  });
});
