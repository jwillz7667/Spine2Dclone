import { describe, expect, it } from 'vitest';
import { thumbnailBox, THUMBNAIL_MAX } from './asset-thumbnails';

describe('asset thumbnail sizing (PP-D5)', () => {
  it('fits a landscape region into the box preserving aspect ratio', () => {
    expect(thumbnailBox(80, 40, 40)).toEqual({ w: 40, h: 20 });
  });

  it('fits a portrait region into the box preserving aspect ratio', () => {
    expect(thumbnailBox(40, 80, 40)).toEqual({ w: 20, h: 40 });
  });

  it('never upscales a region smaller than the box', () => {
    expect(thumbnailBox(16, 8, 40)).toEqual({ w: 16, h: 8 });
  });

  it('never rounds an edge below 1px', () => {
    expect(thumbnailBox(400, 1, 40)).toEqual({ w: 40, h: 1 });
  });

  it('collapses a degenerate region to a 1x1 box', () => {
    expect(thumbnailBox(0, 10, THUMBNAIL_MAX)).toEqual({ w: 1, h: 1 });
    expect(thumbnailBox(10, -5, THUMBNAIL_MAX)).toEqual({ w: 1, h: 1 });
  });
});
