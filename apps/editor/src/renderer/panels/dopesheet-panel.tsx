import type { IDockviewPanelProps } from 'dockview';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { documentHost, type AnimationEntity, type AnimationId, type KeyframeId } from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import {
  beginKeyframeDrag,
  copySelectionToClipboard,
  pasteClipboardAtPlayhead,
  updateKeyframeDrag,
  type KeyframeDrag,
} from '../dopesheet/keyframe-edit';
import { indexKeyframes } from '../dopesheet/keyframe-index';
import { hitTestKey, marqueeSelect, type LaidOutKey, type Rect } from '../dopesheet/selection';
import {
  clamp,
  frameOf,
  panViewByPixels,
  snapToFrame,
  timeToX,
  visibleTimeRange,
  xToTime,
  zoomXAround,
  type DopesheetView,
} from '../dopesheet/timeline-math';
import { loopEndpointsDiffer } from '../dopesheet/transport';
import { buildTracks, visibleRowRange, type TrackNames, type TrackRow } from '../dopesheet/tracks';

const LABEL_WIDTH = 184;
const ROW_HEIGHT = 22;
const RULER_HEIGHT = 22;
const DIAMOND_SIZE = 9;
const HIT_RADIUS = 7;
const DRAG_THRESHOLD = 3;
const ACCENT = '#5aa0ff';

