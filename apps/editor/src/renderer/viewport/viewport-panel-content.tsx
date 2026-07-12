import { Application, type Ticker } from 'pixi.js';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import { SkeletonView } from '@marionette/runtime-web';
import type { SkeletonDocument } from '@marionette/format/types';
import { documentHost, exportDocument } from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { useCameraStore } from '../editor-state/camera-store';
import { useMeshEditStore } from '../editor-state/mesh-edit-store';
import { usePathEditStore } from '../editor-state/path-edit-store';
import { useSelectionStore } from '../editor-state/selection-store';
import { useMarqueeStore } from '../editor-state/marquee-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { useWeightPaintStore } from '../editor-state/weight-paint-store';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useOnionSkinStore } from '../editor-state/onion-skin-store';
import { DEFAULT_SKIN_NAME, useSkinPreviewStore } from '../editor-state/skin-preview-store';
import { useToolStore, type ToolId } from '../editor-state/tool-store';
import { attachCameraController, type CameraControls } from './camera-controller';
import { createViewportLayers } from './layers';
import { MoveRotateGizmo } from './gizmo/move-rotate-gizmo';
import { resolveMeshEditTarget } from './mesh-edit';
import { MeshEditOverlay } from './mesh-overlay';
import { resolvePathEditTarget } from './path-edit';
import { PathEditOverlay } from './path-overlay';
import { resolveWeightPaintTarget } from './weight-paint';
import { WeightPaintOverlay } from './weight-overlay';
import { MarqueeOverlay } from './marquee-overlay';
import { GridOverlay } from './grid-overlay';
import { OnionSkinOverlay } from './onion-overlay';
import { deriveOnionGhosts } from './onion-skin';
import { solveWorldById } from './scene-solve';
import { derivePhysicsFrameDt } from './physics-preview';
import { attachToolInput } from './tool-input';
import { CreateBoneTool } from './tools/create-bone-tool';
import { MeshTool } from './tools/mesh-tool';
import { PathTool } from './tools/path-tool';
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
    let unsubscribePathEdit: (() => void) | null = null;
    let unsubscribeWeightPaint: (() => void) | null = null;
    let unsubscribeTool: (() => void) | null = null;
    let unsubscribeMarquee: (() => void) | null = null;
    let unsubscribeSkin: (() => void) | null = null;
    let unsubscribeOnion: (() => void) | null = null;
    let onionOverlay: OnionSkinOverlay | null = null;

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

      // The reference grid sits at index 0 of the world container so ALL content renders above it.
      const gridOverlay = new GridOverlay();
      layers.world.addChildAt(gridOverlay.container, 0);

      // Content: the shared runtime-web scene. Overlay: the gizmo (editor-only chrome). The onion-skin ghosts
      // are added FIRST so they render BEHIND the live pose (PP-D3); the overlay pools its own SkeletonViews.
      const onion = new OnionSkinOverlay();
      onionOverlay = onion;
      layers.content.addChild(onion.container);
      const view = new SkeletonView();
      layers.content.addChild(view.root);
      const gizmo = new MoveRotateGizmo();
      layers.overlay.addChild(gizmo.container);
      const meshOverlay = new MeshEditOverlay();
      layers.overlay.addChild(meshOverlay.container);
      const pathOverlay = new PathEditOverlay();
      layers.overlay.addChild(pathOverlay.container);
      const weightOverlay = new WeightPaintOverlay();
      layers.overlay.addChild(weightOverlay.container);
      const marqueeOverlay = new MarqueeOverlay();
      layers.overlay.addChild(marqueeOverlay.container);

      // The mesh overlay redraws on document revision, slot/vertex selection, tool, and zoom changes
      // (event-driven, never per idle frame); the tick applies it below, mirroring the gizmo pattern.
      let meshOverlayDirty = true;
      // The path overlay redraws on document revision, slot/point selection, tool, and zoom changes (same
      // event-driven contract as the mesh overlay); the tick applies it below.
      let pathOverlayDirty = true;
      // The weight overlay redraws on document revision, slot/bone selection, brush state, tool, and zoom
      // changes (same event-driven contract); the brush cursor follows via the brush-state subscription.
      let weightOverlayDirty = true;
      // The marquee overlay redraws when the marquee store changes (drag start/update/clear) and on zoom.
      let marqueeDirty = true;

      const applyCamera = (camera: Camera): void => {
        layers.world.position.set(camera.x, camera.y);
        layers.world.scale.set(camera.zoom);
        gridOverlay.refresh(camera, app?.screen.width ?? 0, app?.screen.height ?? 0);
        gizmo.applyZoom(camera.zoom); // keep handles a constant pixel size as zoom changes
        meshOverlay.applyZoom(camera.zoom);
        pathOverlay.applyZoom(camera.zoom);
        weightOverlay.applyZoom(camera.zoom);
        marqueeOverlay.applyZoom(camera.zoom);
        meshOverlayDirty = true;
        pathOverlayDirty = true;
        weightOverlayDirty = true;
        marqueeDirty = true;
      };
      applyCamera(useCameraStore.getState());
      unsubscribeCamera = useCameraStore.subscribe(applyCamera);
      // A panel resize changes the visible world span without a camera change; re-span the grid.
      app.renderer.on('resize', () => {
        gridOverlay.refresh(
          useCameraStore.getState(),
          app?.screen.width ?? 0,
          app?.screen.height ?? 0,
        );
      });
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
        path: new PathTool(),
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
        pathOverlayDirty = true;
        weightOverlayDirty = true;
      });
      unsubscribeMeshEdit = useMeshEditStore.subscribe(() => {
        meshOverlayDirty = true;
      });
      unsubscribePathEdit = usePathEditStore.subscribe(() => {
        pathOverlayDirty = true;
      });
      unsubscribeWeightPaint = useWeightPaintStore.subscribe(() => {
        weightOverlayDirty = true;
      });
      unsubscribeTool = useToolStore.subscribe(() => {
        meshOverlayDirty = true;
        pathOverlayDirty = true;
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

      // The active-skin PREVIEW is ephemeral editor state (PP-D4). It changes only when the author switches
      // the previewed skin, so the binding is event-driven: the subscription flags it and the tick applies
      // it to the shared SkeletonView before rendering. A revision change also re-applies it (below), so a
      // newly added skin becomes previewable and a removed one falls back to default without a throw.
      let skinDirty = false;
      unsubscribeSkin = useSkinPreviewStore.subscribe(() => {
        skinDirty = true;
      });

      // Onion-skin settings are ephemeral editor state (PP-D3); a change flags the ghosts for a re-derive.
      // Ghosts are otherwise re-derived only when the playhead, revision, or render target moves (the gate in
      // the tick), so a paused viewport with onion skinning on does no idle solve work.
      let onionDirty = true;
      unsubscribeOnion = useOnionSkinStore.subscribe(() => {
        onionDirty = true;
      });
      let lastOnionPlayhead = Number.NaN;
      let onionActive = false;

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
          const resolver = atlasTextureStore.getResolver();
          view.setTextureResolver(resolver);
          onion.setTextureResolver(resolver);
          resolverDirty = false;
          lastTarget = null;
          onionDirty = true; // rebind ghost textures too
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

        // Apply the ephemeral skin PREVIEW (PP-D4) to the shared SkeletonView BEFORE rendering. The desired
        // name is validated against the document about to be drawn (cachedDoc), so the scene rebuild applies
        // a skin the document actually defines (ensureScene throws for an unknown remembered skin); an
        // unknown or removed skin falls back to default. Applying to a not-yet-rebuilt stale scene can throw
        // when the doc and skin change together, but setActiveSkin records the pending name first and the
        // imminent (re)sync applies it cleanly, so that transient throw is benign and swallowed. Forcing
        // lastTarget to null makes the render block below re-render under the new skin.
        if ((skinDirty || revisionChanged) && cachedDoc !== null) {
          const desired = useSkinPreviewStore.getState().activeSkin;
          const inDoc =
            desired === DEFAULT_SKIN_NAME || cachedDoc.skins.some((skin) => skin.name === desired);
          const applyName = inDoc ? desired : DEFAULT_SKIN_NAME;
          if (view.getActiveSkin() !== applyName) {
            try {
              view.setActiveSkin(applyName);
            } catch {
              // Benign: the pending name is recorded and the (re)sync below applies it to the rebuilt scene.
            }
            lastTarget = null;
          }
          skinDirty = false;
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
        const realDeltaSeconds = ticker.deltaMS / 1000;
        const isAdvancing =
          playback.isPlaying && activeAnimation !== null && activeAnimation.duration > 0;
        if (isAdvancing) {
          playback.tick(realDeltaSeconds, activeAnimation.duration);
        }

        // The physics simulation delta for THIS frame (ADR-0014): the real elapsed animation time while the
        // transport advances the playhead, 0 otherwise (paused, scrubbing, or nothing to play), so authored
        // physics constraints animate during playback and go inert the moment it stops. It is derived from the
        // SAME playback ticker delta the playhead advances on (never Date.now), scaled by the playback speed and
        // capped so a stalled frame cannot explode the sim. Pure scalar math, no per-frame allocation; a rig
        // with no physics ignores it (the solve stays byte-identical), and a scrub jump teleports through the
        // solve's own RESET_DISTANCE contract (no editor-side reset hack).
        const physicsFrameDt = derivePhysicsFrameDt(
          isAdvancing,
          realDeltaSeconds,
          playback.playbackSpeed,
        );

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
            view.syncAnimated(cachedDoc, target.animation, target.time, physicsFrameDt);
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

        if (revisionChanged) pathOverlayDirty = true;
        if (pathOverlayDirty) {
          const pathTarget =
            useToolStore.getState().tool === 'path'
              ? resolvePathEditTarget(model, useSlotSelectionStore.getState().selectedSlotId)
              : null;
          pathOverlay.refresh(pathTarget, usePathEditStore.getState().selectedPoint);
          pathOverlayDirty = false;
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

        // Onion skinning (PP-D3): ghost the pose at N frames before/after the playhead, faintly, behind the
        // live pose. Only meaningful in animation mode over an animated target with a real period. Ghosts are
        // re-derived only when a setting, the revision, the render target, or the playhead changed (the gate),
        // so a paused viewport does no idle solve work; while playing the moving playhead re-derives each frame,
        // matching how the live pose already re-syncs. deriveOnionGhosts is pure and capped, and the overlay
        // pools its display objects (no per-frame allocation beyond the pooled per-view region products).
        const onionSettings = useOnionSkinStore.getState();
        const playheadNow = usePlaybackStore.getState().playhead;
        const showGhosts =
          onionSettings.enabled &&
          playback.mode === 'animation' &&
          target.kind === 'animated' &&
          cachedDoc !== null &&
          animationName !== null &&
          activeAnimation !== null &&
          activeAnimation.duration > 0;
        if (
          onionDirty ||
          revisionChanged ||
          showGhosts !== onionActive ||
          playheadNow !== lastOnionPlayhead
        ) {
          if (showGhosts && cachedDoc !== null && activeAnimation !== null) {
            const ghosts = deriveOnionGhosts(
              onionSettings,
              playheadNow,
              playback.workingFps,
              activeAnimation.duration,
              playback.loop,
            );
            onion.refresh(cachedDoc, animationName, ghosts);
          } else {
            onion.clear();
          }
          onionDirty = false;
          onionActive = showGhosts;
          lastOnionPlayhead = playheadNow;
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
      unsubscribePathEdit?.();
      unsubscribeWeightPaint?.();
      unsubscribeTool?.();
      unsubscribeMarquee?.();
      unsubscribeSkin?.();
      unsubscribeOnion?.();
      // Release the pooled ghost views (their mesh geometry buffers) before the app tears down the tree.
      onionOverlay?.destroy();
      onionOverlay = null;
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
      <EmptyDocumentHint />
    </div>
  );
}

// First-run guidance (pointer-transparent, editor chrome only): shown while the document has no bones
// and no atlas, which is exactly the state where a new user stares at an empty viewport with no idea
// where to begin. It names the three entry paths and disappears the moment any content exists.
function EmptyDocumentHint(): ReactElement | null {
  const revision = useDocumentRevision();
  const isEmpty = useMemo(() => {
    void revision;
    const model = documentHost.current().model;
    return model.bones().length === 0 && model.preserved().atlas.pages.length === 0;
  }, [revision]);

  if (!isEmpty) return null;
  return (
    <div style={emptyHintWrapStyle} aria-hidden>
      <div style={emptyHintBoxStyle}>
        <div style={emptyHintTitleStyle}>Start a rig</div>
        <div>
          Import art: <b>File &gt; Import Sprites</b>, <b>Import PSD/ORA</b>, or{' '}
          <b>Import Spine Project</b>
        </div>
        <div>
          or press <b>B</b> and drag in the viewport to create bones
        </div>
        <div>
          Pan: <b>Space + drag</b> &nbsp; Zoom: <b>scroll</b>
        </div>
      </div>
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
  const onionEnabled = useOnionSkinStore((state) => state.enabled);

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
      {toolButton('path', 'Path (P)')}
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
      <span style={dividerStyle} />
      <button
        type="button"
        onClick={() => useOnionSkinStore.getState().toggle()}
        disabled={mode === 'setup'}
        title="Ghost frames before and after the playhead"
        style={{
          ...buttonStyle,
          ...(mode === 'animation' && onionEnabled ? buttonActiveStyle : null),
          ...(mode === 'setup' ? buttonDisabledStyle : null),
        }}
      >
        Onion
      </button>
      {mode === 'animation' && onionEnabled && <OnionSettings />}
    </div>
  );
}

// Compact onion-skin count/opacity steppers, shown only when onion skinning is on. Reads and writes the
// ephemeral onion store (the document/editor wall); the viewport picks the values up on the next frame.
function OnionSettings(): ReactElement {
  const before = useOnionSkinStore((state) => state.before);
  const after = useOnionSkinStore((state) => state.after);
  const opacity = useOnionSkinStore((state) => state.opacity);
  const store = useOnionSkinStore;
  return (
    <span style={onionSettingsStyle}>
      <label style={onionLabelStyle}>
        before
        <input
          type="number"
          min={0}
          max={16}
          value={before}
          onChange={(event) => store.getState().setBefore(Number(event.target.value))}
          style={onionInputStyle}
        />
      </label>
      <label style={onionLabelStyle}>
        after
        <input
          type="number"
          min={0}
          max={16}
          value={after}
          onChange={(event) => store.getState().setAfter(Number(event.target.value))}
          style={onionInputStyle}
        />
      </label>
      <label style={onionLabelStyle}>
        opacity
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(event) => store.getState().setOpacity(Number(event.target.value))}
          style={onionRangeStyle}
        />
      </label>
    </span>
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

const onionSettingsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 8px',
  background: 'rgba(30, 30, 30, 0.85)',
  border: '1px solid #444444',
  borderRadius: 4,
  fontSize: 11,
  color: '#cccccc',
};

const onionLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 4 };

const onionInputStyle: CSSProperties = {
  width: 42,
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 3,
  padding: '1px 4px',
};

const onionRangeStyle: CSSProperties = { width: 70 };

// Animation-mode chrome: an inset tinted border framing the whole viewport so the mode is unmistakable at
// a glance, with a small banner top-center. pointerEvents none so it never steals gizmo/camera input.
const animationTintStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  boxSizing: 'border-box',
  border: '2px solid rgba(214, 132, 46, 0.85)',
};

// Top-RIGHT, not centered: a centered banner collides with the top-left toolbar on narrow viewports
// (observed as overlapping buttons in the packaged app).
const animationBannerStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
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

const emptyHintWrapStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
};

const emptyHintBoxStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '18px 26px',
  borderRadius: 8,
  background: 'rgba(24, 26, 32, 0.82)',
  border: '1px solid #3a3f4a',
  color: '#aab2c0',
  fontSize: 13,
  textAlign: 'center',
};

const emptyHintTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: '#dde3ee',
};
