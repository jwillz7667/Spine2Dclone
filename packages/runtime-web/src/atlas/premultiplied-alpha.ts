import type { ALPHA_MODES, Texture } from 'pixi.js';

// Premultiplied-alpha threading (phase-5 WP-5.2, TASK-5.2.5 / TASK-5.2.8). Our atlas pages may be emitted
// PREMULTIPLIED (the FIXED PMA policy, recorded as `premultipliedAlpha` in atlas-pack's atlas-targets.json).
// PixiJS v8 composites in premultiplied space, so it MUST know whether a loaded page PNG is already
// premultiplied (do not premultiply it again on upload) or straight (premultiply on upload). Getting this
// wrong double-darkens semi-transparent edges and desyncs additive/screen blends from the native runtimes.
//
// The mapping is pure and unit-tested. The applier writes `alphaMode` on a live PixiJS TextureSource, which
// is a GL-edge side effect: the host calls it on each page texture after load, passing the flag it read
// from the manifest. Because region sub-textures (buildRegionTextures) share the page's TextureSource,
// setting it once on the page covers every region sliced from that page.

// Map our premultiplied-alpha boolean to the PixiJS v8 TextureSource.alphaMode string. `true` (pages are
// already premultiplied) -> 'premultiplied-alpha' (upload as-is); `false` (straight pages) ->
// 'premultiply-alpha-on-upload' (PixiJS premultiplies on the GPU, its default for straight PNGs).
export function pageAlphaMode(premultipliedAlpha: boolean): ALPHA_MODES {
  return premultipliedAlpha ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload';
}

// Set the alphaMode on a loaded atlas page texture's source so PixiJS blends it correctly. Idempotent; call
// it once per page after load with the manifest's premultipliedAlpha flag.
export function applyPageAlphaMode(pageTexture: Texture, premultipliedAlpha: boolean): void {
  pageTexture.source.alphaMode = pageAlphaMode(premultipliedAlpha);
}
