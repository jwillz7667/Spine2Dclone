import type { AtlasRef } from '@marionette/format/types';
import { buildRegionTextures, makeRegionTextureResolver } from '@marionette/runtime-web';
import { SetAtlasRefCommand, documentHost } from '../document';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { bridge } from '../ipc-bridge';
import { loadPageTextures } from '../panels/atlas-textures';
import type { AtlasImportImagesRequest, AtlasImportResponse } from '../../shared';

// The shared sprite-import action (WP-1.3), extracted so BOTH the Assets panel button and the
// File > Import Sprites menu item run the SAME flow: the main process owns the directory dialog and the
// atlas pack (no renderer path, path-injection defense), the result is set on the live document through
// SetAtlasRefCommand (LAW 2), and the page textures are published to the atlas-texture store so the same
// regions render textured in the viewport. Returns a typed outcome so each caller reports it its own way
// (the panel shows a transient notice; the menu logs). The atlas crosses the wire as `unknown`; the
// main-process pipeline is the trusted producer and the format validator re-checks it at export (LAW 3),
// so this single narrowing assertion is justified.

export type SpriteImportOutcome =
  | { readonly kind: 'imported'; readonly regionCount: number }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'error'; readonly message: string };

function countRegions(atlas: AtlasRef): number {
  let count = 0;
  for (const page of atlas.pages) count += page.regions.length;
  return count;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Apply an imported/packed atlas to the live document and publish its page textures (shared by the folder
// import and the renderer-supplied image import). The SetAtlasRef command runs first so the document
// carries the regions before the textures resolve them; the page bytes are retained alongside the textures
// so a save can persist them next to the project (PP-D5). A texture-build failure leaves the placeholder
// (the document still has the atlas) and surfaces a typed error.
async function applyImportedAtlas(
  response: Extract<AtlasImportResponse, { status: 'imported' }>,
): Promise<SpriteImportOutcome> {
  // Opaque IPC value; main is the trusted AtlasRef producer and the format validator re-checks it at
  // export (LAW 3), so this single narrowing assertion is justified.
  const atlas = response.atlas as AtlasRef;
  const pages = response.pages;
  documentHost.current().history.execute(new SetAtlasRefCommand(atlas));
  try {
    const pageTextures = await loadPageTextures(pages);
    const resolver = makeRegionTextureResolver(buildRegionTextures(atlas, pageTextures));
    atlasTextureStore.setResolver(resolver, [...pageTextures.values()], pages);
  } catch (error) {
    return { kind: 'error', message: messageOf(error, 'failed to load atlas page textures') };
  }
  return { kind: 'imported', regionCount: countRegions(atlas) };
}

export async function runSpriteImport(): Promise<SpriteImportOutcome> {
  try {
    const result = await bridge().importAtlas();
    if (!result.ok) return { kind: 'error', message: result.error.message };
    if (result.data.status === 'canceled') return { kind: 'canceled' };
    return applyImportedAtlas(result.data);
  } catch (error) {
    // A missing bridge (failed preload) throws here; surface it instead of an opaque rejection.
    return { kind: 'error', message: messageOf(error, 'import failed') };
  }
}

// Import images the renderer read as bytes (drag-drop or a file-input picker). Main stages and packs them;
// the result is applied exactly like a folder import. An empty set is a no-op (nothing dropped that read).
export async function runImageImport(
  images: AtlasImportImagesRequest['images'],
): Promise<SpriteImportOutcome> {
  if (images.length === 0) return { kind: 'canceled' };
  try {
    const result = await bridge().importAtlasImages(images);
    if (!result.ok) return { kind: 'error', message: result.error.message };
    if (result.data.status === 'canceled') return { kind: 'canceled' };
    return applyImportedAtlas(result.data);
  } catch (error) {
    return { kind: 'error', message: messageOf(error, 'import failed') };
  }
}
