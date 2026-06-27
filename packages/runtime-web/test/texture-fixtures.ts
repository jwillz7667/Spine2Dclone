import { BufferImageSource, Texture } from 'pixi.js';

// Build a solid-white Texture of an arbitrary pixel size WITHOUT a GL context, mirroring exactly how
// PixiJS builds Texture.WHITE (a Texture over a BufferImageSource of raw RGBA bytes). Vitest runs in the
// node env, where TextureSource construction touches no renderer, so this is safe in unit tests. Used to
// exercise the size-normalization path with deliberately non-unit, non-square dimensions: the resulting
// Texture reports width/height equal to the requested size, which is the only property the normalization
// reads.
export function makeSolidTexture(width: number, height: number): Texture {
  const source = new BufferImageSource({
    resource: new Uint8Array(width * height * 4).fill(255),
    width,
    height,
  });
  return new Texture({ source });
}
