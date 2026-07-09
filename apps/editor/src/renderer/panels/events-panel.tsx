import type { IDockviewPanelProps } from 'dockview';
import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import {
  DefineEventCommand,
  DeleteEventCommand,
  EventEditError,
  RenameEventCommand,
  SetEventAudioCommand,
  SetEventDefaultsCommand,
  documentHost,
  type EventDefEntity,
  type EventDefId,
} from '../document';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useEventSelectionStore } from '../editor-state/event-selection-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { addEventKeyAtPlayhead } from '../dopesheet/event-track-edit';
import {
  DEFAULT_EVENT_BASENAME,
  buildEventAudio,
  parseOptionalFloat,
  parseOptionalInt,
  parseOptionalString,
  uniqueEventName,
} from './events-logic';

const ACCENT = '#5aa0ff';
const NOTICE_DURATION_MS = 4000;

// The Events panel (Stage F1, PP-D9): define document-level events (their int/float/string payload defaults
// and an optional audio hint), rename/delete them, and select the event the dopesheet fires at the playhead.
// Every mutation routes through a document-core command on the live History (LAW 2); SELECTING an event is
// ephemeral editor state (the event-selection store), never a document mutation (the document/editor wall,
// LAW 1). All parsing/normalization decisions live in the pure events-logic module; this file is glue plus
// styling. The panel polls model.revision and reads live state through documentHost.current() in handlers so
// no handler closes over a stale model.
export function EventsPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const events = useMemo(() => model.eventDefs(), [model, revision]);

  const selectedEventId = useEventSelectionStore((state) => state.selectedEventId);
  const selectEvent = useEventSelectionStore((state) => state.selectEvent);
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);

  const selected = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = (message: string): void => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  };

  // Define a fresh event with a uniquified default name and empty payload, then select it. The id is minted
  // here so redo reuses it.
  function defineEvent(): void {
    const doc = documentHost.current();
    const existingNames = doc.model.eventDefs().map((event) => event.name);
    const id = doc.ids.mint('eventDef');
    doc.history.execute(
      new DefineEventCommand(id, uniqueEventName(existingNames, DEFAULT_EVENT_BASENAME), {
        int: undefined,
        float: undefined,
        string: undefined,
        audio: undefined,
      }),
    );
    selectEvent(id);
  }

  // Rename keeps the same EventDefId, so the selection (and every event key that fires it) survives. A
  // collision with another event name is a USER INPUT boundary: catch the typed error and surface a notice.
  function renameEvent(id: EventDefId, name: string): void {
    try {
      documentHost.current().history.execute(new RenameEventCommand(id, name));
    } catch (error) {
      if (error instanceof EventEditError) {
        showNotice('That event name is already in use.');
        return;
      }
      throw error;
    }
  }

  function deleteEvent(id: EventDefId): void {
    documentHost.current().history.execute(new DeleteEventCommand(id));
    if (useEventSelectionStore.getState().selectedEventId === id) selectEvent(null);
  }

  // Fire the selected event at the current playhead on the active animation, as one undo step.
  function fireAtPlayhead(): void {
    if (selected === null || activeAnimation === null) return;
    const store = usePlaybackStore.getState();
    addEventKeyAtPlayhead(documentHost.current().history, activeAnimation, selected.id, store.playhead);
  }

  const canFire = selected !== null && activeAnimation !== null;

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={defineEvent}>
          New event
        </button>
        <button
          type="button"
          style={canFire ? buttonStyle : disabledButtonStyle}
          disabled={!canFire}
          title={
            canFire
              ? 'Fire the selected event at the playhead on the active animation'
              : 'Select an event and an active animation first'
          }
          onClick={fireAtPlayhead}
        >
          Fire at playhead
        </button>
        <span style={countStyle}>
          {events.length} {events.length === 1 ? 'event' : 'events'}
        </span>
      </div>

      <div style={listStyle}>
        {events.length === 0 && (
          <div style={emptyStyle}>No events. Define one, then fire it on an animation.</div>
        )}
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            isSelected={event.id === selectedEventId}
            onSelect={selectEvent}
            onRename={renameEvent}
            onDelete={deleteEvent}
          />
        ))}
      </div>

      {selected !== null && (
        <EventEditor key={`${selected.id}:${revision}`} event={selected} onNotice={showNotice} />
      )}

      {notice !== null && <div style={noticeStyle}>{notice}</div>}
    </div>
  );
}

interface EventRowProps {
  readonly event: EventDefEntity;
  readonly isSelected: boolean;
  readonly onSelect: (id: EventDefId) => void;
  readonly onRename: (id: EventDefId, name: string) => void;
  readonly onDelete: (id: EventDefId) => void;
}

function EventRow({ event, isSelected, onSelect, onRename, onDelete }: EventRowProps): ReactElement {
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);

  function commitName(raw: string): void {
    const next = raw.trim();
    if (next === '' || next === event.name) {
      revert();
      return;
    }
    onRename(event.id, next);
  }

  return (
    <div
      style={isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle}
      onClick={() => onSelect(event.id)}
    >
      <input
        key={`name:${event.name}:${resetNonce}`}
        type="text"
        defaultValue={event.name}
        spellCheck={false}
        style={nameInputStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            e.currentTarget.value = event.name;
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => commitName(e.currentTarget.value)}
      />
      {event.audio !== undefined && (
        <span style={audioBadgeStyle} title={`audio: ${event.audio.path}`}>
          audio
        </span>
      )}
      <button
        type="button"
        style={smallButtonStyle}
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(event.id);
        }}
      >
        Del
      </button>
    </div>
  );
}

