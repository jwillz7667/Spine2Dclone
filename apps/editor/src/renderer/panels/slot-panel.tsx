import type { IDockviewPanelProps } from 'dockview';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { symbolId } from '@marionette/format/slot';
import type {
  GridConfig,
  SymbolAnimSet,
  TumbleChoreography,
} from '@marionette/format/slot-types';
import {
  CreateWinSequenceCommand,
  MapSymbolAnimSetCommand,
  SetGridConfigCommand,
  SetTumbleChoreographyCommand,
  documentHost,
  type SlotSceneSnapshot,
} from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;

// The Slot panel (phase-4 slot composer, WP-4.5..4.10 authoring surface). The slot scene is PART of the
// main DocumentModel (doc-state.ts: readonly slotScene), so this panel drives the SAME single History as
// the skeleton (one undo stack); it needs no separate document host. It reads the live scene through
// documentHost.current().model.slotScene() / .slotGrid() / .getSymbolAnimSet(...), and dispatches every
// mutation through history.execute (LAW 2). Like the other panels it polls model.revision so it re-renders
// after a command AND after undo/redo (including edits made elsewhere). The panel surfaces three tracks:
// (1) GRID, fully editable via the three canonical preset constructors on SetGridConfigCommand plus a
// visual rows x cols board; (2) SYMBOLS, a library list plus a MapSymbolAnimSet control that maps a
// SymbolId to its skeleton/anim names; (3) read-only summaries of the win sequencer, feature flows, and
// tumble, each with ONE clean editing affordance (create a win sequence, toggle tumble easing). All
// reads/dispatch happen inside handlers against documentHost.current() so nothing closes over a stale model.
export function SlotPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;

  const grid = useMemo(() => model.slotGrid(), [model, revision]);
  const scene = useMemo(() => model.slotScene(), [model, revision]);
  const snapshot = useMemo(() => model.snapshot().slotScene, [model, revision]);

  // A transient, non-blocking notice (a rejected command surfaces its typed SlotEditError message). It
  // auto-clears so it never lingers; the timer is cleared on replacement and on unmount (mirrors the
  // assets panel).
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (message: string): void => {
    setNotice(message);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    },
    [],
  );

  return (
    <div style={rootStyle}>
      <GridSection grid={grid} onError={showNotice} />
      <SymbolSection snapshot={snapshot} onError={showNotice} />
      <SummarySection snapshot={snapshot} tumble={scene.tumble} onError={showNotice} />
      {notice !== null && <div style={noticeStyle}>{notice}</div>}
    </div>
  );
}

// Run a command through the live History (LAW 2), turning a typed SlotEditError (or any error) into a
// transient notice instead of crashing the panel. Reads the live document at call time so no handler
// closes over a stale model.
function dispatch(build: () => void, onError: (message: string) => void): void {
  try {
    build();
  } catch (error) {
    onError(error instanceof Error ? error.message : 'slot edit failed');
  }
}

interface SectionErrorProps {
  readonly onError: (message: string) => void;
}

// The three canonical grid presets exposed as one-click buttons. Each maps to a preset static constructor
// on SetGridConfigCommand (reelStrip5x3 / scatterPay6x5 / cluster7x7) so a click swaps the whole grid in
// one undo step rather than hand-building a GridConfig.
const GRID_PRESETS: readonly {
  readonly label: string;
  readonly build: () => SetGridConfigCommand;
}[] = [
  { label: '5x3 Reel Strip', build: () => SetGridConfigCommand.reelStrip5x3() },
  { label: '6x5 Scatter Pay', build: () => SetGridConfigCommand.scatterPay6x5() },
  { label: '7x7 Cluster', build: () => SetGridConfigCommand.cluster7x7() },
];

interface GridSectionProps extends SectionErrorProps {
  readonly grid: GridConfig;
}

