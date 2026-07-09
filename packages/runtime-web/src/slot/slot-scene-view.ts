import { Container, Graphics } from 'pixi.js';
import type {
  EscalationTier,
  GridAnchor,
  PresentationDirective,
  PresentationTimeline,
} from '@marionette/runtime-core';
import type { GridConfig, SymbolAnimSet, SymbolId } from '@marionette/format/slot-types';
import type { SkeletonDocument } from '@marionette/format/types';
import { SkeletonView } from '../scene/skeleton-view';
import type { RegionTextureResolver } from '../scene/region-textures';
import {
  advanceTimelineTo,
  counterRollupDisplayValue,
  makeTimelineCursor,
  resetTimelineCursor,
  type TimelineCursor,
} from './timeline-cursor';
import { cellCenter, gridMetrics, type GridMetrics } from './grid-layout';
import {
  applyDirective,
  cellIndex,
  makeSlotSceneState,
  resetSlotSceneState,
  type CellPhase,
  type SlotSceneState,
} from './slot-scene-state';

// The PixiJS slot scene renderer (phase-4 WP-4.11 / PP-C4). It consumes a PresentationTimeline through the
// allocation-free timeline cursor and the pure board reducer (slot-scene-state), then draws the board:
// one pooled SkeletonView per grid cell playing the resolved symbol's phase animation, and a Graphics
// overlay highlighting winning cells. The non-board directives are surfaced to host callbacks (counter
// rollup value, vfx bursts, escalation banners, feature-flow transitions, multiplier orbs); the counter
// TEXT and the actual VFX/banner widgets are the host's (a text glyph counter is out of GL scope here).
//
// Pure vs GL split: every timing and board-state decision lives in the pure modules (timeline-cursor,
// slot-scene-state, grid-layout), tested headlessly; this adapter owns only the display objects (mounting
// SkeletonViews, positioning cells, drawing the highlight overlay). The per-cell symbol skeletons are
// resolved through an injected SymbolResolver (the player wires it from the scene's refs.skeletons), so
// runtime-web needs no knowledge of how the host loads symbol documents.

// The host-resolved rendering inputs for one symbol: its skeleton document, its phase->animation names,
// and an optional per-symbol region texture resolver.
export interface ResolvedSymbol {
  readonly document: SkeletonDocument;
  readonly animSet: SymbolAnimSet;
  readonly textureResolver?: RegionTextureResolver | null;
}

// Resolve a SymbolId to its rendering inputs, or null when the symbol is not renderable (drawn empty).
export type SymbolResolver = (symbol: SymbolId) => ResolvedSymbol | null;

// Host callbacks for the non-board directives. `worldX` / `worldY` are the anchor resolved to grid-local
// pixels (a cell center, or the absolute screen position), so the host can place a VFX / orb without
// re-deriving the grid geometry.
export interface SlotSceneCallbacks {
  readonly onRollup?: (value: number, atMs: number) => void;
  readonly onVfxBurst?: (preset: string, worldX: number, worldY: number, atMs: number) => void;
  readonly onEscalation?: (tier: EscalationTier, atMs: number) => void;
  readonly onFlowEnter?: (state: string, atMs: number) => void;
  readonly onFlowExit?: (state: string, atMs: number) => void;
  readonly onMultiplierOrb?: (valueX: number, worldX: number, worldY: number, atMs: number) => void;
}

export interface SlotSceneViewOptions {
  readonly symbolResolver: SymbolResolver;
  readonly callbacks?: SlotSceneCallbacks;
  // The stroke color / width of the winning-cell highlight box (a plain rectangle overlay; win-line
  // polylines are not carried by the directive union, so a per-winning-cell box is the highlight).
  readonly highlightColor?: number;
  readonly highlightWidth?: number;
}

// One grid cell's display binding: the positioned container, its pooled SkeletonView (created lazily when
// the cell first shows a renderable symbol), and the currently-mounted symbol + phase so a steady frame
// re-syncs nothing structural.
interface CellBinding {
  readonly container: Container;
  readonly row: number;
  readonly col: number;
  view: SkeletonView | null;
  symbol: SymbolId | null;
  phase: CellPhase | null;
  resolved: ResolvedSymbol | null;
  // The clock time (ms) the current phase began, so the cell animation plays from its own local zero.
  phaseStartMs: number;
}

// Headless snapshot of the last update() for tests / tooling (no WebGL needed).
export interface SlotSceneDescription {
  readonly rows: number;
  readonly cols: number;
  readonly symbols: readonly (SymbolId | null)[][];
  readonly phases: readonly CellPhase[][];
  readonly reelStopped: readonly boolean[];
  readonly rollupValue: number | null;
  readonly mountedCells: readonly (readonly [number, number])[];
  readonly highlightedCells: readonly (readonly [number, number])[];
}

