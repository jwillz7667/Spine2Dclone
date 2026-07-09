import { describe, expect, it } from 'vitest';
import type { AtlasRegion } from '@marionette/format/types';
import {
  duplicateSkinName,
  isKnownSkin,
  previewAfterDelete,
  previewAfterRename,
  skinRegionEntity,
  uniqueSkinName,
} from './skins-logic';

describe('skins panel logic (PP-D4)', () => {
  it('uniquifies a fresh skin name against existing names', () => {
    expect(uniqueSkinName([])).toBe('skin');
    expect(uniqueSkinName(['skin'])).toBe('skin 2');
    expect(uniqueSkinName(['skin', 'skin 2'])).toBe('skin 3');
  });

  it('names a duplicate after its source and uniquifies repeats', () => {
    expect(duplicateSkinName(['red'], 'red')).toBe('red copy');
    expect(duplicateSkinName(['red', 'red copy'], 'red')).toBe('red copy 2');
  });

  it('resets the preview to default only when the deleted skin was previewed', () => {
    expect(previewAfterDelete('red', 'red')).toBe('default');
    expect(previewAfterDelete('red', 'blue')).toBe('blue');
    expect(previewAfterDelete('red', 'default')).toBe('default');
  });

  it('follows a renamed skin in the preview', () => {
    expect(previewAfterRename('red', 'crimson', 'red')).toBe('crimson');
    expect(previewAfterRename('red', 'crimson', 'blue')).toBe('blue');
  });

  it('treats default and listed skins as known', () => {
    expect(isKnownSkin('default', [])).toBe(true);
    expect(isKnownSkin('red', ['red', 'blue'])).toBe(true);
    expect(isKnownSkin('green', ['red', 'blue'])).toBe(false);
  });

  it('builds a region override keyed by the placeholder name pointing at the region', () => {
    const region: AtlasRegion = {
      name: 'arm_red',
      x: 0,
      y: 0,
      w: 32,
      h: 48,
      rotated: false,
      offsetX: 0,
      offsetY: 0,
      originalW: 32,
      originalH: 48,
    };

    const entity = skinRegionEntity('arm', region);

    expect(entity.kind).toBe('region');
    expect(entity.name).toBe('arm'); // keyed by the slot's placeholder, not the region name
    expect(entity.path).toBe('arm_red'); // points at the chosen region
    expect(entity.width).toBe(32);
    expect(entity.height).toBe(48);
  });
});
