import type { IDockviewPanelProps } from 'dockview';
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { CurveType } from '@marionette/format/types';
import { documentHost, SetCurveCommand } from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  CURVE_PRESETS,
  IDENTITY_BEZIER,
  withHandle,
  setKeyframeCurve,
  type BezierCurve,
  type BezierHandle,
} from '../dopesheet/curve-edit';
import { sampleCurve } from '../dopesheet/curve-preview';
import { indexKeyframes, type ResolvedKeyframe } from '../dopesheet/keyframe-index';

// The curve editor panel (WP-1.7): per-keyframe easing authoring (linear / stepped / bezier + presets)
// that matches runtime-core evaluation exactly. It reads the SINGLE selected keyframe via the dopesheet's
// keyframe index + keySelection (editor state), and writes SetCurve through the live History (LAW 2). The
// bezier preview samples through the shared runtime-core sampler (sampleCurve), so what the animator sees
// equals what sampleSkeleton plays (R1.2). Multiple or zero selection shows a disabled empty state.

const SVG_SIZE = 240;
const PAD = 26;
const PLOT = SVG_SIZE - 2 * PAD;
// y is shown over [-1/3, 4/3] so the unit box (0..1) sits in the middle 60% and bezier overshoot is
// visible above/below it. x is the easing input over [0, 1].
const Y_MIN = -1 / 3;
const Y_MAX = 4 / 3;
const Y_SPAN = Y_MAX - Y_MIN;
const HANDLE_GRAB_RADIUS = 16;
const PREVIEW_SAMPLES = 48;
const ACCENT = '#5aa0ff';

function nxToPx(nx: number): number {
  return PAD + nx * PLOT;
}
function nyToPy(ny: number): number {
  return PAD + ((Y_MAX - ny) / Y_SPAN) * PLOT;
}
function pxToNx(px: number): number {
  return (px - PAD) / PLOT;
}
function pyToNy(py: number): number {
  return Y_MAX - ((py - PAD) / PLOT) * Y_SPAN;
}

type CurveKind = 'linear' | 'stepped' | 'bezier';

function kindOf(curve: CurveType): CurveKind {
  if (curve === 'linear') return 'linear';
  if (curve === 'stepped') return 'stepped';
  return 'bezier';
}

interface DragState {
  readonly handle: BezierHandle;
  readonly startCurve: BezierCurve;
}

