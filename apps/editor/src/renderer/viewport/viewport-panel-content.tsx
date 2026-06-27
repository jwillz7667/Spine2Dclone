import { Application } from 'pixi.js';
import { useEffect, useRef, type ReactElement } from 'react';
import { SkeletonView } from '@marionette/runtime-web';
import { useCameraStore } from '../editor-state/camera-store';
import { attachCameraController, type CameraControls } from './camera-controller';
import { createViewportLayers } from './layers';
import { sampleDocument } from './sample-document';
import type { Camera } from './camera';

const BACKGROUND = 0x1e1e1e;

// Mounts a PixiJS v8 Application into the dockview viewport panel and shows the shared runtime-web
// SkeletonView (handoff 8.3): the content layer is exactly what the web runtime renders, the overlay
// layer is reserved for editor chrome (gizmos, WP-0.7). The camera lives in Zustand (ephemeral editor
// state, never serialized): the render path subscribes to the store and writes the camera transform
// onto the world container, and the input controller writes user pan/zoom back into the store.
export function ViewportPanelContent(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    // Application.init is async; these locals are captured by the cleanup closure. `disposed` guards
    // the StrictMode mount/unmount/remount cycle so a late-resolving init tears itself down.
    let disposed = false;
    let app: Application | null = null;
    let detach: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      const created = new Application();
      await created.init({
        resizeTo: host,
        background: BACKGROUND,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (disposed) {
        created.destroy({ removeView: true }, { children: true });
        return;
      }
      app = created;
      host.appendChild(app.canvas);

      const layers = createViewportLayers();
      app.stage.addChild(layers.world);

      // Validate-before-solve happens inside SkeletonView.sync; the viewport never hands an
      // unvalidated document to runtime-core. File IO (WP-0.8) replaces this sample later.
      const view = new SkeletonView();
      view.sync(sampleDocument());
      layers.content.addChild(view.root);

      const applyCamera = (camera: Camera): void => {
        layers.world.position.set(camera.x, camera.y);
        layers.world.scale.set(camera.zoom);
      };
      applyCamera(useCameraStore.getState());
      unsubscribe = useCameraStore.subscribe(applyCamera);
      // Frame the world origin at the viewport center now that the renderer has a size.
      useCameraStore.getState().centerOrigin(app.screen.width / 2, app.screen.height / 2);

      const controls: CameraControls = {
        panBy: (dx, dy) => useCameraStore.getState().panBy(dx, dy),
        zoomAt: (ax, ay, factor) => useCameraStore.getState().zoomAt(ax, ay, factor),
        setCursorHint: (hint) => {
          if (app !== null) app.canvas.style.cursor = hint === 'default' ? '' : hint;
        },
      };
      detach = attachCameraController(app.canvas, controls);
    })();

    return () => {
      disposed = true;
      detach?.();
      unsubscribe?.();
      if (app !== null) {
        app.destroy({ removeView: true }, { children: true });
        app = null;
      }
    };
  }, []);

  return <div ref={hostRef} className="viewport-host" />;
}
