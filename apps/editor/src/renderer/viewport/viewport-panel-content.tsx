import { Application, type Ticker } from 'pixi.js';
import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { SkeletonView } from '@marionette/runtime-web';
import type { SkeletonDocument } from '@marionette/format/types';
import { documentHost, exportDocument } from '../document';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { useCameraStore } from '../editor-state/camera-store';
import { useMeshEditStore } from '../editor-state/mesh-edit-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { useMarqueeStore } from '../editor-state/marquee-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { useWeightPaintStore } from '../editor-state/weight-paint-store';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useToolStore, type ToolId } from '../editor-state/tool-store';
import { attachCameraController, type CameraControls } from './camera-controller';
import { createViewportLayers } from './layers';
import { MoveRotateGizmo } from './gizmo/move-rotate-gizmo';
import { resolveMeshEditTarget } from './mesh-edit';
import { MeshEditOverlay } from './mesh-overlay';
import { resolveWeightPaintTarget } from './weight-paint';
import { WeightPaintOverlay } from './weight-overlay';
import { MarqueeOverlay } from './marquee-overlay';
import { solveWorldById } from './scene-solve';
import { attachToolInput } from './tool-input';
import { CreateBoneTool } from './tools/create-bone-tool';
import { MeshTool } from './tools/mesh-tool';
import { WeightPaintTool } from './tools/weight-paint-tool';
import { SelectMoveTool } from './tools/select-move-tool';
import { renderTargetsEqual, resolveRenderTarget, type RenderTarget } from './render-target';
import type { ViewportTool } from './tools/tool';
import type { Camera } from './camera';

const BACKGROUND = 0x1e1e1e;

