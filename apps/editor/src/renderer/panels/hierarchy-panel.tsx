import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  CreateBoneCommand,
  DeleteBoneCommand,
  RenameBoneCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  documentHost,
  type BoneId,
} from '../document';
import { useSelectionStore } from '../editor-state/selection-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { buildHierarchyRows, canReparent, treeBoneGeometry } from './hierarchy-tree';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;
const INDENT_PX = 14;
const CYCLE_NOTICE = 'Cannot reparent a bone under itself or one of its descendants.';

// The bone hierarchy panel (WP-1.1, editor half): a depth-indented tree of the document's bones with
// inline rename, create-child, delete, and drag-to-reparent. Every STRUCTURAL change routes through a
// document-core command on the live History (LAW 2); SELECTING a bone is ephemeral editor state in the
// selection store (the document/editor wall, LAW 1), so it never touches History. The panel polls
// model.revision (like the dopesheet and animation panels) to re-render after any command, including
// undo/redo and edits made elsewhere (the gizmo, the create tool), and reads live state through
// documentHost.current() inside handlers so no handler closes over a stale model. All tree-shape and
// reparent-validity DECISIONS live in the pure hierarchy-tree module; this file is glue plus styling.
export function HierarchyPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const selectedBoneIds = useSelectionStore((state) => state.selectedBoneIds);

  const rows = useMemo(() => buildHierarchyRows(model.bones()), [model, revision]);
  const selectedSet = useMemo(() => new Set(selectedBoneIds), [selectedBoneIds]);

  // A transient, non-blocking message (a rejected reparent). It auto-clears so it never lingers; the
  // timer is cleared on replacement and on unmount.
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

  // The bone currently being dragged, held in a ref so the drop handler reads it without a re-render and
  // without round-tripping the branded BoneId through dataTransfer as a plain string (which would force
  // an unsafe cast back). Cleared on drop and on drag end.
  const draggedId = useRef<BoneId | null>(null);

  // Select a bone: EPHEMERAL editor state (the document/editor wall, LAW 1), never a command and never on
  // History. The viewport gizmo reads the same store, so selecting in the tree drives the gizmo too.
  function selectBone(id: BoneId): void {
    useSelectionStore.getState().select([id]);
  }

  // Rename through History (LAW 2). Identity is the BoneId, so the selection (keyed by id) survives the
  // rename. Duplicate names are legal at author time; the validator enforces uniqueness at export.
  function renameBone(id: BoneId, name: string): void {
    documentHost.current().history.execute(new RenameBoneCommand(id, name));
  }

  // Create a bone under `parent` (or a root when parent is null) through History (LAW 2). The id is
  // minted here so redo reuses it, and the name defaults to the minted id (create-bone-tool convention)
  // so a fresh bone never collides on export. CreateBoneCommand carries a selectionHint that selects the
  // new bone, which the DocumentHost reconciler applies, so this handler never touches the selection
  // store (mirrors create-bone-tool.ts, which never sets selection on commit either).
  function addBone(parent: BoneId | null): void {
    const doc = documentHost.current();
    const id = doc.ids.mint('bone');
    doc.history.execute(new CreateBoneCommand(id, parent, treeBoneGeometry(id)));
  }

  // Delete through History (LAW 2). The command cascades child bones in ONE undo step; the DocumentHost
  // reconciler then selects the parent (or clears) and prunes the now-dead selection, so this handler
  // does not reconcile selection itself.
  function deleteBone(id: BoneId): void {
    documentHost.current().history.execute(new DeleteBoneCommand(id));
  }

  // Reparent `dragged` under `newParent` (null reparents to a root). The canReparent pre-check rejects a
  // cycle so an invalid gesture is visibly disallowed with NO command and NO history entry. The command
  // stays the authority and still throws ReparentCycleError, which is caught defensively here so a slip
  // never crashes the panel; any other error is a real bug and is rethrown. Reads the LIVE model so the
  // check is never stale.
  function reparentBone(dragged: BoneId, newParent: BoneId | null): void {
    const doc = documentHost.current();
    if (!canReparent(doc.model.bones(), dragged, newParent)) {
      showNotice(CYCLE_NOTICE);
      return;
    }
    try {
      doc.history.execute(new ReparentBoneCommand(dragged, newParent));
    } catch (error) {
      if (error instanceof ReparentCycleError) {
        showNotice(CYCLE_NOTICE);
        return;
      }
      throw error;
    }
  }

  function onRowDragStart(id: BoneId): void {
    draggedId.current = id;
  }

  function onRowDragEnd(): void {
    draggedId.current = null;
  }

  function onDropOnBone(targetId: BoneId): void {
    const dragged = draggedId.current;
    draggedId.current = null;
    if (dragged === null) return;
    reparentBone(dragged, targetId);
  }

  function onDropOnRoot(): void {
    const dragged = draggedId.current;
    draggedId.current = null;
    if (dragged === null) return;
    reparentBone(dragged, null);
  }

  // Whether the in-flight drag may drop on `targetId`, for the drop-cursor feedback during dragover. The
  // drop itself always re-validates in reparentBone, so this is purely a UI hint.
  function canDropOnBone(targetId: BoneId): boolean {
    const dragged = draggedId.current;
    if (dragged === null) return false;
    return canReparent(documentHost.current().model.bones(), dragged, targetId);
  }

  // The toolbar "Add Bone" creates under the currently selected bone, or a root when nothing is selected.
  // Read live from the store so the parent reflects a selection changed since the last render.
  function selectedParent(): BoneId | null {
    const ids = useSelectionStore.getState().selectedBoneIds;
    return ids.length > 0 ? ids[0]! : null;
  }

  const boneCount = rows.length;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={() => addBone(selectedParent())}>
          Add Bone
        </button>
        <span style={countStyle}>
          {boneCount} {boneCount === 1 ? 'bone' : 'bones'}
        </span>
      </div>

      <div style={listStyle}>
        {rows.length === 0 && (
          <div style={emptyStyle}>No bones. Add one to start rigging (WP-1.1).</div>
        )}
        {rows.map((row) => (
          <HierarchyRow
            key={row.id}
            id={row.id}
            name={row.name}
            depth={row.depth}
            isSelected={selectedSet.has(row.id)}
            onSelect={selectBone}
            onRename={renameBone}
            onAddChild={addBone}
            onDelete={deleteBone}
            onDragStart={onRowDragStart}
            onDragEnd={onRowDragEnd}
            onDrop={onDropOnBone}
            canDrop={canDropOnBone}
          />
        ))}
      </div>

      <div
        style={rootDropStyle}
        title="Drop a bone here to make it a root"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDropOnRoot();
        }}
      >
        Drop here to make a root bone
      </div>

      {notice !== null && <div style={noticeStyle}>{notice}</div>}
    </div>
  );
}

