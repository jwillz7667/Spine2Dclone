import { Container, Text, TextStyle, type Ticker } from 'pixi.js';
import type { EscalationTier } from '@marionette/runtime-core';
import {
  SlotSceneView,
  cellCenter,
  gridMetrics,
  gridSize,
  type GridMetrics,
  type SlotSceneCallbacks,
} from '@marionette/runtime-web';
import type { GridConfig, SlotScene } from '@marionette/format/slot-types';
import { documentHost, exportSlotSceneDocument } from '../../document';
import { createPreviewStage, type PreviewStage } from '../preview/preview-stage';
import { fitSize } from '../preview/preview-fit';
import {
  advancePreview,
  cyclePreviewBackground,
  makePreviewTransport,
  pausePreview,
  playPreview,
  restartPreview,
  setPreviewBackground,
  togglePreviewPlay,
  type PreviewBackground,
  type PreviewTransport,
} from '../preview/preview-transport';
import {
  DEFAULT_SLOT_PREVIEW_SCENARIO,
  resolveSlotPlayhead,
  scenarioScene,
  scenarioTimeline,
  type SlotPreviewScenarioId,
} from './slot-preview-model';

// The slot panel scene preview (PP-D8 deliverable 2). It mounts the runtime-web SlotSceneView, which plays a
// PresentationTimeline (the reel stops, symbol landings, win-cell highlights, and counter rollup) exactly as
// the packaged player does, driven by a committed MockMathEngine scenario the selector picks. LAW 1 holds:
// the outcome is always a committed SpinResult run through the shared runtime-core `sequence`; nothing here
// invents a symbol or a payout. The preview is read-only over the document: it re-exports the authored slot
// scene (exportSlotSceneDocument, a pure projection) and re-sequences when the scene changes, but never
// issues a command.
//
// The editor has no external symbol skeleton documents loaded, so the SlotSceneView's per-cell symbol
// resolver returns null (no skeleton is mounted) and this view adds a lightweight glyph overlay that labels
// each cell with its resolved SymbolId, positioned through the SAME runtime-web grid-layout functions the
// SlotSceneView uses (so the glyph and the highlight box always align). The counter rollup / escalation /
// flow / vfx directives surface through the SlotSceneView callbacks to a panel HUD.
//
// Lifecycle mirrors the viewport: async Application init guarded against an unmount race, a ticker that
// throttles while the dockview tab is hidden, and a full destroy that tears down every SkeletonView the
// SlotSceneView pooled plus the glyph texts. The glyph overlay refreshes off the 60fps path (a throttled
// describe()), so the steady per-frame path stays the runtime-web allocation-free advance.

const FIT_PADDING = 20;
// Hold the final frame this long before the preview loops, so a completed win sequence reads before replay.
const TAIL_HOLD_MS = 1200;
// Refresh the cell glyph labels at this cadence (off the per-frame path; describe() allocates its snapshot).
const GLYPH_REFRESH_MS = 80;
// Throttle HUD pushes so a per-frame rollup value change does not thrash React.
const HUD_INTERVAL_MS = 100;
const HIGHLIGHT_COLOR = 0xffe066;

export interface SlotPreviewHud {
  readonly rollupValue: number | null;
  readonly escalation: EscalationTier | null;
  readonly flowState: string | null;
  readonly lastVfx: string | null;
}

const EMPTY_HUD: SlotPreviewHud = {
  rollupValue: null,
  escalation: null,
  flowState: null,
  lastVfx: null,
};

export interface SlotPreviewCallbacks {
  readonly onTransport: (transport: PreviewTransport) => void;
  readonly onScenario: (scenario: SlotPreviewScenarioId) => void;
  readonly onHud: (hud: SlotPreviewHud) => void;
  readonly onNotice: (message: string | null) => void;
}

export interface SlotPreviewHandle {
  setScenario: (scenario: SlotPreviewScenarioId) => void;
  resyncFromDocument: () => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  restart: () => void;
  cycleBackground: () => void;
  setBackground: (background: PreviewBackground) => void;
  destroy: () => void;
}

