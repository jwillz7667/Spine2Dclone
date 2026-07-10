import { Application, Container, Graphics } from 'pixi.js';
import { previewBackgroundStyle } from './preview-background';
import type { PreviewBackground } from './preview-transport';
import type { FitTransform } from './preview-fit';

// The shared GL scaffold for the effects and slot panel previews (PP-D8). It owns the PixiJS v8 Application
// lifecycle (the same mount/destroy pattern as viewport-panel-content: async init guarded against a
// StrictMode remount, destroy on unmount), a screen-filling background layer that renders the dark / light
// / checker backdrop, and a `content` container the caller transforms via the pure fit math. There is no
// unit test for this module for the same reason the viewport content component has none: it needs a WebGL
// context. All of its DECISIONS (background colors, checker parity, fit transform) live in the pure,
// node-tested sibling modules; this file only wires them to display objects.
//
// Allocation discipline: the background is redrawn ONLY when the screen size or the backdrop changes
// (tracked below), never per frame, so a steady preview holds zero background allocation. The caller's
// per-frame path is the runtime-web view update, which is itself allocation-free after warmup.

export interface PreviewStage {
  readonly app: Application;
  // The transformed content root: a preview view mounts its `root` here; applyFit sets its transform.
  readonly content: Container;
  // Redraw the backdrop if the screen size or the background changed since the last draw (cheap no-op
  // otherwise). Call once per frame; it self-gates so it does not allocate in the steady state.
  syncBackground(background: PreviewBackground): void;
  applyFit(fit: FitTransform): void;
  screenSize(): { readonly width: number; readonly height: number };
  // True when the host element has no layout box (a dockview inactive tab is display:none => 0x0), so the
  // caller can throttle: skip stepping and rendering while hidden.
  isHidden(): boolean;
  destroy(): void;
}

const CHECKER_TILE_FALLBACK = 24;

// Mount a PreviewStage into `host`. Async because Application.init is async; the caller guards the returned
// promise against an unmount that races the init (see the panel useEffect cleanup).
export async function createPreviewStage(
  host: HTMLElement,
  initialBackground: PreviewBackground,
): Promise<PreviewStage> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: previewBackgroundStyle(initialBackground).clearColor,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  host.appendChild(app.canvas);

  const backdrop = new Graphics();
  const content = new Container();
  app.stage.addChild(backdrop, content);

  // Last-drawn signature so syncBackground redraws only on a real change (size or backdrop), never per frame.
  let lastBackground: PreviewBackground | null = null;
  let lastWidth = -1;
  let lastHeight = -1;

  const drawBackdrop = (background: PreviewBackground): void => {
    const style = previewBackgroundStyle(background);
    app.renderer.background.color = style.clearColor;
    backdrop.clear();
    if (style.checker === null) {
      lastBackground = background;
      lastWidth = app.screen.width;
      lastHeight = app.screen.height;
      return;
    }
    const tile = style.checker.tile > 0 ? style.checker.tile : CHECKER_TILE_FALLBACK;
    const cols = Math.ceil(app.screen.width / tile);
    const rows = Math.ceil(app.screen.height / tile);
    // Batch every alternate tile into one fill (allocation-free per tile beyond the path ops PixiJS batches).
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (((col & 1) ^ (row & 1)) === 1) backdrop.rect(col * tile, row * tile, tile, tile);
      }
    }
    backdrop.fill(style.checker.colorB);
    lastBackground = background;
    lastWidth = app.screen.width;
    lastHeight = app.screen.height;
  };

  return {
    app,
    content,
    syncBackground(background: PreviewBackground): void {
      if (
        background === lastBackground &&
        app.screen.width === lastWidth &&
        app.screen.height === lastHeight
      ) {
        return;
      }
      drawBackdrop(background);
    },
    applyFit(fit: FitTransform): void {
      content.position.set(fit.offsetX, fit.offsetY);
      content.scale.set(fit.scale);
    },
    screenSize(): { readonly width: number; readonly height: number } {
      return { width: app.screen.width, height: app.screen.height };
    },
    isHidden(): boolean {
      return host.clientWidth === 0 || host.clientHeight === 0;
    },
    destroy(): void {
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
