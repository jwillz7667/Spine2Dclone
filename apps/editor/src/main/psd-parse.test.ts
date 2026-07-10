import { writePsd, type Psd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { parsePsd } from './psd-parse';

// Unit tests for the PSD adapter (PP-D5). The fixture PSD is CONSTRUCTED in code with ag-psd's writer using
// straight-alpha imageData layers (no canvas), then read back through parsePsd, so the whole codec path runs
// headless with no committed binary and no native dependency. Group flattening, bounds, visibility, and the
// typed non-raster diagnostic are all asserted.

function pixels(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { data, width, height };
}

function rasterLayer(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
  hidden = false,
): Record<string, unknown> {
  return {
    name,
    left,
    top,
    right: left + width,
    bottom: top + height,
    hidden,
    imageData: pixels(width, height, 200, 100, 50),
  };
}

function buildPsd(): Uint8Array {
  const psd: Psd = {
    width: 64,
    height: 64,
    children: [
      rasterLayer('background', 0, 0, 64, 64),
      {
        name: 'arm',
        opened: true,
        children: [rasterLayer('hand', 8, 8, 16, 16), rasterLayer('elbow', 8, 24, 16, 16, true)],
      },
      // A layer with no imageData stands in for an adjustment/text layer (a non-raster feature).
      { name: 'levels' },
    ],
  } as unknown as Psd;
  return new Uint8Array(writePsd(psd, { generateThumbnail: false }));
}

describe('parsePsd', () => {
  it('flattens groups with path-joined names and keeps bounds + visibility', () => {
    const doc = parsePsd(buildPsd(), 'hero');

    expect(doc.name).toBe('hero');
    expect(doc.canvasWidth).toBe(64);
    expect(doc.canvasHeight).toBe(64);

    const byName = new Map(doc.layers.map((layer) => [layer.name, layer]));
    expect([...byName.keys()]).toEqual(
      expect.arrayContaining(['background', 'arm/hand', 'arm/elbow']),
    );

    const hand = byName.get('arm/hand');
    expect(hand).toMatchObject({ left: 8, top: 8, width: 16, height: 16, visible: true });
    expect(hand?.rgba.length).toBe(16 * 16 * 4);

    // The hidden layer is still extracted; its visibility is recorded for the projection.
    expect(byName.get('arm/elbow')?.visible).toBe(false);
  });

  it('records a typed diagnostic for a non-raster layer and drops it', () => {
    const doc = parsePsd(buildPsd(), 'hero');
    expect(doc.layers.some((layer) => layer.name === 'levels')).toBe(false);
    expect(
      doc.diagnostics.some((d) => d.feature === 'non-raster-layer' && d.layer === 'levels'),
    ).toBe(true);
  });
});
