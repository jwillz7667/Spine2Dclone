import { Assets, type Texture } from 'pixi.js';
import { PlayerLoadError } from './document-loader';

// The player's asset-fetch abstraction (PP-C5). The packaged player never reaches for a transport
// directly: it asks an AssetLoader for document bytes and atlas-page textures. The default is the browser
// (fetch + the PixiJS Assets loader), and a host or a test injects its own (fixture bytes / textures) so
// the player is exercisable with no network and no WebGL. This package uses NO Node built-ins: the browser
// loader relies only on the global fetch and PixiJS, so it runs unchanged in a plain web page.
export interface AssetLoader {
  // Fetch a URL as raw bytes (a document: MRNT binary or JSON).
  loadBytes(url: string): Promise<Uint8Array>;
  // Fetch a URL as a PixiJS Texture (an atlas page image).
  loadTexture(url: string): Promise<Texture>;
}

// The default browser loader: `fetch` for bytes, the PixiJS Assets pipeline for textures. A non-OK fetch
// response is a typed PlayerLoadError('assetFetch'), so a missing page fails loud rather than silently
// rendering the placeholder forever.
export function browserAssetLoader(): AssetLoader {
  return {
    async loadBytes(url: string): Promise<Uint8Array> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new PlayerLoadError('assetFetch', `failed to fetch ${url}: HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    async loadTexture(url: string): Promise<Texture> {
      return Assets.load<Texture>(url);
    },
  };
}
