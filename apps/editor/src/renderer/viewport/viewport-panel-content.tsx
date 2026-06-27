import { Application } from 'pixi.js';
import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { SkeletonView } from '@marionette/runtime-web';
import { documentHost, exportDocument } from '../document';
import { useCameraStore } from '../editor-state/camera-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { usePlaybackStore } from '../editor-state/playback-store';
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
      <ViewportModeOverlay />
      <ViewportToolbar />
    </div>
  );
}

// Makes the editor mode unmistakable (TASK-1.8.4). In animation mode the viewport gets an inset tinted
// border plus a top banner; the banner shows whether a gizmo edit will auto-key or NOT key (autoKey off),
// so the author always knows whether dragging a bone writes a keyframe. The overlay is pointer-transparent
// (pointerEvents none) so it never intercepts gizmo or camera input, and it renders nothing in setup mode
// (no tint, no banner), which keeps setup posing visually distinct. It reads the ephemeral playback store
// only; mode/autoKey are editor state, never the document (the document/editor wall).
function ViewportModeOverlay(): ReactElement | null {
  const mode = usePlaybackStore((state) => state.mode);
  const autoKey = usePlaybackStore((state) => state.autoKey);

  if (mode !== 'animation') return null;
  return (
    <div style={animationTintStyle} aria-hidden>
      <div style={animationBannerStyle}>
        <span style={bannerModeStyle}>ANIMATION</span>
        <span style={autoKey ? keyingBadgeStyle : notKeyingBadgeStyle}>
          {autoKey ? 'AUTO-KEY' : 'NOT KEYING'}
        </span>
      </div>
    </div>
  );
}

// A minimal tool switcher overlaid on the viewport (keyboard equivalents: V select, B create bone) plus
// the WP-1.8 mode controls: a setup/animation toggle and an auto-key toggle. It reads and writes the
// ephemeral tool and playback stores only; it never touches the document (the document/editor wall). The
// auto-key toggle is disabled in setup mode, where it has no effect (keying only happens in animation).
function ViewportToolbar(): ReactElement {
  const tool = useToolStore((state) => state.tool);
  const setTool = useToolStore((state) => state.setTool);
  const mode = usePlaybackStore((state) => state.mode);
  const setMode = usePlaybackStore((state) => state.setMode);
  const autoKey = usePlaybackStore((state) => state.autoKey);
  const setAutoKey = usePlaybackStore((state) => state.setAutoKey);

  const toolButton = (id: ToolId, label: string): ReactElement => (
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
      {toolButton('select', 'Select (V)')}
      {toolButton('createBone', 'Create Bone (B)')}
      <span style={dividerStyle} />
      <button
        type="button"
        onClick={() => setMode('setup')}
        style={{ ...buttonStyle, ...(mode === 'setup' ? buttonActiveStyle : null) }}
      >
        Setup
      </button>
      <button
        type="button"
        onClick={() => setMode('animation')}
        style={{ ...buttonStyle, ...(mode === 'animation' ? buttonActiveStyle : null) }}
      >
        Animation
      </button>
      <button
        type="button"
        onClick={() => setAutoKey(!autoKey)}
        disabled={mode === 'setup'}
        style={{
          ...buttonStyle,
          ...(mode === 'animation' && autoKey ? buttonActiveStyle : null),
          ...(mode === 'setup' ? buttonDisabledStyle : null),
        }}
      >
        Auto-key
      </button>
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

const buttonDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};

const dividerStyle: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: '#444444',
  margin: '0 2px',
};

// Animation-mode chrome: an inset tinted border framing the whole viewport so the mode is unmistakable at
// a glance, with a small banner top-center. pointerEvents none so it never steals gizmo/camera input.
const animationTintStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxSizing: 'border-box',
  border: '2px solid rgba(214, 132, 46, 0.85)',
};

const animationBannerStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 10px',
  borderRadius: 4,
  background: 'rgba(40, 30, 18, 0.85)',
  border: '1px solid rgba(214, 132, 46, 0.85)',
  fontSize: 11,
  letterSpacing: 0.5,
};

const bannerModeStyle: CSSProperties = {
  color: '#e0a861',
  fontWeight: 600,
};

const keyingBadgeStyle: CSSProperties = {
  color: '#0f1a0f',
  background: '#7ad07a',
  padding: '1px 6px',
  borderRadius: 3,
  fontWeight: 600,
};

const notKeyingBadgeStyle: CSSProperties = {
  color: '#1a1a1a',
  background: '#cccccc',
  padding: '1px 6px',
  borderRadius: 3,
  fontWeight: 600,
};
