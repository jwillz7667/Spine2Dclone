import { describe, expect, it } from 'vitest';
import { buildAtlasView } from './assets-atlas-view';
import type { AtlasRef, AtlasRegion } from '@marionette/format/types';

function region(name: string, w: number, h: number): AtlasRegion {
  return {
    name,
    x: 0,
    y: 0,
    w,
    h,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: w,
    originalH: h,
  };
}

describe('buildAtlasView', () => {
  it('reports an empty atlas as zero regions and zero pages', () => {
    const view = buildAtlasView({ pages: [] });

    expect(view.pageCount).toBe(0);
    expect(view.regionCount).toBe(0);
    expect(view.regions).toEqual([]);
  });

  it('flattens regions across pages in pack order and labels each with its trimmed WxH', () => {
    const atlas: AtlasRef = {
      pages: [
        {
          file: 'page-0.png',
          width: 256,
          height: 256,
          regions: [region('torso', 60, 120), region('armL', 44, 90)],
        },
        { file: 'page-1.png', width: 128, height: 128, regions: [region('armR', 44, 90)] },
      ],
    };

    const view = buildAtlasView(atlas);

    expect(view.pageCount).toBe(2);
    expect(view.regionCount).toBe(3);
    expect(view.regions.map((r) => r.name)).toEqual(['torso', 'armL', 'armR']);
    expect(view.regions.map((r) => r.label)).toEqual(['60x120', '44x90', '44x90']);
  });
});