export function CurveEditorPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const keySelection = usePlaybackStore((state) => state.keySelection);

  // Resolve the SINGLE selected keyframe to its target + current curve. Re-resolved on every document
  // revision so an undo/redo or a coalesced drag keeps the editor pointed at the live curve.
  const resolved = useMemo<ResolvedKeyframe | null>(() => {
    if (activeAnimation === null || keySelection.length !== 1) return null;
    const id = keySelection[0];
    if (id === undefined) return null;
    const animation = model.getAnimation(activeAnimation);
    if (animation === undefined) return null;
    return indexKeyframes(animation).get(id) ?? null;
  }, [activeAnimation, keySelection, revision, model]);

  const dragRef = useRef<DragState | null>(null);

  // Close a dangling SetCurve session if the panel unmounts mid-drag, so History never stays batched.
  useEffect(
    () => () => {
      if (dragRef.current !== null) {
        documentHost.current().history.endInteraction('Set Curve');
        dragRef.current = null;
      }
    },
    [],
  );

  function applyDiscreteCurve(next: CurveType): void {
    if (resolved === null || activeAnimation === null) return;
    setKeyframeCurve(
      documentHost.current().history,
      activeAnimation,
      resolved.target,
      resolved.id,
      next,
    );
  }

  if (resolved === null) {
    return (
      <div style={rootStyle}>
        <div style={emptyStyle}>{emptyMessage(activeAnimation, keySelection.length)}</div>
      </div>
    );
  }

  const curve = resolved.curve;
  const kind = kindOf(curve);
  const bezier: BezierCurve | null = typeof curve === 'object' ? curve : null;
  const preview = sampleCurve(curve, PREVIEW_SAMPLES);
  const polyline = preview.map((p) => `${nxToPx(p.x)},${nyToPy(p.y)}`).join(' ');

  // Switch the curve TYPE. Clicking the already-active type is inert (no empty undo step); switching to
  // bezier from linear/stepped starts at the identity easing and preserves an existing bezier's handles.
  function selectKind(target: CurveKind): void {
    if (kind === target) return;
    if (target === 'linear') applyDiscreteCurve('linear');
    else if (target === 'stepped') applyDiscreteCurve('stepped');
    else applyDiscreteCurve(bezier ?? IDENTITY_BEZIER);
  }

  function localPoint(event: ReactPointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function nearestHandle(px: number, py: number, b: BezierCurve): BezierHandle | null {
    const d1 = Math.hypot(px - nxToPx(b.cx1), py - nyToPy(b.cy1));
    const d2 = Math.hypot(px - nxToPx(b.cx2), py - nyToPy(b.cy2));
    const nearest = d1 <= d2 ? 'p1' : 'p2';
    const distance = Math.min(d1, d2);
    return distance <= HANDLE_GRAB_RADIUS ? nearest : null;
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.button !== 0 || bezier === null) return;
    const { x, y } = localPoint(event);
    const handle = nearestHandle(x, y, bezier);
    if (handle === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    documentHost.current().history.beginInteraction();
    dragRef.current = { handle, startCurve: bezier };
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    const drag = dragRef.current;
    if (drag === null || resolved === null || activeAnimation === null) return;
    const { x, y } = localPoint(event);
    const next = withHandle(drag.startCurve, drag.handle, pxToNx(x), pyToNy(y));
    documentHost
      .current()
      .history.execute(new SetCurveCommand(activeAnimation, resolved.target, resolved.id, next));
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>): void {
    if (dragRef.current === null) return;
    documentHost.current().history.endInteraction('Set Curve');
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div style={rootStyle}>
      <div style={sectionLabelStyle}>Easing</div>
      <div style={rowStyle}>
        <TypeButton
          label="Linear"
          active={kind === 'linear'}
          onClick={() => selectKind('linear')}
        />
        <TypeButton
          label="Stepped"
          active={kind === 'stepped'}
          onClick={() => selectKind('stepped')}
        />
        <TypeButton
          label="Bezier"
          active={kind === 'bezier'}
          onClick={() => selectKind('bezier')}
        />
      </div>

      <div style={sectionLabelStyle}>Presets</div>
      <div style={rowStyle}>
        {CURVE_PRESETS.map((preset) => (
          <TypeButton
            key={preset.id}
            label={preset.label}
            active={false}
            onClick={() => applyDiscreteCurve(preset.curve)}
          />
        ))}
      </div>

      <svg
        width={SVG_SIZE}
        height={SVG_SIZE}
        style={svgStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <rect x={0} y={0} width={SVG_SIZE} height={SVG_SIZE} fill="#161616" />
        <rect
          x={nxToPx(0)}
          y={nyToPy(1)}
          width={nxToPx(1) - nxToPx(0)}
          height={nyToPy(0) - nyToPy(1)}
          fill="none"
          stroke="#333333"
        />
        <line x1={nxToPx(0)} y1={nyToPy(0)} x2={nxToPx(1)} y2={nyToPy(0)} stroke="#2a2a2a" />
        <line x1={nxToPx(0)} y1={nyToPy(1)} x2={nxToPx(1)} y2={nyToPy(1)} stroke="#2a2a2a" />
        <polyline points={polyline} fill="none" stroke={ACCENT} strokeWidth={2} />
        {bezier && (
          <>
            <line
              x1={nxToPx(0)}
              y1={nyToPy(0)}
              x2={nxToPx(bezier.cx1)}
              y2={nyToPy(bezier.cy1)}
              stroke="#6a6a6a"
            />
            <line
              x1={nxToPx(1)}
              y1={nyToPy(1)}
              x2={nxToPx(bezier.cx2)}
              y2={nyToPy(bezier.cy2)}
              stroke="#6a6a6a"
            />
            <circle cx={nxToPx(bezier.cx1)} cy={nyToPy(bezier.cy1)} r={6} fill={ACCENT} />
            <circle cx={nxToPx(bezier.cx2)} cy={nyToPy(bezier.cy2)} r={6} fill="#ffb35a" />
          </>
        )}
      </svg>

      <div style={readoutStyle}>
        {bezier
          ? `cx1 ${bezier.cx1.toFixed(2)}  cy1 ${bezier.cy1.toFixed(2)}  cx2 ${bezier.cx2.toFixed(2)}  cy2 ${bezier.cy2.toFixed(2)}`
          : 'Switch to Bezier to drag control handles.'}
      </div>
    </div>
  );
}

interface TypeButtonProps {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

function TypeButton({ label, active, onClick }: TypeButtonProps): ReactElement {
  return (
    <button
      type="button"
      style={{ ...buttonStyle, ...(active ? buttonActiveStyle : null) }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function emptyMessage(activeAnimation: string | null, selectionCount: number): string {
  if (activeAnimation === null) return 'No animation. Create one to author keyframes (WP-1.9).';
  if (selectionCount === 0) return 'Select a keyframe in the dopesheet to edit its easing.';
  return `Select a single keyframe to edit its easing (${selectionCount} selected).`;
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  width: '100%',
  height: '100%',
  padding: 8,
  boxSizing: 'border-box',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
  overflow: 'auto',
};

const sectionLabelStyle: CSSProperties = {
  color: '#888888',
  textTransform: 'uppercase',
  fontSize: 10,
  letterSpacing: '0.06em',
};

const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

const svgStyle: CSSProperties = {
  alignSelf: 'center',
  marginTop: 4,
  touchAction: 'none',
  cursor: 'crosshair',
  borderRadius: 4,
};

const readoutStyle: CSSProperties = { color: '#999999', fontVariantNumeric: 'tabular-nums' };

const emptyStyle: CSSProperties = { color: '#777777', padding: 8 };

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