function GridSection(props: GridSectionProps): ReactElement {
  const { grid, onError } = props;
  const applyPreset = (build: () => SetGridConfigCommand): void => {
    dispatch(() => {
      documentHost.current().history.execute(build());
    }, onError);
  };
  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span>Grid</span>
        <span style={countStyle}>
          {grid.cols} x {grid.rows} {grid.topology}
        </span>
      </div>
      <div style={bodyStyle}>
        <div style={presetRowStyle}>
          {GRID_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              style={buttonStyle}
              onClick={() => applyPreset(preset.build)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div style={fieldGridStyle}>
          <Metric label="Topology" value={grid.topology} />
          <Metric label="Cols" value={String(grid.cols)} />
          <Metric label="Rows" value={String(grid.rows)} />
          <Metric label="Gravity" value={grid.gravity} />
          <Metric label="Cell" value={`${grid.cellWidth} x ${grid.cellHeight}`} />
          <Metric label="Gap" value={String(grid.cellGap)} />
          <Metric label="Stagger" value={`${grid.reelStopStaggerMs} ms`} />
          <Metric label="Triggers" value={String(grid.anticipation.triggerSymbols.length)} />
        </div>
        <GridPreview cols={grid.cols} rows={grid.rows} />
      </div>
    </div>
  );
}

interface GridPreviewProps {
  readonly cols: number;
  readonly rows: number;
}

// A simple rows x cols CSS grid of cells so a preset swap is VISIBLE. Cells carry no symbol content (LAW 1:
// the board is RNG-driven at runtime, never authored here); this is a pure geometry preview of the grid.
function GridPreview(props: GridPreviewProps): ReactElement {
  const { cols, rows } = props;
  const cells = useMemo(() => Array.from({ length: cols * rows }), [cols, rows]);
  return (
    <div style={previewWrapStyle}>
      <div
        style={{
          ...previewGridStyle,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
        }}
      >
        {cells.map((_cell, index) => (
          <div key={index} style={previewCellStyle} />
        ))}
      </div>
    </div>
  );
}

interface SymbolSectionProps extends SectionErrorProps {
  readonly snapshot: SlotSceneSnapshot;
}

function SymbolSection(props: SymbolSectionProps): ReactElement {
  const { snapshot, onError } = props;
  const symbols = snapshot.symbols;
  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span>Symbols</span>
        <span style={countStyle}>
          {symbols.length} {symbols.length === 1 ? 'symbol' : 'symbols'}
        </span>
      </div>
      <div style={bodyStyle}>
        {symbols.length === 0 ? (
          <div style={emptyStyle}>
            No symbols mapped yet. Map a symbol to its skeleton and animation names below.
          </div>
        ) : (
          symbols.map((entry) => (
            <div key={entry.symbolId} style={rowStyle}>
              <span style={rowNameStyle}>{entry.symbolId}</span>
              <span style={rowMetaStyle}>{entry.skeletonRef}</span>
              <span style={rowMetaStyle}>
                {entry.idle} / {entry.land} / {entry.win}
              </span>
              <button
                type="button"
                style={smallButtonStyle}
                title="Remove this symbol mapping"
                onClick={() =>
                  dispatch(() => {
                    documentHost
                      .current()
                      .history.execute(
                        new MapSymbolAnimSetCommand(symbolId(entry.symbolId), { animSet: null }),
                      );
                  }, onError)
                }
              >
                Remove
              </button>
            </div>
          ))
        )}
        <MapSymbolControl onError={onError} />
      </div>
    </div>
  );
}

interface MapSymbolFieldState {
  readonly symbol: string;
  readonly skeletonRef: string;
  readonly idle: string;
  readonly land: string;
  readonly win: string;
}

const EMPTY_MAP_FIELDS: MapSymbolFieldState = {
  symbol: '',
  skeletonRef: '',
  idle: 'idle',
  land: 'land',
  win: 'win',
};

