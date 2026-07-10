import { describe, expect, it } from 'vitest';
import { applyPageAlphaMode, pageAlphaMode } from '../src/atlas/premultiplied-alpha';
import type { Texture } from 'pixi.js';

// WP-5.2 TASK-5.2.5 (the non-GL part): the pure premultiplied-alpha boolean -> PixiJS alphaMode mapping,
// and the applier writing it onto a page texture's source. Setting the property on a live GL TextureSource
// is the GL edge; here a minimal structural stand-in proves the applier writes the mapped value.

describe('pageAlphaMode', () => {
  it('maps a premultiplied page to the upload-as-is mode', () => {
    expect(pageAlphaMode(true)).toBe('premultiplied-alpha');
  });

  it('maps a straight page to premultiply-on-upload (PixiJS default for straight PNGs)', () => {
    expect(pageAlphaMode(false)).toBe('premultiply-alpha-on-upload');
  });
});

describe('applyPageAlphaMode', () => {
  it('writes the premultiplied mode onto the page texture source', () => {
    const source = { alphaMode: 'premultiply-alpha-on-upload' as string };
    const texture = { source } as unknown as Texture;

    applyPageAlphaMode(texture, true);

    expect(source.alphaMode).toBe('premultiplied-alpha');
  });

  it('writes the straight mode onto the page texture source', () => {
    const source = { alphaMode: 'premultiplied-alpha' as string };
    const texture = { source } as unknown as Texture;

    applyPageAlphaMode(texture, false);

    expect(source.alphaMode).toBe('premultiply-alpha-on-upload');
  });
});