export function mountSlotPreview(
  host: HTMLElement,
  callbacks: SlotPreviewCallbacks,
): SlotPreviewHandle {
  let disposed = false;
  let stage: PreviewStage | null = null;

  let transport = makePreviewTransport();
  let scenarioId: SlotPreviewScenarioId = DEFAULT_SLOT_PREVIEW_SCENARIO;

  let slotView: SlotSceneView | null = null;
  let glyphLayer: Container | null = null;
  let glyphs: Text[] = []; // row-major, one per cell
  let metrics: GridMetrics | null = null;
  let durationMs = 0;
  // The (rows,cols) signature of the mounted SlotSceneView; a scene resize that changes it forces a rebuild
  // (the view fixes its grid at construction). Content-only edits re-sequence without a rebuild.
  let builtRows = -1;
  let builtCols = -1;
  let builtSceneHash: string | null = null;

  let hud: SlotPreviewHud = EMPTY_HUD;
  let lastFitW = -1;
  let lastFitH = -1;
  let glyphAccumMs = 0;
  let hudAccumMs = 0;
  let hudDirty = false;

  const glyphStyle = new TextStyle({ fill: '#f4f4f4', fontSize: 16, fontWeight: '600' });

  const notifyTransport = (): void => callbacks.onTransport(transport);

  const setHud = (patch: Partial<SlotPreviewHud>): void => {
    hud = { ...hud, ...patch };
    hudDirty = true;
  };

  const sceneCallbacks: SlotSceneCallbacks = {
    onRollup: (value) => setHud({ rollupValue: value }),
    onEscalation: (tier) => setHud({ escalation: tier }),
    onFlowEnter: (state) => setHud({ flowState: state }),
    onFlowExit: () => setHud({ flowState: null }),
    onVfxBurst: (preset) => setHud({ lastVfx: preset }),
    onMultiplierOrb: (valueX) => setHud({ lastVfx: `x${valueX}` }),
  };

  // Read the live authored scene as a format SlotScene plus its content hash (for the resync gate).
  const readScene = (): { scene: SlotScene; hash: string } => {
    const doc = exportSlotSceneDocument(documentHost.current().model.slotScene(), 'preview');
    return { scene: doc.scene, hash: doc.hash };
  };

  const teardownScene = (): void => {
    if (slotView !== null) {
      stage?.content.removeChild(slotView.root);
      slotView.destroy();
      slotView = null;
    }
    if (glyphLayer !== null) {
      stage?.content.removeChild(glyphLayer);
      glyphLayer.destroy({ children: true });
      glyphLayer = null;
    }
    glyphs = [];
    metrics = null;
  };

  // Rebuild the SlotSceneView, glyph overlay, and timeline for the current scenario against the live scene.
  // Outside the per-frame path (a scenario or grid change); the steady path is the runtime-web advance.
  const rebuild = (): void => {
    if (stage === null) return;
    teardownScene();

    const { scene, hash } = readScene();
    const resized = scenarioScene(scene, scenarioId);
    const grid: GridConfig = resized.grid;

    const view = new SlotSceneView(grid, {
      // No external symbol skeletons in the editor preview: the board choreography renders via the highlight
      // overlay + phases + the glyph overlay below; a resolver would need loaded symbol documents.
      symbolResolver: () => null,
      callbacks: sceneCallbacks,
      highlightColor: HIGHLIGHT_COLOR,
    });
    stage.content.addChild(view.root);

    const layer = new Container();
    stage.content.addChild(layer);
    const gm = gridMetrics(grid);
    const cellGlyphs: Text[] = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const text = new Text({ text: '', style: glyphStyle });
        text.anchor.set(0.5);
        const center = cellCenter(gm, row, col);
        text.position.set(center.x, center.y);
        text.visible = false;
        layer.addChild(text);
        cellGlyphs.push(text);
      }
    }

    const timeline = scenarioTimeline(scene, scenarioId);
    view.setTimeline(timeline);

    slotView = view;
    glyphLayer = layer;
    glyphs = cellGlyphs;
    metrics = gm;
    durationMs = timeline.durationMs;
    builtRows = grid.rows;
    builtCols = grid.cols;
    builtSceneHash = hash;

    hud = EMPTY_HUD;
    callbacks.onHud(hud);
    transport = restartPreview(transport);
    lastFitW = -1; // force a refit for the new board size
    refreshGlyphs();
    callbacks.onNotice(null);
    notifyTransport();
  };

  // Update the cell glyph labels from the SlotSceneView's board snapshot. Off the per-frame path (throttled),
  // since describe() allocates its snapshot; a steady frame that does not cross a directive changes nothing.
  const refreshGlyphs = (): void => {
    if (slotView === null || metrics === null) return;
    const description = slotView.describe();
    for (let row = 0; row < description.rows; row += 1) {
      for (let col = 0; col < description.cols; col += 1) {
        const glyph = glyphs[row * description.cols + col];
        if (glyph === undefined) continue;
        const symbol = description.symbols[row]?.[col] ?? null;
        glyph.text = symbol ?? '';
        glyph.visible = symbol !== null;
      }
    }
  };

  const refit = (): void => {
    if (stage === null || metrics === null) return;
    const size = gridSize(metrics);
    const screen = stage.screenSize();
    stage.applyFit(fitSize(size.width, size.height, screen.width, screen.height, FIT_PADDING));
    lastFitW = screen.width;
    lastFitH = screen.height;
  };

  const tick = (ticker: Ticker): void => {
    if (stage === null || stage.isHidden()) return;

    stage.syncBackground(transport.background);

    const screen = stage.screenSize();
    if (screen.width !== lastFitW || screen.height !== lastFitH) refit();

    if (slotView === null || !transport.isPlaying) return;

    transport = advancePreview(transport, ticker.deltaMS);
    const playhead = resolveSlotPlayhead(transport.elapsedMs, durationMs, TAIL_HOLD_MS);
    if (playhead.shouldRestart) {
      transport = restartPreview(transport);
      hud = EMPTY_HUD;
      hudDirty = true;
      slotView.update(0);
      refreshGlyphs();
    } else {
      slotView.update(playhead.timeMs);
    }

    glyphAccumMs += ticker.deltaMS;
    if (glyphAccumMs >= GLYPH_REFRESH_MS) {
      glyphAccumMs = 0;
      refreshGlyphs();
    }

    hudAccumMs += ticker.deltaMS;
    if (hudDirty && hudAccumMs >= HUD_INTERVAL_MS) {
      hudAccumMs = 0;
      hudDirty = false;
      callbacks.onHud(hud);
    }
  };

  void (async () => {
    const created = await createPreviewStage(host, transport.background);
    if (disposed) {
      created.destroy();
      return;
    }
    stage = created;
    rebuild();
    stage.app.ticker.add(tick);
  })();

  return {
    setScenario(next: SlotPreviewScenarioId): void {
      if (next === scenarioId) return;
      scenarioId = next;
      callbacks.onScenario(next);
      rebuild();
    },
    resyncFromDocument(): void {
      if (stage === null) return;
      const { scene, hash } = readScene();
      if (hash === builtSceneHash) return; // authored scene unchanged: keep the running preview
      const resized = scenarioScene(scene, scenarioId);
      // A grid resize needs a fresh SlotSceneView (its grid is fixed at construction); a content-only edit
      // just re-sequences the timeline in place.
      if (resized.grid.rows !== builtRows || resized.grid.cols !== builtCols || slotView === null) {
        rebuild();
        return;
      }
      const timeline = scenarioTimeline(scene, scenarioId);
      slotView.setTimeline(timeline);
      durationMs = timeline.durationMs;
      builtSceneHash = hash;
      transport = restartPreview(transport);
      hud = EMPTY_HUD;
      callbacks.onHud(hud);
      refreshGlyphs();
      notifyTransport();
    },
    play(): void {
      transport = playPreview(transport);
      notifyTransport();
    },
    pause(): void {
      transport = pausePreview(transport);
      notifyTransport();
    },
    togglePlay(): void {
      transport = togglePreviewPlay(transport);
      notifyTransport();
    },
    restart(): void {
      transport = restartPreview(transport);
      hud = EMPTY_HUD;
      callbacks.onHud(hud);
      slotView?.update(0);
      refreshGlyphs();
      notifyTransport();
    },
    cycleBackground(): void {
      transport = cyclePreviewBackground(transport);
      notifyTransport();
    },
    setBackground(background: PreviewBackground): void {
      transport = setPreviewBackground(transport, background);
      notifyTransport();
    },
    destroy(): void {
      disposed = true;
      teardownScene();
      glyphStyle.destroy();
      if (stage !== null) {
        stage.app.ticker.remove(tick);
        stage.destroy();
        stage = null;
      }
    },
  };
}
