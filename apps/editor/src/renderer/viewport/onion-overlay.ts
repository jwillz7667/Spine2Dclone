import { Container } from 'pixi.js';
import { SkeletonView, type RegionTextureResolver } from '@marionette/runtime-web';
import type { SkeletonDocument } from '@marionette/format/types';
import type { OnionGhost } from './onion-skin';

// The pooled onion-skin overlay (PP-D3): one reused SkeletonView per ghost frame, drawn faintly behind the
// live pose. It samples each ghost pose through the SAME shared runtime-web view the viewport uses (skinned
// meshes and region attachments included, since the solve is cheap), so a ghost cannot drift from what plays.
// Display objects are POOLED: the pool grows to the ghost count and is reused every frame, surplus views are
// hidden (not destroyed), so a steady-state frame allocates nothing here beyond the per-view region products
// the shared view already pools (no per-frame allocation, DoD). Past ghosts tint cool, future ghosts warm.
const BEFORE_TINT = 0x6aa0ff;
const AFTER_TINT = 0xff9a5a;

export class OnionSkinOverlay {
  // The host adds this to the content layer BELOW the live SkeletonView, so ghosts sit behind the art.
  readonly container: Container;
  private readonly views: SkeletonView[] = [];
  private resolver: RegionTextureResolver | null = null;

  constructor() {
    this.container = new Container();
  }

  // Bind (or clear) the region texture resolver on every pooled ghost, so ghost attachments resolve to the
  // same atlas textures the live view shows. Applied to existing views now and to any view minted later.
  setTextureResolver(resolver: RegionTextureResolver | null): void {
    this.resolver = resolver;
    for (const view of this.views) view.setTextureResolver(resolver);
  }

  // Render `ghosts` for the given VALIDATED document + animation. Grows the pool to the ghost count (reusing
  // existing views), samples each ghost pose, and applies its opacity and side tint; surplus pooled views are
  // hidden. A null document/animation or an empty ghost list hides every ghost. The document MUST already be
  // validated (the viewport passes its cached exported doc), matching SkeletonView.syncAnimated.
  refresh(
    document: SkeletonDocument | null,
    animationName: string | null,
    ghosts: readonly OnionGhost[],
  ): void {
    if (document === null || animationName === null || ghosts.length === 0) {
      this.hideAll();
      return;
    }
    this.ensurePool(ghosts.length);
    for (let i = 0; i < this.views.length; i += 1) {
      const view = this.views[i]!;
      const ghost = ghosts[i];
      if (ghost === undefined) {
        view.root.visible = false;
        continue;
      }
      view.syncAnimated(document, animationName, ghost.time);
      view.root.visible = true;
      view.root.alpha = ghost.opacity;
      view.root.tint = ghost.side === 'before' ? BEFORE_TINT : AFTER_TINT;
    }
  }

  // Hide every ghost without tearing down the pool (a toggle-off or a mode change), so re-enabling reuses the
  // built views and their document-keyed scene caches.
  clear(): void {
    this.hideAll();
  }

  destroy(): void {
    for (const view of this.views) view.destroy();
    this.views.length = 0;
    this.container.destroy({ children: true });
  }

  private ensurePool(count: number): void {
    while (this.views.length < count) {
      const view = new SkeletonView();
      if (this.resolver !== null) view.setTextureResolver(this.resolver);
      this.container.addChild(view.root);
      this.views.push(view);
    }
  }

  private hideAll(): void {
    for (const view of this.views) view.root.visible = false;
  }
}
