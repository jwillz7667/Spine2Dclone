import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { AtlasRef } from '@marionette/format/types';
import { SetAtlasRefCommand, documentHost } from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { buildAtlasView } from './assets-atlas-view';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;

// The Assets panel (WP-1.3, TASK-1.3.6): import a directory of source sprites, pack them into an atlas in
// the main process, and set the result on the live document through SetAtlasRefCommand (LAW 2). The
// renderer supplies NO filesystem path; the main process owns the directory dialog (path-injection
// defense). The packed AtlasRef arrives over the typed IPC bridge as an opaque value (validated for real
// at export, LAW 3). The region list this panel renders is the surface WP-1.2's inspector reads to attach
// a region to a slot. Importing replaces the whole atlas in one undo step; importing twice is two undo
// steps (correct, atlases are not merged). All atlas projection is pure (assets-atlas-view.ts); the panel
// polls model.revision (like the dopesheet) so the list refreshes after the command and after undo/redo.
export function AssetsPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const atlasView = useMemo(() => buildAtlasView(model.preserved().atlas), [model, revision]);

  // Packing can take a moment, so the button shows a busy state and is disabled while the import promise
  // is pending. The work runs in the main process, so the renderer thread is never blocked.
  const [isImporting, setIsImporting] = useState(false);

  // A transient, non-blocking notice (a handler error). It auto-clears so it never lingers; the timer is
  // cleared on replacement and on unmount (mirrors the animation panel).
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

  // The main process owns the dialog and the pack; on success we set the atlas through History (LAW 2). A
  // user cancel is a silent no-op; a handler error becomes a transient notice. The atlas crosses the wire
  // as `unknown` (the response keeps it opaque, exactly like fileOpen's document); the main-process
  // pipeline is the trusted producer of a typed AtlasRef and the format validator re-checks it at export
  // (LAW 3), so this single narrowing assertion is justified.
  async function importSprites(): Promise<void> {
    setIsImporting(true);
    try {
      const result = await window.marionette.importAtlas();
      if (!result.ok) {
        showNotice(result.error.message);
        return;
      }
      if (result.data.status === 'canceled') return;
      const atlas = result.data.atlas as AtlasRef;
      documentHost.current().history.execute(new SetAtlasRefCommand(atlas));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button
          type="button"
          style={isImporting ? { ...buttonStyle, ...buttonBusyStyle } : buttonStyle}
          disabled={isImporting}
          onClick={() => {
            void importSprites();
          }}
        >
          {isImporting ? 'Importing...' : 'Import sprites'}
        </button>
        <span style={countStyle}>
          {atlasView.regionCount} {atlasView.regionCount === 1 ? 'region' : 'regions'}
          {atlasView.pageCount > 0 &&
            ` / ${atlasView.pageCount} ${atlasView.pageCount === 1 ? 'page' : 'pages'}`}
        </span>
      </div>

      <div style={listStyle}>
        {atlasView.regionCount === 0 ? (
          <div style={emptyStyle}>No atlas imported yet. Import sprites to pack an atlas.</div>
        ) : (
          atlasView.regions.map((region) => (
            <div key={region.name} style={rowStyle}>
              <span style={nameStyle}>{region.name}</span>
              <span style={sizeStyle}>{region.label}</span>
            </div>
          ))
        )}
      </div>

      {notice !== null && <div style={noticeStyle}>{notice}</div>}
    </div>
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
};

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid #333333',
  flex: '0 0 auto',
};

const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888' };

const listStyle: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' };

const emptyStyle: CSSProperties = { color: '#777777', padding: 12 };

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid #262626',
};

const nameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#eeeeee',
};

const sizeStyle: CSSProperties = {
  flex: '0 0 auto',
  color: '#888888',
  fontVariantNumeric: 'tabular-nums',
};

const buttonStyle: CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  color: '#dddddd',
  background: '#2d2d2d',
  border: `1px solid ${ACCENT}`,
  borderRadius: 4,
  cursor: 'pointer',
};

const buttonBusyStyle: CSSProperties = {
  opacity: 0.6,
  cursor: 'progress',
};

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a2a2a',
  background: '#3a1a1a',
  color: '#e89a9a',
};