interface HierarchyRowProps {
  readonly id: BoneId;
  readonly name: string;
  readonly depth: number;
  readonly isSelected: boolean;
  readonly onSelect: (id: BoneId) => void;
  readonly onRename: (id: BoneId, name: string) => void;
  readonly onAddChild: (id: BoneId) => void;
  readonly onDelete: (id: BoneId) => void;
  readonly onDragStart: (id: BoneId) => void;
  readonly onDragEnd: () => void;
  readonly onDrop: (id: BoneId) => void;
  readonly canDrop: (id: BoneId) => boolean;
}

function HierarchyRow(props: HierarchyRowProps): ReactElement {
  const { id, name, depth, isSelected } = props;

  // The name field is UNCONTROLLED and keyed by its committed value plus this nonce (the same pattern as
  // the animation panel): a committed rename changes the prop, so the key changes and the field remounts
  // to the live value, which also reflects undo/redo/load; bumping the nonce remounts to discard an
  // in-progress edit on Escape or an empty/unchanged entry.
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);

  function commitName(raw: string): void {
    const next = raw.trim();
    if (next === '' || next === name) {
      revert();
      return;
    }
    props.onRename(id, next);
  }

  return (
    <div
      draggable
      title="Drag to reparent, click to select"
      style={{
        ...(isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle),
        paddingLeft: 8 + depth * INDENT_PX,
      }}
      onClick={() => props.onSelect(id)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        props.onDragStart(id);
      }}
      onDragEnd={() => props.onDragEnd()}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = props.canDrop(id) ? 'move' : 'none';
      }}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop(id);
      }}
    >
      <input
        key={`name:${name}:${resetNonce}`}
        type="text"
        defaultValue={name}
        spellCheck={false}
        style={nameInputStyle}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.currentTarget.value = name;
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => commitName(event.currentTarget.value)}
      />

      <button
        type="button"
        style={smallButtonStyle}
        title="Add child bone"
        onClick={(event) => {
          event.stopPropagation();
          props.onAddChild(id);
        }}
      >
        +
      </button>
      <button
        type="button"
        style={smallButtonStyle}
        title="Delete bone"
        onClick={(event) => {
          event.stopPropagation();
          props.onDelete(id);
        }}
      >
        Del
      </button>
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
  cursor: 'pointer',
  userSelect: 'none',
};

const rowActiveStyle: CSSProperties = {
  background: '#26354a',
  boxShadow: `inset 2px 0 0 ${ACCENT}`,
};

const nameInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
  color: '#eeeeee',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
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

const rootDropStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #333333',
  color: '#777777',
  textAlign: 'center',
  fontSize: 11,
};

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a4a2a',
  background: '#3a2f1a',
  color: '#e8c98a',
};
