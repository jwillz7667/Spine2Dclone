import type { IDockviewPanelProps } from 'dockview';
import { useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  DeleteDrawOrderKeyCommand,
  DrawOrderError,
  SetDrawOrderKeyCommand,
  documentHost,
  type SlotId,
} from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  applyDrawOrderOffsets,
  computeDrawOrderOffsets,
  moveInOrder,
} from './draw-order-authoring';

const NOTICE_DURATION_MS = 4000;

// The Draw Order panel (Stage F1, PP-D9): reorder the slots at the playhead and key the result, so a slot
// can pass in front of another over an animation. The reorder is LOCAL editor state (never a document
// mutation); pressing "Key at playhead" commits one SetDrawOrderKeyCommand (one undo step) whose offsets are
// the signed deltas from the setup draw order (computed by the pure draw-order-authoring module). The list
// is seeded from the effective draw order at the playhead (the last key at or before it, else the setup
// order), and re-seeds whenever that baseline changes (a command, an undo, a load, or scrubbing onto a
// different key). LAW 2 and the document/editor wall hold: only the command mutates, and the reorder buffer
// is ephemeral.
export function DrawOrderPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const playhead = usePlaybackStore((state) => state.playhead);

  const slots = useMemo(() => model.slots(), [model, revision]); // in setup draw order
  const setupOrder = useMemo(() => slots.map((slot) => slot.id), [slots]);
  const nameById = useMemo(
    () => new Map(slots.map((slot) => [slot.id, slot.name] as const)),
    [slots],
  );

  const drawKeys = useMemo(() => {
    if (activeAnimation === null) return [];
    return model.getAnimation(activeAnimation)?.drawOrder ?? [];
  }, [activeAnimation, revision, model]);

  // The effective slot order at the playhead: the last draw-order key at or before it applied to the setup
  // order, else the setup order itself. This is the baseline the reorder buffer seeds from.
  const baseline = useMemo<SlotId[]>(() => {
    const effective = drawKeys
      .filter((key) => key.time <= playhead)
      .sort((a, b) => a.time - b.time)
      .pop();
    if (effective === undefined) return setupOrder;
    return applyDrawOrderOffsets(
      setupOrder,
      effective.offsets.map((entry) => ({ slot: entry.slot, offset: entry.offset })),
    );
  }, [drawKeys, playhead, setupOrder]);

  const [desired, setDesired] = useState<readonly SlotId[]>(baseline);
  // Re-seed the reorder buffer only when the baseline ORDER changes, using the render-time "adjust state on
  // input change" pattern (a guarded setState during render): an in-progress reorder survives unrelated
  // re-renders, but a command, an undo, or scrubbing onto a different key refreshes it. Comparing the joined
  // order (not the array identity, which changes every render) is what makes the guard settle.
  const baselineKey = baseline.join(',');
  const seededKey = useRef(baselineKey);
  if (seededKey.current !== baselineKey) {
    seededKey.current = baselineKey;
    setDesired(baseline);
  }

  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = (message: string): void => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  };

  const dirty = desired.join(',') !== setupOrder.join(',') || drawKeys.length > 0;

  function move(id: SlotId, direction: -1 | 1): void {
    setDesired((current) => moveInOrder(current, id, direction));
  }

  // Commit the reordered slots as a draw-order key at the playhead (insert or update). The offsets are the
  // signed deltas from the setup order; an unchanged order yields an empty (identity) key, which restores the
  // setup order at that time. One command == one undo step.
  function keyAtPlayhead(): void {
    if (activeAnimation === null) return;
    const offsets = computeDrawOrderOffsets(setupOrder, desired);
    try {
      documentHost
        .current()
        .history.execute(new SetDrawOrderKeyCommand(activeAnimation, playhead, offsets));
    } catch (error) {
      if (error instanceof DrawOrderError) {
        showNotice('That reorder is not a consistent draw order.');
        return;
      }
      throw error;
    }
  }

  function deleteKey(time: number): void {
    if (activeAnimation === null) return;
    const key = drawKeys.find((entry) => entry.time === time);
    if (key === undefined) return;
    documentHost.current().history.execute(new DeleteDrawOrderKeyCommand(activeAnimation, key.id));
  }

  const canKey = activeAnimation !== null && slots.length > 0;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button
          type="button"
          style={canKey ? buttonStyle : disabledButtonStyle}
          disabled={!canKey}
          onClick={keyAtPlayhead}
          title={
            canKey ? 'Key the current slot order at the playhead' : 'Select an active animation first'
          }
        >
          Key at playhead
        </button>
        <span style={countStyle}>{`${playhead.toFixed(3)} s`}</span>
      </div>

      <div style={captionStyle}>Top draws first (behind); bottom draws last (in front).</div>

      <div style={listStyle}>
        {slots.length === 0 && <div style={emptyStyle}>No slots to reorder.</div>}
        {desired.map((id, index) => (
          <div key={id} style={rowStyle}>
            <span style={indexStyle}>{index}</span>
            <span style={nameStyle}>{nameById.get(id) ?? String(id)}</span>
            <button
              type="button"
              style={index === 0 ? disabledStepStyle : stepButtonStyle}
              disabled={index === 0}
              title="Move toward the back (drawn earlier)"
              onClick={() => move(id, -1)}
            >
              Up
            </button>
            <button
              type="button"
              style={index === desired.length - 1 ? disabledStepStyle : stepButtonStyle}
              disabled={index === desired.length - 1}
              title="Move toward the front (drawn later)"
              onClick={() => move(id, 1)}
            >
              Down
            </button>
          </div>
        ))}
      </div>

      {drawKeys.length > 0 && (
        <div style={keysStyle}>
          <div style={keysTitleStyle}>Draw-order keys</div>
          {[...drawKeys]
            .sort((a, b) => a.time - b.time)
            .map((key) => (
              <div key={key.id} style={keyRowStyle}>
                <button
                  type="button"
                  style={keyTimeStyle}
                  title="Jump the playhead to this key"
                  onClick={() => usePlaybackStore.getState().setPlayhead(key.time)}
                >
                  {`${key.time.toFixed(3)} s`}
                </button>
                <span style={keyCountStyle}>{`${key.offsets.length} moved`}</span>
                <button
                  type="button"
                  style={smallButtonStyle}
                  title="Delete this draw-order key"
                  onClick={() => deleteKey(key.time)}
                >
                  Del
                </button>
              </div>
            ))}
        </div>
      )}

      {dirty && activeAnimation === null && (
        <div style={hintStyle}>Select an animation to key a reorder.</div>
      )}
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

