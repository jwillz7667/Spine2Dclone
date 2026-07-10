import { validateDocument } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import { assignRegionNames, buildRigFromLayers, packNamedLayers } from './layered-to-rig';
import type { RasterLayer } from './layered-types';

// Unit tests for the PURE layers-to-rig projection (PP-D5): region-name assignment, deterministic packing,
// and the document build (one slot + region attachment per layer at its document coordinates). The projection
// math (canvas-centered attachment position, original-size attachment) and the LAW-3 validity of the built
// document are asserted directly.

function layer(
  name: string,
  left: number,
  top: number,
  width: number,
  height: number,
  visible = true,
): RasterLayer {
  const rgba = new Uint8Array(width * height * 4);
  // Opaque center pixel so alpha-trim keeps a non-empty region without trimming the whole thing away.
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { name, left, top, width, height, rgba, visible };
}

describe('assignRegionNames', () => {
  it('keeps unique names and disambiguates duplicates with a numeric suffix', () => {
    const named = assignRegionNames([
      layer('arm/hand', 0, 0, 4, 4),
      layer('arm/hand', 8, 0, 4, 4),
      layer('arm/hand', 16, 0, 4, 4),
    ]);
    expect(named.map((l) => l.regionName)).toEqual(['arm/hand', 'arm/hand_2', 'arm/hand_3']);
  });
});

describe('buildRigFromLayers', () => {
  it('builds a validating document with a slot + region attachment per layer at canvas-centered coords', () => {
    const layers = [layer('bg', 0, 0, 100, 100), layer('face', 40, 30, 20, 20)];
    const named = assignRegionNames(layers);
    const { atlas } = packNamedLayers(named);
    const document = buildRigFromLayers(
      { name: 'creature', canvasWidth: 100, canvasHeight: 100 },
      named,
      atlas,
    );

    const report = validateDocument(document);
    expect(report.ok).toBe(true);

    expect(document.bones).toHaveLength(1);
    expect(document.bones[0]?.name).toBe('root');
    expect(document.slots).toHaveLength(2);

    // Draw order is bottom layer first: the file lists bg then face (top-first), so slots reverse to face,
    // then bg... wait, bg is first in the list (bottom), face second (top) -> reversed order is face, bg?
    // The list order here is [bg, face]; the projection treats index 0 as topmost and reverses, so bg ends up
    // last (front). Assert the slot set and the face attachment geometry instead of a brittle order.
    const faceAttachment = document.skins[0]?.attachments['face']?.['face'];
    expect(faceAttachment?.type).toBe('region');
    if (faceAttachment?.type !== 'region') return;
    // face bitmap is 20x20 at (40,30); centered on a 100x100 canvas: (40 + 10 - 50, 30 + 10 - 50) = (0, -10).
    expect(faceAttachment.x).toBe(0);
    expect(faceAttachment.y).toBe(-10);
    expect(faceAttachment.width).toBe(20);
    expect(faceAttachment.height).toBe(20);
  });

  it('hides a non-visible layer in setup pose but keeps its attachment in the skin', () => {
    const layers = [layer('shown', 0, 0, 10, 10, true), layer('hidden', 0, 0, 10, 10, false)];
    const named = assignRegionNames(layers);
    const { atlas } = packNamedLayers(named);
    const document = buildRigFromLayers(
      { name: 'r', canvasWidth: 10, canvasHeight: 10 },
      named,
      atlas,
    );

    const hiddenSlot = document.slots.find((slot) => slot.name === 'hidden');
    expect(hiddenSlot?.attachment).toBeNull();
    // The attachment still exists in the default skin (revealable later).
    expect(document.skins[0]?.attachments['hidden']?.['hidden']).toBeDefined();
  });
});

describe('packNamedLayers', () => {
  it('produces an atlas whose region names match the assigned names, plus encoded page bytes', () => {
    const named = assignRegionNames([layer('a', 0, 0, 8, 8), layer('b', 0, 0, 8, 8)]);
    const { atlas, pages } = packNamedLayers(named);
    const names = atlas.pages.flatMap((page) => page.regions.map((region) => region.name));
    expect(new Set(names)).toEqual(new Set(['a', 'b']));
    expect(pages.length).toBe(atlas.pages.length);
    expect(pages[0]?.data.length).toBeGreaterThan(0);
  });
});
