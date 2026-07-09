import type { IDockviewPanelProps } from 'dockview';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactElement,
} from 'react';
import { documentHost } from '../document';
import { runImageImport, runSpriteImport } from '../actions/import-sprites';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { buildAtlasView } from './assets-atlas-view';
import { buildThumbnails } from './asset-thumbnails';

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
  const atlas = useMemo(() => model.preserved().atlas, [model, revision]);
  const atlasView = useMemo(() => buildAtlasView(atlas), [atlas]);

  // Region thumbnails (PP-D5), decoded once per page from the atlas page bytes and cached as data URLs
  // (ephemeral editor state, never the document). Rebuilt when the atlas changes (revision) or the page
  // bytes change (import / restore / clear, via the atlas-texture store subscription). A generation token
  // discards a stale async build if another starts or the panel unmounts first.
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(() => new Map());
  const [textureTick, setTextureTick] = useState(0);
  useEffect(() => atlasTextureStore.subscribe(() => setTextureTick((tick) => tick + 1)), []);
  useEffect(() => {
    let live = true;
    const pages = atlasTextureStore.getPageBytes();
    if (atlas.pages.length === 0 || pages.length === 0) {
      setThumbnails(new Map());
      return;
    }
    void buildThumbnails(atlas, pages).then((built) => {
      if (live) setThumbnails(built);
    });
    return () => {
      live = false;
    };
  }, [atlas, textureTick]);

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

  // The main process owns the dialog and the pack; on success we set the atlas through History (LAW 2) and
  // publish the page textures so the same regions render textured in the viewport. A user cancel is a
  // silent no-op; a handler error becomes a transient notice. The atlas crosses the wire as `unknown` (the
  // response keeps it opaque, exactly like fileOpen's document); the main-process pipeline is the trusted
  // producer of a typed AtlasRef and the format validator re-checks it at export (LAW 3), so this single
  // narrowing assertion is justified. The busy state is held until BOTH the command and the texture build
  // settle. The command runs first so the document carries the regions before the textures resolve them; a
  // texture-load failure leaves the placeholder (the document still has the atlas) and surfaces a notice
  // rather than crashing the panel.
  async function importSprites(): Promise<void> {
    setIsImporting(true);
    try {
      const outcome = await runSpriteImport();
      if (outcome.kind === 'error') {
        showNotice(outcome.message);
      } else if (outcome.kind === 'imported' && outcome.regionCount === 0) {
        // A silent empty atlas reads as "import did nothing"; explain it. Import decodes PNG only, so a
        // folder of JPEG/WebP (or no images) packs to zero regions with no error otherwise.
        showNotice(
          'Imported 0 regions. Sprite import supports PNG files only; the chosen folder had no usable PNGs.',
        );
      }
    } finally {
      setIsImporting(false);
    }
  }

  // Import a set of dropped or picked image Files (PP-D5). The renderer reads each File's bytes with the web
  // File API (no filesystem access) and hands them to main, which stages and packs them exactly like a
  // folder import. Non-image entries are ignored before reading; the packer filters to PNG, so a dropped
  // JPEG yields a "0 regions" notice like the folder path.
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function importFiles(fileList: FileList | null): Promise<void> {
    if (fileList === null || fileList.length === 0) return;
    const files = Array.from(fileList).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) {
      showNotice('Image import supports PNG files only; nothing usable was dropped.');
      return;
    }
    setIsImporting(true);
    try {
      const images = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const outcome = await runImageImport(images);
      if (outcome.kind === 'error') {
        showNotice(outcome.message);
      } else if (outcome.kind === 'imported' && outcome.regionCount === 0) {
        showNotice('Imported 0 regions. Image import supports PNG files only.');
      }
    } finally {
      setIsImporting(false);
    }
  }

  function onDrop(event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    void importFiles(event.dataTransfer.files);
  }

  return (
    <div
      style={isDragging ? { ...rootStyle, ...rootDragStyle } : rootStyle}
      onDragOver={(event) => {
        event.preventDefault();
        if (!isDragging) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer leaves the panel itself, not when it moves over a child element.
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={onDrop}
    >
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
        <button
          type="button"
          style={isImporting ? { ...buttonStyle, ...buttonBusyStyle } : buttonStyle}
          disabled={isImporting}
          title="Add one or more PNG images (or drag them onto this panel)"
          onClick={() => fileInputRef.current?.click()}
        >
          Add images
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            void importFiles(event.target.files);
            event.target.value = ''; // allow re-picking the same file
          }}
        />
        <span style={countStyle}>
          {atlasView.regionCount} {atlasView.regionCount === 1 ? 'region' : 'regions'}
          {atlasView.pageCount > 0 &&
            ` / ${atlasView.pageCount} ${atlasView.pageCount === 1 ? 'page' : 'pages'}`}
        </span>
      </div>

      <div style={listStyle}>
        {atlasView.regionCount === 0 ? (
          <div style={emptyStyle}>
            No atlas yet. Import a folder of sprites, click Add images, or drag PNGs onto this panel.
          </div>
        ) : (
          atlasView.regions.map((region) => (
            <div key={region.name} style={rowStyle}>
              <span style={thumbCellStyle}>
                {thumbnails.has(region.name) ? (
                  <img src={thumbnails.get(region.name)} alt="" style={thumbImageStyle} />
                ) : (
                  <span style={thumbPlaceholderStyle} />
                )}
              </span>
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

const rootDragStyle: CSSProperties = {
  outline: `2px dashed ${ACCENT}`,
  outlineOffset: -4,
  background: '#1e2632',
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

const thumbCellStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 3,
  overflow: 'hidden',
};

const thumbImageStyle: CSSProperties = {
  maxWidth: 40,
  maxHeight: 40,
  imageRendering: 'auto',
};

const thumbPlaceholderStyle: CSSProperties = {
  width: 40,
  height: 40,
  background:
    'repeating-conic-gradient(#2a2a2a 0% 25%, #202020 0% 50%) 50% / 12px 12px',
  opacity: 0.6,
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
