import { Application } from 'pixi.js';
import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { SkeletonView } from '@marionette/runtime-web';
import { documentHost, exportDocument } from '../document';
import { useCameraStore } from '../editor-state/camera-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { useToolStore, type ToolId } from '../editor-state/tool-store';
import { attachCameraController, type CameraControls } from './camera-controller';
import { createViewportLayers } from './layers';
import { MoveRotateGizmo } from './gizmo/move-rotate-gizmo';
import { attachToolInput } from './tool-input';
import { CreateBoneTool } from './tools/create-bone-tool';
import { SelectMoveTool } from './tools/select-move-tool';
import type { ViewportTool } from './tools/tool';
import type { Camera } from './camera';

const BACKGROUND = 0x1e1e1e;

// Mounts a PixiJS v8 Application into the dockview viewport panel and renders the LIVE document from
// the DocumentHost (handoff 8.3): the content layer is exactly what the web runtime renders, the
// overlay layer carries editor chrome (the move/rotate gizmo). The document is the single source of
// truth (never Zustand); the render loop polls model.revision each frame and re-syncs the SkeletonView
// (or clears it when the document has no bones yet). The camera lives in Zustand (ephemeral, never
// serialized): the render path writes the camera transform onto the world container and the input
// controller writes user pan/zoom back into the store. Pointer events route to the active tool unless
// Space is held, in which case the camera controller pans.
export function ViewportPanelContent(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    // Application.init is async; these locals are captured by the cleanup closure. `disposed` guards
    // the StrictMode mount/unmount/remount cycle so a late-resolving init tears itself down.
    let disposed = false;
    let app: Application | null = null;
    let detachCamera: (() => void) | null = null;
    let detachTool: (() => void) | null = null;
    let unsubscribeCamera: (() => void) | null = null;
    let unsubscribeSelection: (() => void) | null = null;

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

      // Content: the shared runtime-web scene. Overlay: the gizmo (editor-only chrome).
      const view = new SkeletonView();
      layers.content.addChild(view.root);
      const gizmo = new MoveRotateGizmo();
      layers.overlay.addChild(gizmo.container);

      const applyCamera = (camera: Camera): void => {
        layers.world.position.set(camera.x, camera.y);
        layers.world.scale.set(camera.zoom);
        gizmo.applyZoom(camera.zoom); // keep handles a constant pixel size as zoom changes
      };
      applyCamera(useCameraStore.getState());
      unsubscribeCamera = useCameraStore.subscribe(applyCamera);
      // Frame the world origin at the viewport center now that the renderer has a size.
      useCameraStore.getState().centerOrigin(app.screen.width / 2, app.screen.height / 2);

      const controls: CameraControls = {
        panBy: (dx, dy) => useCameraStore.getState().panBy(dx, dy),
        zoomAt: (ax, ay, factor) => useCameraStore.getState().zoomAt(ax, ay, factor),
        setCursorHint: (hint) => {
          if (app !== null) app.canvas.style.cursor = hint === 'default' ? '' : hint;
        },
      };
      detachCamera = attachCameraController(app.canvas, controls);

      const tools: Record<ToolId, ViewportTool> = {
        select: new SelectMoveTool(gizmo),
        createBone: new CreateBoneTool(),
      };
      detachTool = attachToolInput(app.canvas, {
        getCamera: () => useCameraStore.getState(),
        getActiveTool: () => tools[useToolStore.getState().tool],
      });

      // The gizmo re-solves only when the document or the selection changes (not every idle frame).
      let gizmoDirty = true;
      unsubscribeSelection = useSelectionStore.subscribe(() => {
        gizmoDirty = true;
      });

      let lastRevision = -1;
      const tick = (): void => {
        const model = documentHost.current().model;
        if (model.revision !== lastRevision) {
          lastRevision = model.revision;
          if (model.bones().length === 0) {
            view.clear();
          } else {
            try {
              view.sync(exportDocument(model));
            } catch {
              // A transiently invalid in-progress document (mid-gesture) must not crash the render
              // loop; the next valid revision re-syncs. exportDocument fails loudly elsewhere (save).
            }
          }
          gizmoDirty = true;
        }
        if (gizmoDirty) {
          gizmo.refresh(model);
          gizmoDirty = false;
        }
      };
      app.ticker.add(tick);
    })();

    return () => {
      disposed = true;
      detachCamera?.();
      detachTool?.();
      unsubscribeCamera?.();
      unsubscribeSelection?.();
      if (app !== null) {
        app.destroy({ removeView: true }, { children: true });
        app = null;
      }
    };
  }, []);

  return (
    <div style={rootStyle}>
      <div ref={hostRef} className="viewport-host" />
      <ViewportToolbar />
    </div>
  );
}

// A minimal tool switcher overlaid on the viewport (keyboard equivalents: V select, B create bone). It
// reads and writes the ephemeral tool store only; it never touches the document.
function ViewportToolbar(): ReactElement {
  const tool = useToolStore((state) => state.tool);
  const setTool = useToolStore((state) => state.setTool);

  const button = (id: ToolId, label: string): ReactElement => (
    <button
      type="button"
      onClick={() => setTool(id)}
      style={{ ...buttonStyle, ...(tool === id ? buttonActiveStyle : null) }}
    >
      {label}
    </button>
  );

  return (
    <div style={toolbarStyle}>
      {button('select', 'Select (V)')}
      {button('createBone', 'Create Bone (B)')}
    </div>
  );
}

const rootStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%' };

const toolbarStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  display: 'flex',
  gap: 6,
};

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const buttonActiveStyle: CSSProperties = {
  background: '#3a567a',
  borderColor: '#5aa0ff',
  color: '#ffffff',
};