// Map a SymbolId to a SymbolAnimSet through MapSymbolAnimSetCommand. The command validates the init
// structurally (non-empty skeletonRef + anim names) and rejects an invalid map before any mutation with a
// typed SlotEditError, which the notice surfaces. The command also maintains refs.skeletons in the same
// single undo step. On success the fields reset so a second mapping starts clean.
function MapSymbolControl(props: SectionErrorProps): ReactElement {
  const { onError } = props;
  const [fields, setFields] = useState<MapSymbolFieldState>(EMPTY_MAP_FIELDS);

  const patch = (key: keyof MapSymbolFieldState, value: string): void => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  const canMap =
    fields.symbol.trim().length > 0 &&
    fields.skeletonRef.trim().length > 0 &&
    fields.idle.trim().length > 0 &&
    fields.land.trim().length > 0 &&
    fields.win.trim().length > 0;

  const mapSymbol = (): void => {
    const animSet: SymbolAnimSet = {
      skeletonRef: fields.skeletonRef.trim(),
      idle: fields.idle.trim(),
      land: fields.land.trim(),
      win: fields.win.trim(),
    };
    let applied = false;
    dispatch(() => {
      documentHost
        .current()
        .history.execute(new MapSymbolAnimSetCommand(symbolId(fields.symbol.trim()), { animSet }));
      applied = true;
    }, onError);
    if (applied) setFields(EMPTY_MAP_FIELDS);
  };

  return (
    <div style={mapControlStyle}>
      <div style={subHeaderStyle}>Map Symbol</div>
      <div style={mapFieldRowStyle}>
        <TextField
          placeholder="symbol id"
          value={fields.symbol}
          onChange={(value) => patch('symbol', value)}
        />
        <TextField
          placeholder="skeleton ref"
          value={fields.skeletonRef}
          onChange={(value) => patch('skeletonRef', value)}
        />
      </div>
      <div style={mapFieldRowStyle}>
        <TextField
          placeholder="idle anim"
          value={fields.idle}
          onChange={(value) => patch('idle', value)}
        />
        <TextField
          placeholder="land anim"
          value={fields.land}
          onChange={(value) => patch('land', value)}
        />
        <TextField
          placeholder="win anim"
          value={fields.win}
          onChange={(value) => patch('win', value)}
        />
      </div>
      <button
        type="button"
        style={canMap ? buttonStyle : { ...buttonStyle, ...buttonDisabledStyle }}
        disabled={!canMap}
        onClick={mapSymbol}
      >
        Map Symbol
      </button>
    </div>
  );
}

interface SummarySectionProps extends SectionErrorProps {
  readonly snapshot: SlotSceneSnapshot;
  readonly tumble: TumbleChoreography;
}

// Read-only summaries of the win sequencer, feature flows, and tumble, each with ONE clean editing
// affordance: create a named win sequence (CreateWinSequenceCommand) and toggle the tumble drop easing
// between linear and easeOutQuad (SetTumbleChoreographyCommand). The rest is a labelled summary of the
// snapshot counts / key fields; the full authoring of steps, transitions, and every timing field is not
// force-built here.
function SummarySection(props: SummarySectionProps): ReactElement {
  const { snapshot, tumble, onError } = props;
  const winSequencer = snapshot.winSequencer;
  const featureFlows = snapshot.featureFlows;
  const sequenceNames = Object.keys(winSequencer.sequences);
  const transitionCount = featureFlows.transitions.length;
  const stateCount = Object.keys(featureFlows.states).length;

  const [newSequenceName, setNewSequenceName] = useState('');

  const createSequence = (): void => {
    const name = newSequenceName.trim();
    if (name.length === 0) return;
    let applied = false;
    dispatch(() => {
      documentHost.current().history.execute(new CreateWinSequenceCommand(name));
      applied = true;
    }, onError);
    if (applied) setNewSequenceName('');
  };

  // Toggle only the dropEasing field, rebuilding the whole (small, all-scalar) TumbleChoreography so the
  // absolute-value command captures a clean before-memento (one undo restores the prior easing).
  const toggleDropEasing = (): void => {
    const next: TumbleChoreography = {
      ...tumble,
      dropEasing: tumble.dropEasing === 'linear' ? 'easeOutQuad' : 'linear',
    };
    dispatch(() => {
      documentHost.current().history.execute(new SetTumbleChoreographyCommand(next));
    }, onError);
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span>Sequencer, Flows, Tumble</span>
        <span style={countStyle}>summary</span>
      </div>
      <div style={bodyStyle}>
        <div style={subHeaderStyle}>Win Sequencer</div>
        <div style={fieldGridStyle}>
          <Metric label="Sequences" value={String(sequenceNames.length)} />
          <Metric label="Default" value={winSequencer.defaultSequence} />
          <Metric label="Big" value={String(winSequencer.thresholds.big)} />
          <Metric label="Mega" value={String(winSequencer.thresholds.mega)} />
          <Metric label="Epic" value={String(winSequencer.thresholds.epic)} />
        </div>
        <div style={inlineRowStyle}>
          <TextField
            placeholder="new sequence name"
            value={newSequenceName}
            onChange={setNewSequenceName}
          />
          <button
            type="button"
            style={
              newSequenceName.trim().length > 0
                ? buttonStyle
                : { ...buttonStyle, ...buttonDisabledStyle }
            }
            disabled={newSequenceName.trim().length === 0}
            onClick={createSequence}
          >
            Create Sequence
          </button>
        </div>

        <div style={subHeaderStyle}>Feature Flows</div>
        <div style={fieldGridStyle}>
          <Metric label="States" value={String(stateCount)} />
          <Metric label="Transitions" value={String(transitionCount)} />
          <Metric label="Entry" value={featureFlows.entry} />
        </div>
        <div style={hintStyle}>State machine editing is a summary here; drive it via commands.</div>

        <div style={subHeaderStyle}>Tumble</div>
        <div style={fieldGridStyle}>
          <Metric label="Explode" value={`${tumble.explodeMs} ms`} />
          <Metric label="Drop" value={`${tumble.dropMs} ms`} />
          <Metric label="Easing" value={tumble.dropEasing} />
          <Metric label="Settle" value={`${tumble.settleMs} ms`} />
          <Metric label="Rollup" value={tumble.rollupCurve} />
        </div>
        <div style={inlineRowStyle}>
          <button type="button" style={buttonStyle} onClick={toggleDropEasing}>
            Toggle Drop Easing
          </button>
        </div>
      </div>
    </div>
  );
}

