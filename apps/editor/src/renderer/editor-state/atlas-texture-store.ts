import type { Texture } from 'pixi.js';
import type { RegionTextureResolver } from '@marionette/runtime-web';

// Ephemeral editor state (the document/editor wall): the loaded atlas page textures and the region
// resolver the viewport binds into its SkeletonView. The DocumentModel holds only the AtlasRef METADATA
// (region rects, page basenames); the PIXELS are loaded here per import session and are NEVER serialized,
// undoable, or part of the save. This is intentionally NOT in Zustand and NOT in the document: it is a
// tiny observable singleton (mirroring documentHost) read imperatively by the viewport ticker, which lives
// outside React.
//
// The store OWNS the page base textures so it can DESTROY them when a re-import replaces them, freeing GPU
// memory without leaking across imports. The region sub-textures the resolver returns (built by
// runtime-web's buildRegionTextures) are lightweight frames that SHARE these page sources, so destroying an
// old page texture WITH its source is correct only when the old resolver is being replaced (its frames are
// discarded together). Listeners are notified on every change so the viewport repaints.

type Listener = () => void;

class AtlasTextureStore {
  private resolver: RegionTextureResolver | null = null;
  // The page base textures this store owns and is responsible for destroying on replace/clear.
  private ownedPages: readonly Texture[] = [];
  private readonly listeners = new Set<Listener>();

  getResolver(): RegionTextureResolver | null {
    return this.resolver;
  }

  // Replace the current resolver and the page textures it was built from. The PREVIOUS owned pages are
  // destroyed with their GPU source (destroy(true)) so re-importing does not leak: the old region
  // sub-textures are views over those sources and are dropped together with the old resolver. The viewport
  // re-syncs its SkeletonView (which rebuilds its scene against the new resolver before the next Pixi draw,
  // see viewport-panel-content.tsx) so the destroyed old source is never rendered.
  setResolver(resolver: RegionTextureResolver, ownedPages: readonly Texture[]): void {
    this.destroyOwned();
    this.resolver = resolver;
    this.ownedPages = ownedPages;
    this.emit();
  }

  // Drop the resolver and destroy the owned page textures (no-op when already empty). Used when the live
  // document is replaced (a file open): the loaded pixels belong to the previous import session, so the
  // viewport falls back to the 1x1 placeholder until sprites are re-imported.
  clear(): void {
    if (this.resolver === null && this.ownedPages.length === 0) return;
    this.destroyOwned();
    this.resolver = null;
    this.ownedPages = [];
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private destroyOwned(): void {
    for (const texture of this.ownedPages) {
      // destroySource = true: the page's GPU source is shared only by the old region sub-textures, which
      // are discarded with the old resolver, so freeing it here releases GPU memory and cannot tear down a
      // live page.
      texture.destroy(true);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

// Renderer-wide singleton, constructed once on first import (mirrors documentHost).
export const atlasTextureStore = new AtlasTextureStore();
