import type { AtlasRef } from '@marionette/format/types';
import { buildRegionTextures, makeRegionTextureResolver } from '@marionette/runtime-web';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { loadPageTextures } from '../panels/atlas-textures';
import type { AtlasImportPage } from '../../shared';

// Restore the atlas page textures for a freshly loaded document (PP-D5). The main process reads the page
// PNG bytes back from the project-relative textures directory and ships them in the file-open response; this
// rebuilds the region-texture resolver from those bytes and publishes it to the atlas-texture store, so the
// viewport renders textured regions on open instead of the placeholder. It mirrors the texture half of
// runSpriteImport, minus the SetAtlasRef command (load already installed the atlas metadata). A no-op when
// no pages were restored (no atlas, or the textures directory was absent). A decode failure propagates to
// the caller, which keeps the placeholder (the document still carries the atlas).
export async function restoreAtlasTextures(
  atlas: AtlasRef,
  pages: readonly AtlasImportPage[],
): Promise<void> {
  if (pages.length === 0) return;
  const pageTextures = await loadPageTextures(pages);
  const resolver = makeRegionTextureResolver(buildRegionTextures(atlas, pageTextures));
  atlasTextureStore.setResolver(resolver, [...pageTextures.values()], pages);
}