interface MetricProps {
  readonly label: string;
  readonly value: string;
}

function Metric(props: MetricProps): ReactElement {
  return (
    <div style={metricStyle}>
      <span style={metricLabelStyle}>{props.label}</span>
      <span style={metricValueStyle}>{props.value}</span>
    </div>
  );
}

interface TextFieldProps {
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

// A controlled text field (the map/create controls hold their draft in local state, not the document, so a
// controlled input is correct here; the document only changes on the command dispatch).
function TextField(props: TextFieldProps): ReactElement {
  return (
    <input
      type="text"
      spellCheck={false}
      placeholder={props.placeholder}
      value={props.value}
      style={textInputStyle}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: '#1b1b1b',
  color: '#dddddd',
  fontSize: 12,
  overflowY: 'auto',
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderBottom: '1px solid #333333',
};

const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #2c2c2c',
  color: '#cccccc',
  fontWeight: 600,
  background: '#202020',
};

const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888', fontWeight: 400 };

const bodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px',
};

const presetRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const fieldGridStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const metricStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '4px 8px',
  border: '1px solid #2c2c2c',
  borderRadius: 4,
  background: '#1f1f1f',
  minWidth: 64,
};

const metricLabelStyle: CSSProperties = { color: '#888888', fontSize: 11 };

const metricValueStyle: CSSProperties = {
  color: '#eeeeee',
  fontVariantNumeric: 'tabular-nums',
};

const previewWrapStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '4px 0',
};

const previewGridStyle: CSSProperties = {
  display: 'grid',
  gap: 3,
  width: '100%',
  maxWidth: 240,
};

const previewCellStyle: CSSProperties = {
  aspectRatio: '1 / 1',
  background: '#26354a',
  border: `1px solid ${ACCENT}`,
  borderRadius: 3,
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  border: '1px solid #262626',
  borderRadius: 4,
  background: '#1f1f1f',
};

const rowNameStyle: CSSProperties = {
  flex: '0 0 auto',
  color: '#eeeeee',
  fontWeight: 600,
  maxWidth: '30%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowMetaStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  color: '#888888',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const mapControlStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 4,
  paddingTop: 8,
  borderTop: '1px solid #2c2c2c',
};

const mapFieldRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const inlineRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};

const subHeaderStyle: CSSProperties = {
  color: '#cccccc',
  fontWeight: 600,
  marginTop: 4,
};

const hintStyle: CSSProperties = { color: '#777777', fontSize: 11 };

const emptyStyle: CSSProperties = { color: '#777777', padding: '4px 0' };

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: `1px solid ${ACCENT}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const smallButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '3px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const buttonDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};

const textInputStyle: CSSProperties = {
  flex: '1 1 120px',
  minWidth: 0,
  fontSize: 12,
  color: '#eeeeee',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '3px 6px',
};

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a2a2a',
  background: '#3a1a1a',
  color: '#e89a9a',
};
