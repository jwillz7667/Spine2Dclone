import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  AnimationDurationError,
  CreateAnimationCommand,
  DeleteAnimationCommand,
  DuplicateAnimationCommand,
  RenameAnimationCommand,
  SetAnimationDurationCommand,
  documentHost,
  type AnimationId,
} from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  DEFAULT_ANIMATION_BASENAME,
  DEFAULT_ANIMATION_DURATION,
  chooseActiveAfterDelete,
  duplicateNameFor,
  duplicateNameKeys,
  uniqueAnimationName,
} from './animation-manager';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;

// The animation manager panel (WP-1.9): create, rename, duplicate, delete, and re-time the document's
// named animations. Every structural change routes through a document-core command on the live History
// (LAW 2); SWITCHING the active animation is ephemeral editor state in the playback store (the document/
// editor wall, LAW 1), so it never touches History. The panel polls model.revision (like the dopesheet)
// to re-render after any command, and reads live state through documentHost.current() inside handlers so
// no handler closes over a stale model. All naming/selection decisions live in the pure animation-manager
// module; this file is glue plus styling.
export function AnimationPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const setActiveAnimation = usePlaybackStore((state) => state.setActiveAnimation);

  const animations = useMemo(() => model.animations(), [model, revision]);
  const duplicateNames = useMemo(() => duplicateNameKeys(animations), [animations]);

  // A transient, non-blocking message (currently only a rejected duration shrink). It auto-clears so it
  // never lingers; the timer is cleared on replacement and on unmount.
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

  // Create an empty animation through History (LAW 2) and make it active (editor state, not a mutation).
  // The id is minted here so redo reuses it; the default name is uniquified against the live names so a
  // fresh animation does not collide on export.
  function createAnimation(): void {
    const doc = documentHost.current();
    const existingNames = doc.model.animations().map((animation) => animation.name);
    const id = doc.ids.mint('animation');
    doc.history.execute(
      new CreateAnimationCommand(
        id,
        uniqueAnimationName(existingNames, DEFAULT_ANIMATION_BASENAME),
        DEFAULT_ANIMATION_DURATION,
      ),
    );
    setActiveAnimation(id);
  }

  // Rename keeps the same AnimationId, so the active selection (keyed by id) survives the rename.
  // Duplicate names are allowed at author time (the badge surfaces them); the validator enforces
  // uniqueness at export.
  function renameAnimation(id: AnimationId, name: string): void {
    documentHost.current().history.execute(new RenameAnimationCommand(id, name));
  }

  // Duplicate deep-copies the source timelines in one undo step (the command is a composite) and activates
  // the copy. Reads the live source name and existing names so the copy name is freshly uniquified.
  function duplicateAnimation(sourceId: AnimationId): void {
    const doc = documentHost.current();
    const source = doc.model.getAnimation(sourceId);
    if (source === undefined) return;
    const existingNames = doc.model.animations().map((animation) => animation.name);
    const newId = doc.ids.mint('animation');
    doc.history.execute(
      new DuplicateAnimationCommand(sourceId, newId, duplicateNameFor(source.name, existingNames)),
    );
    setActiveAnimation(newId);
  }

  // Delete through History, then reconcile the EPHEMERAL active selection from the POST-command model
  // (read AFTER execute so the deleted animation is gone). The reconciliation lives here, never inside the
  // command (the document/editor wall, LAW 1).
  function deleteAnimation(id: AnimationId): void {
    const doc = documentHost.current();
    doc.history.execute(new DeleteAnimationCommand(id));
    const remainingIds = doc.model.animations().map((animation) => animation.id);
    const current = usePlaybackStore.getState().activeAnimation;
    setActiveAnimation(chooseActiveAfterDelete(remainingIds, id, current));
  }

  // Commit a duration edit inside a coalescing interaction session (mirrors MoveBone, so a run of nudges
  // folds to one undo step). SetAnimationDuration throws AnimationDurationError BEFORE mutating when the
  // new value would shrink the animation below its last keyframe. This is a USER INPUT boundary, not a
  // data boundary, so we CATCH it, surface a non-blocking notice, and leave the document untouched (the
  // empty session commits nothing). Returns whether the edit was accepted so the row reverts its field on
  // rejection. A non-AnimationDurationError is a real bug and is rethrown after the session is closed.
  function commitDuration(id: AnimationId, seconds: number): boolean {
    const history = documentHost.current().history;
    history.beginInteraction();
    try {
      history.execute(new SetAnimationDurationCommand(id, seconds));
      return true;
    } catch (error) {
      if (error instanceof AnimationDurationError) {
        showNotice('Duration cannot be shorter than the last keyframe.');
        return false;
      }
      throw error;
    } finally {
      history.endInteraction('Set Animation Duration');
    }
  }

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={createAnimation}>
          New
        </button>
        <span style={countStyle}>
          {animations.length} {animations.length === 1 ? 'animation' : 'animations'}
        </span>
      </div>

      <div style={listStyle}>
        {animations.length === 0 && (
          <div style={emptyStyle}>No animations. Create one to start authoring (WP-1.9).</div>
        )}
        {animations.map((animation) => (
          <AnimationRow
            key={animation.id}
            id={animation.id}
            name={animation.name}
            duration={animation.duration}
            isActive={animation.id === activeAnimation}
            hasDuplicateName={duplicateNames.has(animation.name)}
            onSelect={setActiveAnimation}
            onRename={renameAnimation}
            onDuplicate={duplicateAnimation}
            onDelete={deleteAnimation}
            onCommitDuration={commitDuration}
          />
        ))}
      </div>

      {notice !== null && <div style={noticeStyle}>{notice}</div>}
    </div>
  );
}

