import { useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { runGridAtlasImport } from './actions/import-sprites';
import { useGridSliceStore } from './editor-state/grid-slice-store';
import type { GridSpec } from '../shared';

// The Slice Sprite Sheet dialog (PP-D5): a small modal that turns a plain, evenly tiled sprite sheet into an
// atlas of named regions WITHOUT repacking. The user picks a PNG (read as bytes with the web File API, no
// filesystem access) and chooses either a fixed cell size or a fixed column/row count; the main process
// decodes and slices, then the AtlasRef is set on the document through the same command + texture path as a
// sprite import (LAW 2). It renders nothing until opened from the Assets panel or the File menu, and closes
// on a successful slice or an explicit cancel. Presentation only (no direct document mutation).

type SliceMode = GridSpec['mode'];

export function GridSliceDialog(): ReactElement | null {
  const open = useGridSliceStore((state) => state.open);
  const dismiss = useGridSliceStore((state) => state.dismiss);

  const [mode, setMode] = useState<SliceMode>('grid');
  const [columns, setColumns] = useState('4');
  const [rows, setRows] = useState('4');
  const [cellWidth, setCellWidth] = useState('64');
  const [cellHeight, setCellHeight] = useState('64');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const close = (): void => {
    setError(null);
    setBusy(false);
    dismiss();
  };

  // Parse a positive-integer field, returning null when it is blank or not a positive whole number.
  const asPositiveInt = (value: string): number | null => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };

  const buildSpec = (): GridSpec | null => {
    if (mode === 'cell') {
      const w = asPositiveInt(cellWidth);
      const h = asPositiveInt(cellHeight);
      return w !== null && h !== null ? { mode: 'cell', cellWidth: w, cellHeight: h } : null;
    }
    const c = asPositiveInt(columns);
    const r = asPositiveInt(rows);
    return c !== null && r !== null ? { mode: 'grid', columns: c, rows: r } : null;
  };

  const submit = async (): Promise<void> => {
    if (file === null) {
      setError('Choose a PNG sprite sheet first.');
      return;
    }
    const spec = buildSpec();
    if (spec === null) {
      setError('Enter positive whole numbers for every field.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const image = { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
      const outcome = await runGridAtlasImport(image, spec);
      if (outcome.kind === 'error') {
        setError(outcome.message);
        setBusy(false);
        return;
      }
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'slice failed');
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Slice sprite sheet">
      <div style={dialogStyle}>
        <div style={headerStyle}>
          <strong style={{ fontSize: 15 }}>Slice Sprite Sheet</strong>
          <button type="button" style={closeButtonStyle} onClick={close}>
            Cancel
          </button>
        </div>

        <div style={{ color: '#8a8a9a', marginBottom: 12 }}>
          Turn an evenly tiled PNG sheet into named regions. Any remainder that does not fill a
          whole cell is ignored.
        </div>

        <div style={rowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose PNG...
          </button>
          <span style={{ color: '#c9c9d6', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {file?.name ?? 'No file chosen'}
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            style={{ display: 'none' }}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
        </div>

        <div style={{ ...rowStyle, marginTop: 12 }}>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="grid-mode"
              checked={mode === 'grid'}
              onChange={() => setMode('grid')}
            />
            Columns / rows
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="grid-mode"
              checked={mode === 'cell'}
              onChange={() => setMode('cell')}
            />
            Cell size
          </label>
        </div>

        {mode === 'grid' ? (
          <div style={{ ...rowStyle, marginTop: 10 }}>
            <NumberField label="Columns" value={columns} onChange={setColumns} />
            <NumberField label="Rows" value={rows} onChange={setRows} />
          </div>
        ) : (
          <div style={{ ...rowStyle, marginTop: 10 }}>
            <NumberField label="Cell width" value={cellWidth} onChange={setCellWidth} />
            <NumberField label="Cell height" value={cellHeight} onChange={setCellHeight} />
          </div>
        )}

        {error !== null && <div style={errorStyle}>{error}</div>}

        <div style={{ ...rowStyle, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            type="button"
            style={busy ? { ...primaryButtonStyle, ...busyStyle } : primaryButtonStyle}
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Slicing...' : 'Slice'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}): ReactElement {
  return (
    <label style={fieldLabelStyle}>
      <span>{props.label}</span>
      <input
        type="number"
        min={1}
        step={1}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        style={inputStyle}
      />
    </label>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: CSSProperties = {
  width: 'min(440px, 90vw)',
  background: '#1e1e28',
  color: '#e6e6ee',
  border: '1px solid #3a3a4a',
  borderRadius: 8,
  padding: 20,
  boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
  font: '13px/1.5 system-ui, sans-serif',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 12,
};

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

const radioLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
};

const inputStyle: CSSProperties = {
  background: '#141420',
  color: '#e6e6ee',
  border: '1px solid #33334a',
  borderRadius: 4,
  padding: '4px 6px',
  font: '13px system-ui, sans-serif',
};

const closeButtonStyle: CSSProperties = {
  background: '#3a3a4a',
  color: '#e6e6ee',
  border: 'none',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  background: '#2d2d3d',
  color: '#e6e6ee',
  border: '1px solid #4a4a5a',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
  flex: '0 0 auto',
};

const primaryButtonStyle: CSSProperties = {
  background: '#3a63a8',
  color: '#ffffff',
  border: '1px solid #5aa0ff',
  borderRadius: 6,
  padding: '6px 18px',
  cursor: 'pointer',
};

const busyStyle: CSSProperties = { opacity: 0.6, cursor: 'progress' };

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: '6px 8px',
  borderRadius: 4,
  background: '#3a1a1a',
  color: '#e89a9a',
};