// The minimum-viable dopesheet (WP-1.6). It derives tracks from the active animation (polling
// model.revision like the viewport, the editor/document wall keeps the document out of Zustand), renders
// virtualized keyframe diamonds, and routes every edit through a document-core command on the live
// History (LAW 2). Selection, playhead, transport, and view are ephemeral Zustand (playback-store); none
// of them is undoable. Playback advances the playhead from a monotonic clock only; making the viewport
// render the pose at the playhead is WP-1.10 (deferred).
export function DopesheetPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;

  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const setActiveAnimation = usePlaybackStore((state) => state.setActiveAnimation);
  const view = usePlaybackStore((state) => state.dopesheetView);
  const keySelection = usePlaybackStore((state) => state.keySelection);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const workingFps = usePlaybackStore((state) => state.workingFps);

  const animations = model.animations();

  const trackNames = useMemo<TrackNames>(
    () => ({
      boneName: (id) => model.getBone(id)?.name ?? String(id),
      slotName: (id) => model.getSlot(id)?.name ?? String(id),
    }),
    [model],
  );

  const rows = useMemo<TrackRow[]>(() => {
    if (activeAnimation === null) return [];
    const animation = model.getAnimation(activeAnimation);
    return animation ? buildTracks(animation, trackNames) : [];
  }, [activeAnimation, revision, model, trackNames]);

  const duration = useMemo(() => {
    if (activeAnimation === null) return 0;
    return model.getAnimation(activeAnimation)?.duration ?? 0;
  }, [activeAnimation, revision, model]);

  const advisory = useMemo(() => {
    if (activeAnimation === null) return false;
    const animation = model.getAnimation(activeAnimation);
    return animation ? loopEndpointsDiffer(animation) : false;
  }, [activeAnimation, revision, model]);

  // Keep the panel pointed at a live animation: default-select the first when none is active (the
  // animation-manager UI is WP-1.9), and re-select after a load swaps in a document with new ids.
  useEffect(() => {
    const current = activeAnimation;
    const stillValid = current !== null && model.getAnimation(current) !== undefined;
    if (stillValid) return;
    const first = model.animations()[0];
    const desired = first ? first.id : null;
    if (desired !== current) setActiveAnimation(desired);
  }, [revision, activeAnimation, model, setActiveAnimation]);

  // Prune selected keyframe ids that no longer resolve after an edit/undo (editor-state reconciliation,
  // section 6: lives here, never inside a command). Reads selection via getState so it is not a dep.
  useEffect(() => {
    if (activeAnimation === null) return;
    const animation = model.getAnimation(activeAnimation);
    if (animation === undefined) return;
    const index = indexKeyframes(animation);
    const current = usePlaybackStore.getState().keySelection;
    const valid = current.filter((id) => index.has(id));
    if (valid.length !== current.length) usePlaybackStore.getState().selectKeys(valid);
  }, [revision, activeAnimation, model]);

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = timelineRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bodyHeight = Math.max(0, size.height - RULER_HEIGHT);
  const rowRange = useMemo(
    () => visibleRowRange(view.scrollY, bodyHeight, ROW_HEIGHT, rows.length),
    [view.scrollY, bodyHeight, rows.length],
  );

  // Lay out the visible diamonds in timeline-local screen coordinates (origin at the timeline top-left,
  // below-ruler offset and vertical scroll already applied). Used for BOTH rendering and hit-testing, so
  // the two never disagree. Virtualized over the visible time window and the visible row range.
  const laidOutKeys = useMemo<LaidOutKey[]>(() => {
    const [tStart, tEnd] = visibleTimeRange(view, size.width);
    const [firstRow, lastRow] = rowRange;
    const keys: LaidOutKey[] = [];
    for (let r = firstRow; r < lastRow; r += 1) {
      const row = rows[r];
      if (row === undefined || row.kind !== 'channel') continue;
      const y = RULER_HEIGHT + r * ROW_HEIGHT + ROW_HEIGHT / 2 - view.scrollY;
      for (const kf of row.keyframes) {
        if (kf.time < tStart || kf.time > tEnd) continue;
        keys.push({ id: kf.id, x: timeToX(view, kf.time), y });
      }
    }
    return keys;
  }, [rows, rowRange, view, size.width]);

  const selectedSet = useMemo(() => new Set(keySelection), [keySelection]);

  const interactionRef = useRef<Interaction>({ kind: 'none' });
  const [marquee, setMarquee] = useState<Rect | null>(null);

  // The playback rAF loop: advance the playhead from real-clock deltas while playing. It only writes the
  // ephemeral playhead (never the document, never History). durationRef tracks the latest duration so the
  // loop need not restart when it changes.
  const durationRef = useRef(duration);
  durationRef.current = duration;
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    let last = performance.now();
    let disposed = false;
    const frame = (now: number): void => {
      if (disposed) return;
      usePlaybackStore.getState().tick((now - last) / 1000, durationRef.current);
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  // Close a dangling interaction session if the panel unmounts mid-drag, so History never stays batched.
  useEffect(
    () => () => {
      if (interactionRef.current.kind === 'drag') {
        documentHost.current().history.endInteraction('Move Keyframes');
      }
    },
    [],
  );

  function localPoint(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function scrubToX(x: number, disableSnap: boolean): void {
    const raw = clamp(xToTime(view, x), 0, duration);
    const snapped = disableSnap ? raw : snapToFrame(raw, workingFps, true);
    usePlaybackStore.getState().setPlayhead(clamp(snapped, 0, duration));
  }

  function applyDrag(startX: number, currentX: number, disableSnap: boolean): void {
    const interaction = interactionRef.current;
    if (interaction.kind !== 'drag' || activeAnimation === null) return;
    const deltaSeconds = xToTime(view, currentX) - xToTime(view, startX);
    updateKeyframeDrag(
      documentHost.current().history,
      interaction.drag,
      deltaSeconds,
      !disableSnap,
      workingFps,
      duration,
    );
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const { x, y } = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const store = usePlaybackStore.getState();

    if (y < RULER_HEIGHT) {
      interactionRef.current = { kind: 'scrub' };
      scrubToX(x, event.altKey);
      return;
    }

    const hit = hitTestKey(laidOutKeys, x, y, HIT_RADIUS);
    if (hit !== null) {
      if (event.shiftKey) {
        store.toggleKey(hit);
        interactionRef.current = { kind: 'none' };
      } else {
        if (!selectedSet.has(hit)) store.selectKeys([hit]);
        interactionRef.current = { kind: 'maybeDrag', startX: x, startY: y };
      }
      return;
    }

    const base = event.shiftKey ? store.keySelection : [];
    if (!event.shiftKey) store.clearKeySelection();
    interactionRef.current = {
      kind: 'marquee',
      startX: x,
      startY: y,
      base,
      additive: event.shiftKey,
    };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const interaction = interactionRef.current;
    if (interaction.kind === 'none') return;
    const { x, y } = localPoint(event);

    if (interaction.kind === 'scrub') {
      scrubToX(x, event.altKey);
      return;
    }

    if (interaction.kind === 'maybeDrag') {
      if (
        Math.abs(x - interaction.startX) < DRAG_THRESHOLD &&
        Math.abs(y - interaction.startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      const drag =
        activeAnimation !== null
          ? beginKeyframeDrag(
              documentHost.current().model,
              activeAnimation,
              usePlaybackStore.getState().keySelection,
            )
          : null;
      if (drag === null) {
        interactionRef.current = { kind: 'none' };
        return;
      }
      documentHost.current().history.beginInteraction();
      interactionRef.current = { kind: 'drag', startX: interaction.startX, drag };
      applyDrag(interaction.startX, x, event.altKey);
      return;
    }

    if (interaction.kind === 'drag') {
      applyDrag(interaction.startX, x, event.altKey);
      return;
    }

    const rect: Rect = { x0: interaction.startX, y0: interaction.startY, x1: x, y1: y };
    setMarquee(rect);
    const hits = marqueeSelect(laidOutKeys, rect, HIT_RADIUS);
    usePlaybackStore
      .getState()
      .selectKeys(interaction.additive ? unique([...interaction.base, ...hits]) : hits);
  }

  function endInteraction(event: ReactPointerEvent<HTMLDivElement>): void {
    const interaction = interactionRef.current;
    if (interaction.kind === 'drag') {
      documentHost.current().history.endInteraction('Move Keyframes');
    }
    if (interaction.kind === 'marquee') setMarquee(null);
    interactionRef.current = { kind: 'none' };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    const rect = timelineRef.current?.getBoundingClientRect();
    const anchorX = rect ? event.clientX - rect.left : 0;
    const store = usePlaybackStore.getState();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      store.setDopesheetView(zoomXAround(store.dopesheetView, anchorX, factor));
    } else {
      store.setDopesheetView(panViewByPixels(store.dopesheetView, event.deltaX, event.deltaY));
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!(event.metaKey || event.ctrlKey) || activeAnimation === null) return;
    const key = event.key.toLowerCase();
    const store = usePlaybackStore.getState();
    if (key === 'c') {
      const records = copySelectionToClipboard(
        documentHost.current().model,
        activeAnimation,
        store.keySelection,
      );
      if (records.length > 0) {
        store.setClipboard(records);
        event.preventDefault();
      }
    } else if (key === 'v') {
      pasteClipboardAtPlayhead(
        documentHost.current().history,
        activeAnimation,
        store.keyClipboard,
        store.playhead,
        duration,
      );
      event.preventDefault();
    }
  }

  const [firstRow, lastRow] = rowRange;
  const visibleRows: { index: number; row: TrackRow }[] = [];
  for (let r = firstRow; r < lastRow; r += 1) {
    const row = rows[r];
    if (row !== undefined) visibleRows.push({ index: r, row });
  }

  return (
    <div style={rootStyle} tabIndex={0} onKeyDown={onKeyDown}>
      <TransportBar animations={animations} activeAnimation={activeAnimation} advisory={advisory} />
      <div style={bodyRowStyle}>
        <div style={labelColumnStyle}>
          <div style={{ transform: `translateY(${-view.scrollY}px)` }}>
            <div style={{ height: RULER_HEIGHT }} />
            {rows.map((row) => (
              <div key={row.key} style={labelRowStyle(row.kind === 'group')}>
                {row.label}
              </div>
            ))}
          </div>
        </div>
        <div
          ref={timelineRef}
          style={timelineStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
          onWheel={onWheel}
        >
          <div style={rulerStyle} />
          {visibleRows.map(({ index, row }) => (
            <div
              key={row.key}
              style={laneStyle(
                RULER_HEIGHT + index * ROW_HEIGHT - view.scrollY,
                row.kind === 'group',
              )}
            />
          ))}
          {laidOutKeys.map((key) => (
            <div key={key.id} style={diamondStyle(key.x, key.y, selectedSet.has(key.id))} />
          ))}
          <PlayheadLine view={view} height={size.height} />
          {marquee && <div style={marqueeStyle(marquee)} />}
          {activeAnimation !== null && rows.length === 0 && (
            <div style={emptyHintStyle}>
              No keyframes yet. Author one in animation mode (WP-1.8).
            </div>
          )}
          {activeAnimation === null && (
            <div style={emptyHintStyle}>No animation. Create one to author keyframes (WP-1.9).</div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TransportBarProps {
  readonly animations: readonly AnimationEntity[];
  readonly activeAnimation: AnimationId | null;
  readonly advisory: boolean;
}

function TransportBar({ animations, activeAnimation, advisory }: TransportBarProps): ReactElement {
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const loop = usePlaybackStore((state) => state.loop);
  const workingFps = usePlaybackStore((state) => state.workingFps);
  const setActiveAnimation = usePlaybackStore((state) => state.setActiveAnimation);
  const setLoop = usePlaybackStore((state) => state.setLoop);
  const setWorkingFps = usePlaybackStore((state) => state.setWorkingFps);

  const togglePlay = (): void => {
    const store = usePlaybackStore.getState();
    if (store.isPlaying) store.pause();
    else store.play();
  };

  return (
    <div style={transportStyle}>
      <button
        type="button"
        style={buttonStyle}
        onClick={togglePlay}
        disabled={animations.length === 0}
      >
        {isPlaying ? 'Pause' : 'Play'}
      </button>
      <button
        type="button"
        style={{ ...buttonStyle, ...(loop ? buttonActiveStyle : null) }}
        onClick={() => setLoop(!loop)}
      >
        Loop
      </button>
      <select
        style={selectStyle}
        value={activeAnimation ?? ''}
        onChange={(event) =>
          setActiveAnimation(event.target.value === '' ? null : (event.target.value as AnimationId))
        }
      >
        {animations.length === 0 && <option value="">(no animations)</option>}
        {animations.map((animation) => (
          <option key={animation.id} value={animation.id}>
            {animation.name}
          </option>
        ))}
      </select>
      <select
        style={selectStyle}
        value={workingFps}
        onChange={(event) => setWorkingFps(Number(event.target.value) === 60 ? 60 : 30)}
      >
        <option value={30}>30 fps</option>
        <option value={60}>60 fps</option>
      </select>
      <FrameReadout />
      {advisory && <span style={advisoryStyle}>loop endpoints differ</span>}
    </div>
  );
}

const FrameReadout = memo(function FrameReadout(): ReactElement {
  const playhead = usePlaybackStore((state) => state.playhead);
  const fps = usePlaybackStore((state) => state.workingFps);
  return (
    <span style={readoutStyle}>{`frame ${frameOf(playhead, fps)} / ${playhead.toFixed(3)} s`}</span>
  );
});

const PlayheadLine = memo(function PlayheadLine({
  view,
  height,
}: {
  readonly view: DopesheetView;
  readonly height: number;
}): ReactElement {
  const playhead = usePlaybackStore((state) => state.playhead);
  return <div style={playheadStyle(timeToX(view, playhead), height)} />;
});

// Poll the live document's revision once per frame (the editor/document wall keeps the document out of
// Zustand). Re-renders only when the revision actually changes, so an idle document costs no churn.
function useDocumentRevision(): number {
  const [revision, setRevision] = useState(() => documentHost.current().model.revision);
  useEffect(() => {
    let raf = 0;
    let disposed = false;
    const poll = (): void => {
      if (disposed) return;
      const current = documentHost.current().model.revision;
      setRevision((prev) => (prev === current ? prev : current));
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);
  return revision;
}

function unique(ids: readonly KeyframeId[]): KeyframeId[] {
  return [...new Set(ids)];
}

type Interaction =
  | { readonly kind: 'none' }
  | { readonly kind: 'scrub' }
  | { readonly kind: 'maybeDrag'; readonly startX: number; readonly startY: number }
  | { readonly kind: 'drag'; readonly startX: number; readonly drag: KeyframeDrag }
  | {
      readonly kind: 'marquee';
      readonly startX: number;
      readonly startY: number;
      readonly base: readonly KeyframeId[];
      readonly additive: boolean;
    };

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
  outline: 'none',
};

const transportStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const bodyRowStyle: CSSProperties = { display: 'flex', flex: '1 1 auto', minHeight: 0 };

const labelColumnStyle: CSSProperties = {
  width: LABEL_WIDTH,
  flex: '0 0 auto',
  overflow: 'hidden',
  borderRight: '1px solid #333333',
};

const timelineStyle: CSSProperties = {
  position: 'relative',
  flex: '1 1 auto',
  overflow: 'hidden',
  touchAction: 'none',
  cursor: 'crosshair',
};

const rulerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: RULER_HEIGHT,
  background: '#252525',
  borderBottom: '1px solid #333333',
  pointerEvents: 'none',
};

function labelRowStyle(isGroup: boolean): CSSProperties {
  return {
    height: ROW_HEIGHT,
    lineHeight: `${ROW_HEIGHT}px`,
    padding: isGroup ? '0 8px' : '0 8px 0 22px',
    fontWeight: isGroup ? 600 : 400,
    color: isGroup ? '#eeeeee' : '#bbbbbb',
    background: isGroup ? '#222222' : 'transparent',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

function laneStyle(top: number, isGroup: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    top,
    height: ROW_HEIGHT,
    borderBottom: '1px solid #262626',
    background: isGroup ? '#202020' : 'transparent',
    pointerEvents: 'none',
  };
}

function diamondStyle(x: number, y: number, selected: boolean): CSSProperties {
  return {
    position: 'absolute',
    left: x - DIAMOND_SIZE / 2,
    top: y - DIAMOND_SIZE / 2,
    width: DIAMOND_SIZE,
    height: DIAMOND_SIZE,
    transform: 'rotate(45deg)',
    background: selected ? ACCENT : '#c8c8c8',
    border: selected ? '1px solid #ffffff' : '1px solid #6a6a6a',
    pointerEvents: 'none',
  };
}

function playheadStyle(x: number, height: number): CSSProperties {
  return {
    position: 'absolute',
    left: x,
    top: 0,
    width: 1,
    height,
    background: '#ff5d5d',
    pointerEvents: 'none',
  };
}

function marqueeStyle(rect: Rect): CSSProperties {
  return {
    position: 'absolute',
    left: Math.min(rect.x0, rect.x1),
    top: Math.min(rect.y0, rect.y1),
    width: Math.abs(rect.x1 - rect.x0),
    height: Math.abs(rect.y1 - rect.y0),
    border: `1px solid ${ACCENT}`,
    background: 'rgba(90, 160, 255, 0.15)',
    pointerEvents: 'none',
  };
}

const emptyHintStyle: CSSProperties = {
  position: 'absolute',
  top: RULER_HEIGHT + 12,
  left: 12,
  color: '#777777',
  pointerEvents: 'none',
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
  borderColor: ACCENT,
  color: '#ffffff',
};

const selectStyle: CSSProperties = {
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  padding: '3px 6px',
};

const readoutStyle: CSSProperties = { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' };

const advisoryStyle: CSSProperties = { color: '#e0a93b' };