interface AnimationRowProps {
  readonly id: AnimationId;
  readonly name: string;
  readonly duration: number;
  readonly isActive: boolean;
  readonly hasDuplicateName: boolean;
  readonly onSelect: (id: AnimationId) => void;
  readonly onRename: (id: AnimationId, name: string) => void;
  readonly onDuplicate: (id: AnimationId) => void;
  readonly onDelete: (id: AnimationId) => void;
  readonly onCommitDuration: (id: AnimationId, seconds: number) => boolean;
}

function AnimationRow(props: AnimationRowProps): ReactElement {
  const { id, name, duration, isActive, hasDuplicateName } = props;

  // The name/duration fields are UNCONTROLLED and keyed by their committed value plus this nonce: a
  // committed command changes the prop (so the key changes and the field remounts to the live value), and
  // bumping the nonce remounts to discard an in-progress edit on Escape, an empty/invalid entry, or a
  // rejected duration. This avoids controlled-input resync churn while still reflecting undo/redo/load.
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

  function commitDuration(raw: string): void {
    const trimmed = raw.trim();
    const seconds = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(seconds) || seconds < 0 || seconds === duration) {
      revert();
      return;
    }
    if (!props.onCommitDuration(id, seconds)) revert();
  }

  return (
    <div
      style={isActive ? { ...rowStyle, ...rowActiveStyle } : rowStyle}
      onClick={() => props.onSelect(id)}
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

      {hasDuplicateName && (
        <span
          style={badgeStyle}
          title="Another animation shares this name; export requires unique names."
        >
          !
        </span>
      )}

      <input
        key={`dur:${duration}:${resetNonce}`}
        type="number"
        min={0}
        step={0.1}
        defaultValue={duration}
        style={durationInputStyle}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.currentTarget.value = String(duration);
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => commitDuration(event.currentTarget.value)}
      />
      <span style={unitStyle}>s</span>

      <button
        type="button"
        style={smallButtonStyle}
        title="Duplicate"
        onClick={(event) => {
          event.stopPropagation();
          props.onDuplicate(id);
        }}
      >
        Copy
      </button>
      <button
        type="button"
        style={smallButtonStyle}
        title="Delete"
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

const durationInputStyle: CSSProperties = {
  width: 64,
  flex: '0 0 auto',
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
  fontVariantNumeric: 'tabular-nums',
};

const unitStyle: CSSProperties = { color: '#888888' };

const badgeStyle: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 14,
  textAlign: 'center',
  padding: '0 5px',
  borderRadius: 8,
  fontSize: 10,
  fontWeight: 700,
  color: '#1b1b1b',
  background: '#e0a93b',
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

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a4a2a',
  background: '#3a2f1a',
  color: '#e8c98a',
};