// Mounts a PixiJS v8 Application into the dockview viewport panel and renders the LIVE document from
// the DocumentHost (handoff 8.3): the content layer is exactly what the web runtime renders, the
// overlay layer carries editor chrome (the move/rotate gizmo). The document is the single source of
// truth (never Zustand); the render loop polls model.revision each frame, re-exports the validated
// SkeletonDocument ONLY when the revision changes (caching it by identity so SkeletonView's per-document
// pose cache holds, WP-1.10), and renders either the setup pose or the animated pose sampled at the
// playhead through the SAME shared SkeletonView the web runtime uses (the editor cannot drift from the
// player, TASK-1.10.3). The transport clock (playhead, play/pause, mode) is ephemeral editor state in
// Zustand, never the document and never History (LAW 1, the document/editor wall): while playing, the
// loop advances it from the real frame delta and the store loops or auto-stops at the tail. The camera
// lives in Zustand (ephemeral, never serialized): the render path writes the camera transform onto the
// world container and the input controller writes user pan/zoom back into the store. Pointer events
// route to the active tool unless Space is held, in which case the camera controller pans.
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
    let unsubscribeTextures: (() => void) | null = null;
    let unsubscribeSlotSelection: (() => void) | null = null;
    let unsubscribeMeshEdit: (() => void) | null = null;
    let unsubscribeWeightPaint: (() => void) | null = null;
    let unsubscribeTool: (() => void) | null = null;
    let unsubscribeMarquee: (() => void) | null = null;

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
      const meshOverlay = new MeshEditOverlay();
      layers.overlay.addChild(meshOverlay.container);
      const weightOverlay = new WeightPaintOverlay();
      layers.overlay.addChild(weightOverlay.container);
      const marqueeOverlay = new MarqueeOverlay();
      layers.overlay.addChild(marqueeOverlay.container);

      // The mesh overlay redraws on document revision, slot/vertex selection, tool, and zoom changes
      // (event-driven, never per idle frame); the tick applies it below, mirroring the gizmo pattern.
      let meshOverlayDirty = true;
      // The weight overlay redraws on document revision, slot/bone selection, brush state, tool, and zoom
      // changes (same event-driven contract); the brush cursor follows via the brush-state subscription.
      let weightOverlayDirty = true;
      // The marquee overlay redraws when the marquee store changes (drag start/update/clear) and on zoom.
      let marqueeDirty = true;

      const applyCamera = (camera: Camera): void => {
        layers.world.position.set(camera.x, camera.y);
        layers.world.scale.set(camera.zoom);
        gizmo.applyZoom(camera.zoom); // keep handles a constant pixel size as zoom changes
        meshOverlay.applyZoom(camera.zoom);
        weightOverlay.applyZoom(camera.zoom);
        marqueeOverlay.applyZoom(camera.zoom);
        meshOverlayDirty = true;
        weightOverlayDirty = true;
        marqueeDirty = true;
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
        mesh: new MeshTool(),
        weights: new WeightPaintTool(),
      };
      detachTool = attachToolInput(app.canvas, {
        getCamera: () => useCameraStore.getState(),
        getActiveTool: () => tools[useToolStore.getState().tool],
      });

      // The gizmo re-solves only when the document or the selection changes (not every idle frame).
      let gizmoDirty = true;
      unsubscribeSelection = useSelectionStore.subscribe(() => {
        gizmoDirty = true;
        weightOverlayDirty = true; // the active bone drives the weight heat map
      });
      unsubscribeSlotSelection = useSlotSelectionStore.subscribe(() => {
        meshOverlayDirty = true;
        weightOverlayDirty = true;
      });
      unsubscribeMeshEdit = useMeshEditStore.subscribe(() => {
        meshOverlayDirty = true;
      });
      unsubscribeWeightPaint = useWeightPaintStore.subscribe(() => {
        weightOverlayDirty = true;
      });
      unsubscribeTool = useToolStore.subscribe(() => {
        meshOverlayDirty = true;
        weightOverlayDirty = true;
      });
      unsubscribeMarquee = useMarqueeStore.subscribe(() => {
        marqueeDirty = true;
      });

      // The region texture resolver is ephemeral editor state (the atlas pixels are loaded per import
      // session, never in the document). It changes only on import/clear, so the binding is event-driven,
      // not per-frame: the subscription just sets a flag, and the tick below applies the resolver and
      // forces ONE re-render. Starts true so the CURRENT resolver is applied at mount, covering the case
      // where an atlas was imported before this viewport mounted (or a StrictMode remount).
      let resolverDirty = true;
      unsubscribeTextures = atlasTextureStore.subscribe(() => {
        resolverDirty = true;
      });

      // The last successfully exported document, cached by model.revision. SkeletonView keys its prepared
      // pose on document IDENTITY (a WeakMap), so this reference MUST stay stable while the document is
      // unchanged: re-exporting every frame would defeat that cache and re-pay full validation per frame
      // (TASK-1.10.5). A transiently invalid mid-gesture revision keeps the last good doc and skips, so the
      // loop never crashes and never drops the last good scene.
      let cachedDoc: SkeletonDocument | null = null;
      // The render target last pushed to the view. The loop re-renders only when this changes (mode, active
      // animation, or playhead) or the revision changed; null forces the first render after a (re)export.
      let lastTarget: RenderTarget | null = null;
      let lastRevision = -1;

      const tick = (ticker: Ticker): void => {
        const model = documentHost.current().model;

        // Bind a new (or initial) region texture resolver before deciding what to render. setTextureResolver
        // invalidates the view's scene cache, but the change detector below only re-syncs on a revision or
        // target change, so reset the target gate to force ONE re-render that rebinds the textures. This
        // tick runs at NORMAL priority, ahead of Pixi's render (LOW), so the rebuilt scene is what gets
        // drawn this frame: the old page source the store just destroyed on re-import is never rendered.
        if (resolverDirty) {
          view.setTextureResolver(atlasTextureStore.getResolver());
          resolverDirty = false;
          lastTarget = null;
        }

        const revisionChanged = model.revision !== lastRevision;
        if (revisionChanged) {
          lastRevision = model.revision;
          if (model.bones().length === 0) {
            cachedDoc = null;
          } else {
            try {
              cachedDoc = exportDocument(model);
            } catch {
              // A transiently invalid in-progress document (mid-gesture) must not crash the loop or drop the
              // last good scene: keep cachedDoc and re-export on the next valid revision. exportDocument
              // fails loudly where it matters (save).
            }
          }
          gizmoDirty = true;
        }

        // Read the ephemeral transport imperatively (the ticker lives outside React, so it must not couple
        // to a re-render). Resolve the active animation from the SAME revision the cached doc came from, so
        // its NAME is a live key of cachedDoc.animations: a rename bumps the revision, re-exporting the doc
        // and re-resolving the name together, and one lookup serves both the name and the duration.
        const playback = usePlaybackStore.getState();
        const activeAnimation =
          playback.activeAnimation === null
            ? null
            : (model.getAnimation(playback.activeAnimation) ?? null);
        const animationName = activeAnimation?.name ?? null;

        // Advance the transport from the real frame delta (LAW 1: the playhead is editor state, this never
        // touches the document or History). The store loops or auto-stops at the tail; with no active
        // animation or a zero-length one there is no clock to advance.
        if (playback.isPlaying && activeAnimation !== null && activeAnimation.duration > 0) {
          playback.tick(ticker.deltaMS / 1000, activeAnimation.duration);
        }

        // Decide the frame from the POST-advance playhead, so it shows the time the transport just produced.
        const target = resolveRenderTarget(
          playback.mode,
          animationName,
          usePlaybackStore.getState().playhead,
        );

        if (cachedDoc === null) {
          // Zero-bone (or never-exported) document: show nothing, clearing once on the transition.
          if (revisionChanged) {
            view.clear();
            lastTarget = null;
          }
        } else if (
          revisionChanged ||
          lastTarget === null ||
          !renderTargetsEqual(target, lastTarget)
        ) {
          if (target.kind === 'animated') {
            view.syncAnimated(cachedDoc, target.animation, target.time);
          } else {
            // cachedDoc is already validated, but sync() is the setup render path; it is gated by the
            // change detector so this re-validates only on a real change, not every frame.
            view.sync(cachedDoc);
          }
          lastTarget = target;
        }

        if (gizmoDirty) {
          gizmo.refresh(model);
          gizmoDirty = false;
        }

        if (revisionChanged) meshOverlayDirty = true;
        if (meshOverlayDirty) {
          const meshTarget =
            useToolStore.getState().tool === 'mesh'
              ? resolveMeshEditTarget(model, useSlotSelectionStore.getState().selectedSlotId)
              : null;
          meshOverlay.refresh(meshTarget, useMeshEditStore.getState().selectedVertex);
          meshOverlayDirty = false;
        }

        if (revisionChanged) weightOverlayDirty = true;
        if (weightOverlayDirty) {
          const weightsActive = useToolStore.getState().tool === 'weights';
          const weightTarget = weightsActive
            ? resolveWeightPaintTarget(model, useSlotSelectionStore.getState().selectedSlotId)
            : null;
          const brush = useWeightPaintStore.getState();
          weightOverlay.refresh(
            weightTarget,
            weightTarget !== null ? solveWorldById(model) : new Map(),
            weightsActive ? (useSelectionStore.getState().selectedBoneIds[0] ?? null) : null,
            { hoverWorld: weightsActive ? brush.hoverWorld : null, radiusPx: brush.radiusPx },
          );
          weightOverlayDirty = false;
        }

        if (marqueeDirty) {
          marqueeOverlay.refresh(useMarqueeStore.getState().rect);
          marqueeDirty = false;
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
      unsubscribeTextures?.();
      unsubscribeSlotSelection?.();
      unsubscribeMeshEdit?.();
      unsubscribeWeightPaint?.();
      unsubscribeTool?.();
      unsubscribeMarquee?.();
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
      {toolButton('mesh', 'Mesh (M)')}
      {toolButton('weights', 'Weights (W)')}
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