const captionStyle: CSSProperties = {
  padding: '4px 8px',
  color: '#888888',
  borderBottom: '1px solid #262626',
  flex: '0 0 auto',
};

const countStyle: CSSProperties = { marginLeft: 'auto', color: '#888888', fontVariantNumeric: 'tabular-nums' };
const listStyle: CSSProperties = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' };
const emptyStyle: CSSProperties = { color: '#777777', padding: 12 };

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 8px',
  borderBottom: '1px solid #262626',
};

const indexStyle: CSSProperties = {
  width: 20,
  flex: '0 0 auto',
  color: '#777777',
  fontVariantNumeric: 'tabular-nums',
};

const nameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: '#eeeeee',
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

const disabledButtonStyle: CSSProperties = { ...buttonStyle, color: '#666666', cursor: 'default' };

const stepButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '2px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const disabledStepStyle: CSSProperties = { ...stepButtonStyle, color: '#555555', cursor: 'default' };

const smallButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '2px 8px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
};

const keysStyle: CSSProperties = {
  flex: '0 0 auto',
  maxHeight: 140,
  overflowY: 'auto',
  borderTop: '1px solid #333333',
  background: '#202020',
};

const keysTitleStyle: CSSProperties = { padding: '6px 8px 2px', color: '#888888', fontWeight: 600 };

const keyRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
};

const keyTimeStyle: CSSProperties = {
  padding: '2px 6px',
  fontSize: 11,
  color: '#dddddd',
  background: '#2d2d2d',
  border: '1px solid #444444',
  borderRadius: 4,
  cursor: 'pointer',
  fontVariantNumeric: 'tabular-nums',
};

const keyCountStyle: CSSProperties = { flex: '1 1 auto', color: '#888888' };

const hintStyle: CSSProperties = { padding: '6px 8px', color: '#888888', flex: '0 0 auto' };

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a4a2a',
  background: '#3a2f1a',
  color: '#e8c98a',
};