const DEFAULT_HIGHLIGHT_COLOR = 0xffe066;
const DEFAULT_HIGHLIGHT_WIDTH = 3;

export class SlotSceneView {
  readonly root: Container;
  private readonly cellsLayer: Container;
  private readonly overlay: Graphics;

  private readonly metrics: GridMetrics;
  private readonly cells: CellBinding[]; // rows*cols, row-major
  private readonly state: SlotSceneState;
  private readonly cursor: TimelineCursor;
  private readonly symbolResolver: SymbolResolver;
  private readonly callbacks: SlotSceneCallbacks;
  private readonly highlightColor: number;
  private readonly highlightWidth: number;

  private timeline: PresentationTimeline | null = null;
  private lastRollupValue: number | null = null;

  constructor(grid: GridConfig, options: SlotSceneViewOptions) {
    this.root = new Container();
    this.cellsLayer = new Container();
    this.overlay = new Graphics();
    this.root.addChild(this.cellsLayer, this.overlay);

    this.metrics = gridMetrics(grid);
    this.symbolResolver = options.symbolResolver;
    this.callbacks = options.callbacks ?? {};
    this.highlightColor = options.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
    this.highlightWidth = options.highlightWidth ?? DEFAULT_HIGHLIGHT_WIDTH;

    this.state = makeSlotSceneState(grid.rows, grid.cols);
    this.cursor = makeTimelineCursor();

    this.cells = [];
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const container = new Container();
        const center = cellCenter(this.metrics, row, col);
        container.position.set(center.x, center.y);
        this.cellsLayer.addChild(container);
        this.cells.push({
          container,
          row,
          col,
          view: null,
          symbol: null,
          phase: null,
          resolved: null,
          phaseStartMs: 0,
        });
      }
    }
  }

  // Load a spin's presentation timeline and reset the cursor + board to the start (a new spin replays from
  // time 0). The board display is cleared on the next update at time 0.
  setTimeline(timeline: PresentationTimeline): void {
    this.timeline = timeline;
    resetTimelineCursor(this.cursor);
    resetSlotSceneState(this.state);
    this.lastRollupValue = null;
  }

  // Advance the scene to `timeMs`: dispatch every not-yet-fired directive (board reducer + host callbacks),
  // then sync each cell's symbol skeleton and redraw the highlight overlay. A backward seek (timeMs below
  // the cursor) replays from the start: it resets the cursor + board, then re-advances, so the render is a
  // pure function of (timeline, timeMs). Steady forward advance allocates nothing in the reducer / cursor.
  update(timeMs: number): void {
    const timeline = this.timeline;
    if (timeline === null) return;

    if (timeMs < this.cursor.currentTimeMs) {
      resetTimelineCursor(this.cursor);
      resetSlotSceneState(this.state);
    }
    advanceTimelineTo(this.cursor, timeline, timeMs, (directive) => this.onFire(directive));

    this.syncCells(timeMs);
    this.emitRollup(timeMs);
    this.drawHighlights();
  }

  // A read-only snapshot of the current board and display state for tests / tooling.
  describe(): SlotSceneDescription {
    const symbols: (SymbolId | null)[][] = [];
    const phases: CellPhase[][] = [];
    const mountedCells: (readonly [number, number])[] = [];
    const highlightedCells: (readonly [number, number])[] = [];
    for (let row = 0; row < this.state.rows; row += 1) {
      const symRow: (SymbolId | null)[] = [];
      const phaseRow: CellPhase[] = [];
      for (let col = 0; col < this.state.cols; col += 1) {
        const idx = cellIndex(this.state, row, col);
        symRow.push(this.state.symbols[idx]!);
        phaseRow.push(this.state.phases[idx]!);
        const cell = this.cells[idx]!;
        if (cell.view !== null && cell.symbol !== null) mountedCells.push([row, col]);
        if (this.state.phases[idx] === 'win') highlightedCells.push([row, col]);
      }
      symbols.push(symRow);
      phases.push(phaseRow);
    }
    return {
      rows: this.state.rows,
      cols: this.state.cols,
      symbols,
      phases,
      reelStopped: [...this.state.reelStopped],
      rollupValue: this.currentRollupValue(this.cursor.currentTimeMs),
      mountedCells,
      highlightedCells,
    };
  }

  // Tear down every cell's SkeletonView and the container tree.
  destroy(): void {
    for (const cell of this.cells) cell.view?.destroy();
    this.root.destroy({ children: true });
  }

  // ---- internals ----

  // Fold a fired directive into the board and dispatch the event-out kinds to host callbacks. Callback
  // timestamps use the directive's own atMs (its deterministic scheduled time), not the frame clock, so a
  // vfx / banner fires at the same logical instant regardless of frame cadence.
  private onFire(directive: PresentationDirective): void {
    applyDirective(this.state, directive);
    const cb = this.callbacks;
    switch (directive.kind) {
      case 'vfxBurst': {
        const p = anchorToPixel(this.metrics, directive.anchor);
        cb.onVfxBurst?.(directive.preset, p.x, p.y, directive.atMs);
        break;
      }
      case 'multiplierOrb': {
        const p = anchorToPixel(this.metrics, directive.anchor);
        cb.onMultiplierOrb?.(directive.valueX, p.x, p.y, directive.atMs);
        break;
      }
      case 'escalation':
        cb.onEscalation?.(directive.tier, directive.atMs);
        break;
      case 'flowEnter':
        cb.onFlowEnter?.(directive.state, directive.atMs);
        break;
      case 'flowExit':
        cb.onFlowExit?.(directive.state, directive.atMs);
        break;
      default:
        break;
    }
  }

  // Mount / re-sync each cell's symbol skeleton to the current board state. A symbol change re-resolves and
  // rebinds the cell's SkeletonView; a phase change restarts the cell's local animation clock; every mounted
  // cell plays its phase animation at its own local loop time. An empty cell hides its view.
  private syncCells(timeMs: number): void {
    for (const cell of this.cells) {
      const idx = cellIndex(this.state, cell.row, cell.col);
      const symbol = this.state.symbols[idx]!;
      const phase = this.state.phases[idx]!;

      if (symbol === null) {
        if (cell.view !== null) cell.view.clear();
        cell.symbol = null;
        cell.phase = null;
        cell.resolved = null;
        continue;
      }

      if (symbol !== cell.symbol) {
        cell.resolved = this.symbolResolver(symbol);
        cell.symbol = symbol;
        cell.phase = null; // force a phase (re)start on a symbol change
        if (cell.resolved !== null) {
          if (cell.view === null) {
            cell.view = new SkeletonView();
            cell.container.addChild(cell.view.root);
          }
          cell.view.setTextureResolver(cell.resolved.textureResolver ?? null);
        }
      }

      const resolved = cell.resolved;
      if (resolved === null || cell.view === null) continue;

      if (phase !== cell.phase) {
        cell.phase = phase;
        cell.phaseStartMs = timeMs;
      }

      const animName = phaseAnimation(resolved.animSet, phase);
      const localElapsed = Math.max(0, timeMs - cell.phaseStartMs) / 1000;
      cell.view.syncAnimatedLoop(resolved.document, animName, localElapsed);
    }
  }

  private emitRollup(timeMs: number): void {
    const value = this.currentRollupValue(timeMs);
    if (value === null || value === this.lastRollupValue) return;
    this.lastRollupValue = value;
    this.callbacks.onRollup?.(value, timeMs);
  }

  private currentRollupValue(timeMs: number): number | null {
    const rollup = this.state.activeRollup;
    return rollup === null ? null : counterRollupDisplayValue(rollup, timeMs);
  }

  // Redraw the winning-cell highlight overlay: a box around each cell whose phase is 'win'. Cheap and
  // allocation-light (one Graphics rebuilt per frame); the win-line polyline geometry is not carried by the
  // directive union, so a per-winning-cell box is the highlight this renderer draws.
  private drawHighlights(): void {
    const g = this.overlay;
    g.clear();
    for (const cell of this.cells) {
      const idx = cellIndex(this.state, cell.row, cell.col);
      if (this.state.phases[idx] !== 'win') continue;
      const half = { w: this.metrics.cellWidth / 2, h: this.metrics.cellHeight / 2 };
      const center = cellCenter(this.metrics, cell.row, cell.col);
      g.rect(center.x - half.w, center.y - half.h, this.metrics.cellWidth, this.metrics.cellHeight);
    }
    g.stroke({ color: this.highlightColor, width: this.highlightWidth });
  }
}

// The animation name for a symbol phase (SymbolAnimSet). `anticipation` falls back to `win` when the set
// does not define a distinct anticipation animation (format-contract section 15.3).
function phaseAnimation(animSet: SymbolAnimSet, phase: CellPhase): string {
  switch (phase) {
    case 'idle':
      return animSet.idle;
    case 'land':
      return animSet.land;
    case 'win':
      return animSet.win;
    case 'anticipation':
      return animSet.anticipation ?? animSet.win;
  }
}

// Resolve a GridAnchor to grid-local pixels: a cell anchor to the cell center, a screen anchor to its
// absolute position (the host places the grid, so screen coordinates pass through).
function anchorToPixel(m: GridMetrics, anchor: GridAnchor): { x: number; y: number } {
  if (anchor.kind === 'cell') return cellCenter(m, anchor.row, anchor.col);
  return { x: anchor.x, y: anchor.y };
}
