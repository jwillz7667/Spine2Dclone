import type { IDockviewPanelProps } from 'dockview';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { documentHost, SetCurveCommand, type KeyframeId } from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  buildValueLanes,
  laneTimeExtent,
  laneValueExtent,
  type ValueLane,
} from '../dopesheet/value-graph-channels';
import { beginValueDrag, updateValueDrag, type ValueDrag } from '../dopesheet/value-graph-edit';
import {
  frameTimeView,
  frameValueView,
  handleToValueSpace,
  hitTestGraphKey,
  hitTestHandle,
  keyToPixel,
  laneSegmentHandles,
  panValueViewByPixels,
  pixelToHandlePoint,
  sampleLaneValueSpace,
  valueSpaceToHandle,
  valueToY,
  zoomValueViewAround,
  type BezierCurve,
  type BezierHandle,
  type ValueSegment,
  type ValueView,
} from '../dopesheet/value-graph-math';
import { panViewByPixels, timeToX, xToTime, zoomXAround } from '../dopesheet/timeline-math';
import type { TrackNames } from '../dopesheet/tracks';

// The value-vs-time graph editor (PP-D3): each animated value channel drawn as its keyframed VALUE curve
// against time, unlike the curve editor's normalized 0..1 easing square. It shares the dopesheet's horizontal
// time view and key selection (playback-store) so the two panels pan and select together, and owns the
// vertical value view locally. Every edit routes through a document-core command on the live History (LAW 2):
// a key dot drags in BOTH axes via the value-graph key-drag wiring (MoveKeyframe + SetKeyframe, one undo), and
// a bezier handle drags in value space via SetCurve (the value<->normalized mapping is unit-tested and
// round-trips). Multi-channel overlay with per-lane color and visibility, plus fit/zoom framing.

const PAD = 18;
const HIT_RADIUS = 8;
const HANDLE_RADIUS = 9;
const DRAG_THRESHOLD = 3;
const DOT_SIZE = 8;
const SAMPLES_PER_SEGMENT = 24;
const FIT_MARGIN = 0.12;
const ACCENT = '#5aa0ff';

type Interaction =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'maybeDrag';
      readonly laneKey: string;
      readonly startX: number;
      readonly startY: number;
    }
  | {
      readonly kind: 'keyDrag';
      readonly drag: ValueDrag;
      readonly startX: number;
      readonly startY: number;
    }
  | {
      readonly kind: 'handleDrag';
      readonly target: ValueLane['target'];
      readonly keyframeId: KeyframeId;
      readonly handle: BezierHandle;
      readonly seg: ValueSegment;
      readonly startCurve: BezierCurve;
    };

