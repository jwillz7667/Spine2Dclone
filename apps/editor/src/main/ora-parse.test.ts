import { encodePng } from '@marionette/atlas-pack';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseOra } from './ora-parse';
import { isLayeredParseError } from './layered-types';

// Unit tests for the ORA adapter (PP-D5). The fixture ORA is CONSTRUCTED in code with fflate (a zip of PNGs
// built by our own encoder plus a hand-written stack.xml), so the whole path, unzip, stack.xml parse, and
// PNG decode, runs headless with no committed binary. Group flattening, x/y offsets, visibility, and the
// structural + per-layer typed errors/diagnostics are asserted.

function png(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 120;
    rgba[i + 1] = 180;
    rgba[i + 2] = 60;
    rgba[i + 3] = 255;
  }
  return new Uint8Array(encodePng({ width, height, rgba }));
}

const STACK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<image w="128" h="96">
  <stack>
    <layer name="face" src="data/face.png" x="10" y="20" visibility="visible"/>
    <stack name="arm">
      <layer name="hand" src="data/hand.png" x="30" y="40"/>
      <layer name="ghost" src="data/hand.png" x="0" y="0" visibility="hidden"/>
    </stack>
  </stack>
</image>`;

function buildOra(overrides?: { stack?: string; omitFace?: boolean }): Uint8Array {
  const files: Record<string, Uint8Array> = {
    mimetype: strToU8('image/openraster'),
    'stack.xml': strToU8(overrides?.stack ?? STACK_XML),
    'data/hand.png': png(24, 24),
  };
  if (overrides?.omitFace !== true) files['data/face.png'] = png(40, 30);
  return zipSync(files);
}

describe('parseOra', () => {
  it('reads the stack, flattens groups, and keeps offsets + visibility', () => {
    const doc = parseOra(buildOra(), 'creature');

    expect(doc.name).toBe('creature');
    expect(doc.canvasWidth).toBe(128);
    expect(doc.canvasHeight).toBe(96);

    const byName = new Map(doc.layers.map((layer) => [layer.name, layer]));
    expect(byName.get('face')).toMatchObject({
      left: 10,
      top: 20,
      width: 40,
      height: 30,
      visible: true,
    });
    expect(byName.get('arm/hand')).toMatchObject({ left: 30, top: 40, width: 24, height: 24 });
    expect(byName.get('arm/ghost')?.visible).toBe(false);
  });

  it('records a typed diagnostic and skips a layer whose src is absent', () => {
    const doc = parseOra(buildOra({ omitFace: true }), 'creature');
    expect(doc.layers.some((layer) => layer.name === 'face')).toBe(false);
    expect(doc.diagnostics.some((d) => d.feature === 'ora-missing-src' && d.layer === 'face')).toBe(
      true,
    );
  });

  it('throws a typed error when stack.xml is missing', () => {
    const bytes = zipSync({ mimetype: strToU8('image/openraster') });
    try {
      parseOra(bytes, 'x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isLayeredParseError(error)).toBe(true);
      if (isLayeredParseError(error)) expect(error.code).toBe('ORA_NO_STACK');
    }
  });

  it('throws a typed error when the bytes are not a zip', () => {
    try {
      parseOra(new Uint8Array([1, 2, 3, 4, 5]), 'x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isLayeredParseError(error)).toBe(true);
      if (isLayeredParseError(error)) expect(error.code).toBe('ORA_NOT_A_ZIP');
    }
  });

  it('throws a typed error when stack.xml has no <image> root', () => {
    try {
      parseOra(buildOra({ stack: '<?xml version="1.0"?><nope/>' }), 'x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(isLayeredParseError(error)).toBe(true);
      if (isLayeredParseError(error)) expect(error.code).toBe('ORA_BAD_STACK');
    }
  });
});