interface EventEditorProps {
  readonly event: EventDefEntity;
  readonly onNotice: (message: string) => void;
}

// The payload-default and audio-hint editor for the SELECTED event. Each field commits INDEPENDENTLY,
// composing its new value with the event's OTHER current committed values (read from the entity), so a
// single field edit never disturbs the others. Keyed by (event id + revision) in the parent, so undo/redo
// or a rename re-seeds the fields from the live entity.
function EventEditor({ event, onNotice }: EventEditorProps): ReactElement {
  function setDefaults(next: {
    readonly int: number | undefined;
    readonly float: number | undefined;
    readonly string: string | undefined;
  }): void {
    documentHost.current().history.execute(new SetEventDefaultsCommand(event.id, next));
  }

  function commitInt(raw: string): void {
    setDefaults({ int: parseOptionalInt(raw), float: event.float, string: event.string });
  }
  function commitFloat(raw: string): void {
    setDefaults({ int: event.int, float: parseOptionalFloat(raw), string: event.string });
  }
  function commitString(raw: string): void {
    setDefaults({ int: event.int, float: event.float, string: parseOptionalString(raw) });
  }

  // Rebuild the whole audio hint from the current path/volume/balance committed values plus the one field
  // that changed, so an out-of-range value is clamped in events-logic and the command never rejects it. An
  // emptied path clears the hint. SetEventAudio still validates range as a fail-loud backstop.
  function commitAudio(field: 'path' | 'volume' | 'balance', raw: string): void {
    const audio = event.audio;
    const pathRaw = field === 'path' ? raw : (audio?.path ?? '');
    const volumeRaw = field === 'volume' ? raw : (audio?.volume.toString() ?? '');
    const balanceRaw = field === 'balance' ? raw : (audio?.balance.toString() ?? '');
    try {
      documentHost
        .current()
        .history.execute(
          new SetEventAudioCommand(event.id, buildEventAudio(pathRaw, volumeRaw, balanceRaw)),
        );
    } catch (error) {
      if (error instanceof EventEditError) {
        onNotice('Audio volume must be 0 to 1 and balance -1 to 1.');
        return;
      }
      throw error;
    }
  }

  return (
    <div style={editorStyle}>
      <div style={editorTitleStyle}>{event.name}</div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>int</span>
        <input
          type="number"
          step={1}
          defaultValue={event.int ?? ''}
          style={fieldInputStyle}
          onBlur={(e) => commitInt(e.currentTarget.value)}
        />
        <span style={fieldLabelStyle}>float</span>
        <input
          type="number"
          step="any"
          defaultValue={event.float ?? ''}
          style={fieldInputStyle}
          onBlur={(e) => commitFloat(e.currentTarget.value)}
        />
      </div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>string</span>
        <input
          type="text"
          spellCheck={false}
          defaultValue={event.string ?? ''}
          style={{ ...fieldInputStyle, flex: '1 1 auto' }}
          onBlur={(e) => commitString(e.currentTarget.value)}
        />
      </div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>audio</span>
        <input
          type="text"
          spellCheck={false}
          placeholder="path (empty clears)"
          defaultValue={event.audio?.path ?? ''}
          style={{ ...fieldInputStyle, flex: '1 1 auto' }}
          onBlur={(e) => commitAudio('path', e.currentTarget.value)}
        />
      </div>
      <div style={fieldRowStyle}>
        <span style={fieldLabelStyle}>vol</span>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          defaultValue={event.audio?.volume ?? ''}
          style={fieldInputStyle}
          onBlur={(e) => commitAudio('volume', e.currentTarget.value)}
        />
        <span style={fieldLabelStyle}>bal</span>
        <input
          type="number"
          min={-1}
          max={1}
          step={0.05}
          defaultValue={event.audio?.balance ?? ''}
          style={fieldInputStyle}
          onBlur={(e) => commitAudio('balance', e.currentTarget.value)}
        />
      </div>
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

const audioBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '0 6px',
  borderRadius: 8,
  fontSize: 10,
  fontWeight: 700,
  color: '#1b1b1b',
  background: '#6fbf73',
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

const disabledButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: '#666666',
  cursor: 'default',
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

const editorStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px',
  borderTop: '1px solid #333333',
  background: '#202020',
};

const editorTitleStyle: CSSProperties = { fontWeight: 600, color: '#eeeeee' };
const fieldRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const fieldLabelStyle: CSSProperties = { width: 34, color: '#888888', flex: '0 0 auto' };

const fieldInputStyle: CSSProperties = {
  width: 80,
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
  fontVariantNumeric: 'tabular-nums',
};

const noticeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '6px 8px',
  borderTop: '1px solid #5a4a2a',
  background: '#3a2f1a',
  color: '#e8c98a',
};