export function ValueGraphPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const keySelection = usePlaybackStore((state) => state.keySelection);
  const view = usePlaybackStore((state) => state.dopesheetView);
  const workingFps = usePlaybackStore((state) => state.workingFps);

  const trackNames = useMemo<TrackNames>(
    () => ({
      boneName: (id) => model.getBone(id)?.name ?? String(id),
      slotName: (id) => model.getSlot(id)?.name ?? String(id),
      ikName: (id) => model.getIkConstraint(id)?.name ?? String(id),
      transformName: (id) => model.getTransformConstraint(id)?.name ?? String(id),
      pathName: (id) => model.getPathConstraint(id)?.name ?? String(id),
      physicsName: (id) => model.getPhysicsConstraint(id)?.name ?? String(id),
      skinName: (key) =>
        key === 'default' ? 'default' : (model.getSkin(key)?.name ?? String(key)),
    }),
    [model],
  );

  const lanes = useMemo<ValueLane[]>(() => {
    if (activeAnimation === null) return [];
    const animation = model.getAnimation(activeAnimation);
    return animation ? buildValueLanes(animation, trackNames) : [];
  }, [activeAnimation, revision, model, trackNames]);

  const duration = useMemo(() => {
    if (activeAnimation === null) return 0;
    return model.getAnimation(activeAnimation)?.duration ?? 0;
  }, [activeAnimation, revision, model]);

  // Per-lane visibility is stored as the HIDDEN set, so a newly authored lane is visible by default (a fresh
  // key never needs an explicit opt-in). Ephemeral panel state, never the document.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const visibleLanes = useMemo(
    () => lanes.filter((lane) => !hidden.has(lane.key)),
    [lanes, hidden],
  );
  const visibleKeys = useMemo(() => new Set(visibleLanes.map((l) => l.key)), [visibleLanes]);

  // Only the value axis is local; the time axis is the shared dopesheet view. valueRange holds vMin/vMax and
  // the plot size supplies heightPx/padPx, so a resize never desyncs the transform from the drawn pixels.
  const [valueRange, setValueRange] = useState<{ vMin: number; vMax: number }>({
    vMin: -1,
    vMax: 1,
  });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const plotRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = plotRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const valueView: ValueView = {
    vMin: valueRange.vMin,
    vMax: valueRange.vMax,
    heightPx: size.height,
    padPx: PAD,
  };

  // The lane whose selected-key handles are shown. Set when a dot is clicked; reconciled to a visible lane
  // that carries the single selected key when selection changes elsewhere (the dopesheet shares keySelection).
  const [activeLaneKey, setActiveLaneKey] = useState<string | null>(null);
  const selectedKeyId = keySelection.length === 1 ? (keySelection[0] ?? null) : null;
  const activeLane = useMemo<ValueLane | null>(() => {
    if (selectedKeyId === null) return null;
    const onActive = visibleLanes.find(
      (lane) => lane.key === activeLaneKey && lane.keys.some((k) => k.id === selectedKeyId),
    );
    if (onActive) return onActive;
    return visibleLanes.find((lane) => lane.keys.some((k) => k.id === selectedKeyId)) ?? null;
  }, [visibleLanes, activeLaneKey, selectedKeyId]);

  const interactionRef = useRef<Interaction>({ kind: 'none' });

  // Close a dangling session if the panel unmounts mid-drag, so History never stays batched.
  useEffect(
    () => () => {
      const kind = interactionRef.current.kind;
      if (kind === 'keyDrag') documentHost.current().history.endInteraction('Edit Value');
      else if (kind === 'handleDrag') documentHost.current().history.endInteraction('Set Curve');
    },
    [],
  );

  function localPoint(event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function fit(): void {
    const source = visibleLanes.length > 0 ? visibleLanes : lanes;
    const valueExtent = laneValueExtent(source);
    const framed = frameValueView(valueExtent, size.height, PAD, FIT_MARGIN);
    setValueRange({ vMin: framed.vMin, vMax: framed.vMax });
    if (size.width > 0) {
      const { scrollX, zoomX } = frameTimeView(laneTimeExtent(source), size.width, FIT_MARGIN);
      usePlaybackStore.getState().setDopesheetView({ scrollX, zoomX, scrollY: view.scrollY });
    }
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0 || activeAnimation === null) return;
    const { x, y } = localPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    // A handle of the active selected key wins over a key dot, so grabbing a handle near its dot edits the
    // curve rather than re-selecting the key.
    if (activeLane !== null && selectedKeyId !== null) {
      const index = activeLane.keys.findIndex((k) => k.id === selectedKeyId);
      const handles = index >= 0 ? laneSegmentHandles(activeLane, index) : null;
      if (handles !== null) {
        const hit = hitTestHandle(handles.seg, handles.curve, view, valueView, x, y, HANDLE_RADIUS);
        if (hit !== null) {
          documentHost.current().history.beginInteraction();
          interactionRef.current = {
            kind: 'handleDrag',
            target: activeLane.target,
            keyframeId: selectedKeyId,
            handle: hit,
            seg: handles.seg,
            startCurve: handles.curve,
          };
          return;
        }
      }
    }

    const hit = hitTestGraphKey(lanes, visibleKeys, view, valueView, x, y, HIT_RADIUS);
    const store = usePlaybackStore.getState();
    if (hit !== null) {
      setActiveLaneKey(hit.laneKey);
      if (event.shiftKey) {
        store.toggleKey(hit.keyframeId);
        interactionRef.current = { kind: 'none' };
      } else {
        if (!keySelection.includes(hit.keyframeId)) store.selectKeys([hit.keyframeId]);
        interactionRef.current = { kind: 'maybeDrag', laneKey: hit.laneKey, startX: x, startY: y };
      }
      return;
    }

    if (!event.shiftKey) store.clearKeySelection();
    interactionRef.current = { kind: 'none' };
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const interaction = interactionRef.current;
    if (interaction.kind === 'none' || activeAnimation === null) return;
    const { x, y } = localPoint(event);
    const history = documentHost.current().history;

    if (interaction.kind === 'handleDrag') {
      const point = pixelToHandlePoint(view, valueView, x, y);
      const next = valueSpaceToHandle(
        interaction.seg,
        interaction.startCurve,
        interaction.handle,
        point,
      );
      history.execute(
        new SetCurveCommand(activeAnimation, interaction.target, interaction.keyframeId, next),
      );
      return;
    }

    if (interaction.kind === 'maybeDrag') {
      if (
        Math.abs(x - interaction.startX) < DRAG_THRESHOLD &&
        Math.abs(y - interaction.startY) < DRAG_THRESHOLD
      ) {
        return;
      }
      const lane = lanes.find((l) => l.key === interaction.laneKey);
      const keyId = selectedKeyId;
      const drag =
        lane !== undefined && keyId !== null
          ? beginValueDrag(model, activeAnimation, lane.target, lane.field, keyId)
          : null;
      if (drag === null) {
        interactionRef.current = { kind: 'none' };
        return;
      }
      history.beginInteraction();
      interactionRef.current = {
        kind: 'keyDrag',
        drag,
        startX: interaction.startX,
        startY: interaction.startY,
      };
      applyKeyDrag(drag, interaction.startX, interaction.startY, x, y, event.altKey);
      return;
    }

    applyKeyDrag(interaction.drag, interaction.startX, interaction.startY, x, y, event.altKey);
  }

  function applyKeyDrag(
    drag: ValueDrag,
    startX: number,
    startY: number,
    curX: number,
    curY: number,
    disableSnap: boolean,
  ): void {
    if (activeAnimation === null) return;
    const deltaTime = xToTime(view, curX) - xToTime(view, startX);
    const deltaScalar = valueToYInverseDelta(startY, curY);
    updateValueDrag(
      documentHost.current().history,
      model,
      drag,
      deltaTime,
      deltaScalar,
      !disableSnap,
      workingFps,
      duration,
    );
  }

  // The value delta of a vertical drag: the value at curY minus the value at startY (screen up is a larger
  // value, so a drag upward raises the keyed value).
  function valueToYInverseDelta(startY: number, curY: number): number {
    const span = valueView.vMax - valueView.vMin;
    const plot = Math.max(1, valueView.heightPx - 2 * valueView.padPx);
    return ((startY - curY) / plot) * span;
  }

  function endInteraction(event: ReactPointerEvent<SVGSVGElement>): void {
    const kind = interactionRef.current.kind;
    if (kind === 'keyDrag') documentHost.current().history.endInteraction('Edit Value');
    else if (kind === 'handleDrag') documentHost.current().history.endInteraction('Set Curve');
    interactionRef.current = { kind: 'none' };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: ReactWheelEvent<SVGSVGElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const store = usePlaybackStore.getState();
    if (event.ctrlKey || event.metaKey) {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      store.setDopesheetView(zoomXAround(store.dopesheetView, anchorX, factor));
    } else if (event.altKey) {
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoomed = zoomValueViewAround(valueView, anchorY, factor);
      setValueRange({ vMin: zoomed.vMin, vMax: zoomed.vMax });
    } else {
      store.setDopesheetView(panViewByPixels(store.dopesheetView, event.deltaX, 0));
      const panned = panValueViewByPixels(valueView, event.deltaY);
      setValueRange({ vMin: panned.vMin, vMax: panned.vMax });
    }
  }

  const selectedSet = useMemo(() => new Set(keySelection), [keySelection]);
  const playhead = usePlaybackStore((state) => state.playhead);

  const gridLines = useMemo(
    () => valueGridLines(valueView),
    [valueView.vMin, valueView.vMax, size.height],
  );

  const emptyMessage =
    activeAnimation === null ? 'No animation. Create one to author keyframes.' : null;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={fit} disabled={lanes.length === 0}>
          Fit
        </button>
        <span style={hintStyle}>Drag dots in time and value; grab a bezier handle to ease.</span>
      </div>
      <div style={bodyRowStyle}>
        <Legend
          lanes={lanes}
          hidden={hidden}
          onToggle={(key) => setHidden(toggleSet(hidden, key))}
        />
        <div ref={plotRef} style={plotContainerStyle}>
          <svg
            width={size.width}
            height={size.height}
            style={svgStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            onWheel={onWheel}
          >
            {gridLines.map((line) => (
              <g key={line.value}>
                <line
                  x1={0}
                  y1={line.y}
                  x2={size.width}
                  y2={line.y}
                  stroke={line.isZero ? '#3a3a3a' : '#262626'}
                />
                <text x={4} y={line.y - 2} fill="#666666" fontSize={9}>
                  {line.label}
                </text>
              </g>
            ))}
            {visibleLanes.map((lane) => (
              <polyline
                key={lane.key}
                points={laneToPolyline(lane, view, valueView)}
                fill="none"
                stroke={colorHex(lane.color)}
                strokeWidth={1.5}
                opacity={0.9}
              />
            ))}
            {visibleLanes.flatMap((lane) =>
              lane.keys.map((key) => {
                const p = keyToPixel(view, valueView, key);
                const selected = selectedSet.has(key.id);
                return (
                  <rect
                    key={`${lane.key}:${key.id}`}
                    x={p.x - DOT_SIZE / 2}
                    y={p.y - DOT_SIZE / 2}
                    width={DOT_SIZE}
                    height={DOT_SIZE}
                    transform={`rotate(45 ${p.x} ${p.y})`}
                    fill={selected ? '#ffffff' : colorHex(lane.color)}
                    stroke={selected ? ACCENT : '#1b1b1b'}
                    strokeWidth={selected ? 2 : 1}
                  />
                );
              }),
            )}
            <SelectedHandles
              lane={activeLane}
              selectedKeyId={selectedKeyId}
              timeView={view}
              valueView={valueView}
            />
            <line
              x1={timeToX(view, playhead)}
              y1={0}
              x2={timeToX(view, playhead)}
              y2={size.height}
              stroke="#ff5d5d"
              strokeWidth={1}
              pointerEvents="none"
            />
            {emptyMessage !== null && (
              <text x={12} y={22} fill="#777777" fontSize={12}>
                {emptyMessage}
              </text>
            )}
            {emptyMessage === null && lanes.length === 0 && (
              <text x={12} y={22} fill="#777777" fontSize={12}>
                No animated value channels. Key a bone or slot in animation mode.
              </text>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

interface SelectedHandlesProps {
  readonly lane: ValueLane | null;
  readonly selectedKeyId: KeyframeId | null;
  readonly timeView: Parameters<typeof timeToX>[0];
  readonly valueView: ValueView;
}

// The two value-space bezier handles of the single selected key, with their tangent lines. Rendered only for
// a bezier outgoing segment on the active lane; nothing otherwise.
function SelectedHandles({
  lane,
  selectedKeyId,
  timeView,
  valueView,
}: SelectedHandlesProps): ReactElement | null {
  if (lane === null || selectedKeyId === null) return null;
  const index = lane.keys.findIndex((k) => k.id === selectedKeyId);
  if (index < 0) return null;
  const handles = laneSegmentHandles(lane, index);
  if (handles === null) return null;

  const a = lane.keys[index]!;
  const b = lane.keys[index + 1]!;
  const ax = timeToX(timeView, a.time);
  const ay = valueToY(valueView, a.value);
  const bx = timeToX(timeView, b.time);
  const by = valueToY(valueView, b.value);
  const p1 = handleToValueSpace(handles.seg, handles.curve, 'p1');
  const p2 = handleToValueSpace(handles.seg, handles.curve, 'p2');
  const p1x = timeToX(timeView, p1.time);
  const p1y = valueToY(valueView, p1.value);
  const p2x = timeToX(timeView, p2.time);
  const p2y = valueToY(valueView, p2.value);

  return (
    <g pointerEvents="none">
      <line x1={ax} y1={ay} x2={p1x} y2={p1y} stroke="#6a6a6a" />
      <line x1={bx} y1={by} x2={p2x} y2={p2y} stroke="#6a6a6a" />
      <circle cx={p1x} cy={p1y} r={5} fill={ACCENT} />
      <circle cx={p2x} cy={p2y} r={5} fill="#ffb35a" />
    </g>
  );
}

interface LegendProps {
  readonly lanes: readonly ValueLane[];
  readonly hidden: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

function Legend({ lanes, hidden, onToggle }: LegendProps): ReactElement {
  return (
    <div style={legendStyle}>
      {lanes.length === 0 && <div style={legendEmptyStyle}>No channels</div>}
      {groupLanes(lanes).map((group) => (
        <div key={group.name}>
          <div style={legendGroupStyle}>{group.name}</div>
          {group.lanes.map((lane) => {
            const isHidden = hidden.has(lane.key);
            return (
              <button
                key={lane.key}
                type="button"
                style={{ ...legendChipStyle, opacity: isHidden ? 0.4 : 1 }}
                onClick={() => onToggle(lane.key)}
                title={isHidden ? 'Show channel' : 'Hide channel'}
              >
                <span style={{ ...swatchStyle, background: colorHex(lane.color) }} />
                {lane.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function groupLanes(lanes: readonly ValueLane[]): { name: string; lanes: ValueLane[] }[] {
  const groups: { name: string; lanes: ValueLane[] }[] = [];
  for (const lane of lanes) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === lane.group) last.lanes.push(lane);
    else groups.push({ name: lane.group, lanes: [lane] });
  }
  return groups;
}

function laneToPolyline(
  lane: ValueLane,
  timeView: Parameters<typeof timeToX>[0],
  valueView: ValueView,
): string {
  return sampleLaneValueSpace(lane, SAMPLES_PER_SEGMENT)
    .map((p) => `${timeToX(timeView, p.time)},${valueToY(valueView, p.value)}`)
    .join(' ');
}

interface GridLine {
  readonly value: number;
  readonly y: number;
  readonly label: string;
  readonly isZero: boolean;
}

// A handful of evenly spaced horizontal value gridlines with labels, plus an emphasized zero line when it is
// in range. Purely visual; the count is fixed so the panel does not thrash on resize.
function valueGridLines(view: ValueView): GridLine[] {
  const lines: GridLine[] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i += 1) {
    const value = view.vMin + ((view.vMax - view.vMin) * i) / steps;
    lines.push({ value, y: valueToY(view, value), label: value.toFixed(2), isZero: false });
  }
  if (view.vMin < 0 && view.vMax > 0) {
    lines.push({ value: 0, y: valueToY(view, 0), label: '0.00', isZero: true });
  }
  return lines;
}

function toggleSet(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function colorHex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const bodyRowStyle: CSSProperties = { display: 'flex', flex: '1 1 auto', minHeight: 0 };

const legendStyle: CSSProperties = {
  width: 168,
  flex: '0 0 auto',
  overflow: 'auto',
  borderRight: '1px solid #333333',
  padding: '4px 0',
};

const legendEmptyStyle: CSSProperties = { color: '#777777', padding: '4px 8px' };

const legendGroupStyle: CSSProperties = {
  padding: '4px 8px 2px',
  color: '#eeeeee',
  fontWeight: 600,
  background: '#222222',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const legendChipStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '3px 8px 3px 16px',
  background: 'transparent',
  border: 'none',
  color: '#cccccc',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
};

const swatchStyle: CSSProperties = { width: 10, height: 10, borderRadius: 2, flex: '0 0 auto' };

const plotContainerStyle: CSSProperties = { position: 'relative', flex: '1 1 auto', minWidth: 0 };

const svgStyle: CSSProperties = { display: 'block', touchAction: 'none', cursor: 'crosshair' };

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const hintStyle: CSSProperties = { color: '#777777' };
