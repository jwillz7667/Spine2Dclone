import { Texture } from 'pixi.js';
import type { AtlasImportPage } from '../../shared';

// Pixi-dependent page-texture loader. The editor vitest env is `node` (no DOM, no GL), so this glue is
// covered by typecheck + lint only, mirroring viewport-panel-content.tsx; the pure, testable half of this
// feature is the atlas:import IPC schema (ipc-contract.test.ts). It turns the page PNG bytes the main
// process read back (over the typed atlas:import IPC) into GPU textures, keyed by AtlasPage.file, which the
// caller feeds to runtime-web's buildRegionTextures to slice per-region sub-textures.
//
// Decode path: the renderer HAS a DOM, so we wrap the bytes in a Blob and decode with the browser's image
// codec via createImageBitmap (a Blob in, an ImageBitmap out), then Texture.from(bitmap). pixi.js 8.19's
// Texture.from accepts an ImageBitmap (it is in ImageSource's ImageResource union, TextureSourceLike), so
// this is fully typed with no `any` or assertion. createImageBitmap is preferred over the
// Blob -> object URL -> Assets.load(url) -> revokeObjectURL path because Assets picks a parser by URL
// EXTENSION and a `blob:` URL has none, so it would need an explicit loadParser; the bitmap path is direct,
// deterministic, and has no object-URL lifecycle to leak.
//
// The returned textures are OWNED by the caller (published to the atlas-texture store, which destroys them
// on the next import). Decodes run in parallel; the page set is small and bounded by the AtlasRef.
export async function loadPageTextures(
  pages: readonly AtlasImportPage[],
): Promise<Map<string, Texture>> {
  const entries = await Promise.all(
    pages.map(async (page): Promise<readonly [string, Texture]> => {
      const bitmap = await createImageBitmap(new Blob([page.data], { type: 'image/png' }));
      return [page.file, Texture.from(bitmap)];
    }),
  );
  return new Map(entries);
}
