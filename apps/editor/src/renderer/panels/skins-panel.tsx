import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, type CSSProperties, type ReactElement } from 'react';
import type { AtlasRegion } from '@marionette/format/types';
import {
  CreateSkinCommand,
  DeleteSkinCommand,
  RemoveSkinAttachmentCommand,
  RenameSkinCommand,
  SetSkinAttachmentCommand,
  documentHost,
  type SkinEntity,
  type SkinId,
  type SlotEntity,
} from '../document';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { DEFAULT_SKIN_NAME, useSkinPreviewStore } from '../editor-state/skin-preview-store';
import {
  duplicateSkinName,
  isKnownSkin,
  previewAfterDelete,
  previewAfterRename,
  skinRegionEntity,
  uniqueSkinName,
} from './skins-logic';

const ACCENT = '#5aa0ff';

// The Skins panel (PP-D4). Manages named skins (create / rename / duplicate / delete) over the five skin
// commands and assigns per-slot attachment OVERRIDES in a selected skin; the implicit 'default' skin is
// listed for PREVIEW but edited through the inspector (its attachments ARE the default-slot attachments).
// Every document change routes through a document-core command on the live History (LAW 2). The ACTIVE
// skin the viewport renders is ephemeral EDITOR state (the skin-preview store, the document/editor wall,
// LAW 1): selecting a skin here sets the preview and the viewport re-renders it through the runtime SkinState.
// Duplicate copies the source assignments in ONE interaction session (one undo step), expressible without a
// new command. The panel polls model.revision (like the other panels) so it refreshes after any command,
// undo/redo, or an external change, and reconciles the ephemeral preview when the previewed skin is renamed
// or removed.
export function SkinsPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const previewName = useSkinPreviewStore((state) => state.activeSkin);

  const skins = useMemo(() => model.skins(), [model, revision]);
  const slots = useMemo(() => model.slots(), [model, revision]);
  const atlasRegions = useMemo(
    () => model.preserved().atlas.pages.flatMap((page) => page.regions),
    [model, revision],
  );
  const skinNames = useMemo(() => skins.map((skin) => skin.name), [skins]);

  // Reset a dangling preview to default when the previewed skin no longer resolves (a delete/undo the panel
  // did not drive). Reads/writes the ephemeral store only (the document/editor wall).
  useEffect(() => {
    if (!isKnownSkin(previewName, skinNames)) {
      useSkinPreviewStore.getState().reset();
    }
  }, [previewName, skinNames]);

  // The skin currently selected for EDITING is the previewed named skin (default has no editor here).
  const selectedSkin = useMemo(
    () => skins.find((skin) => skin.name === previewName),
    [skins, previewName],
  );

  return (
    <div style={rootStyle}>
      <div style={toolbarStyle}>
        <button type="button" style={buttonStyle} onClick={() => createSkin()}>
          New Skin
        </button>
        <span style={countStyle}>
          {skins.length} {skins.length === 1 ? 'skin' : 'skins'}
        </span>
      </div>

      <div style={listStyle}>
        <SkinRow
          name={DEFAULT_SKIN_NAME}
          isSelected={previewName === DEFAULT_SKIN_NAME}
          isDefault
          onSelect={() => selectSkin(DEFAULT_SKIN_NAME)}
        />
        {skins.map((skin) => (
          <SkinRow
            key={skin.id}
            name={skin.name}
            isSelected={previewName === skin.name}
            isDefault={false}
            onSelect={() => selectSkin(skin.name)}
            onRename={(next) => renameSkin(skin, next, skinNames)}
            onDuplicate={() => duplicateSkin(skin, skinNames)}
            onDelete={() => deleteSkin(skin)}
          />
        ))}
      </div>

      <div style={detailStyle}>
        {selectedSkin === undefined ? (
          <div style={emptyStyle}>
            {previewName === DEFAULT_SKIN_NAME
              ? 'The default skin is previewed. Edit its attachments in the Inspector; create a skin to author a costume override.'
              : 'Select a skin to assign per-slot attachment overrides.'}
          </div>
        ) : (
          <SkinAssignments skin={selectedSkin} slots={slots} atlasRegions={atlasRegions} />
        )}
      </div>
    </div>
  );
}

// Module-scope command dispatch (mirrors inspector-panel). Each reads the LIVE document through
// documentHost.current() so nothing closes over a stale model, routes every change through History (LAW 2),
// and keeps the ephemeral preview coherent through the pure reconcilers.

function selectSkin(name: string): void {
  useSkinPreviewStore.getState().setActiveSkin(name);
}

function createSkin(): void {
  const doc = documentHost.current();
  const id = doc.ids.mint('skin');
  const name = uniqueSkinName(doc.model.skins().map((skin) => skin.name));
  doc.history.execute(new CreateSkinCommand(id, name));
  useSkinPreviewStore.getState().setActiveSkin(name);
}

function renameSkin(skin: SkinEntity, next: string, existingNames: readonly string[]): boolean {
  const trimmed = next.trim();
  if (trimmed === '' || trimmed === skin.name || existingNames.includes(trimmed)) return false;
  documentHost.current().history.execute(new RenameSkinCommand(skin.id, trimmed));
  const store = useSkinPreviewStore.getState();
  store.setActiveSkin(previewAfterRename(skin.name, trimmed, store.activeSkin));
  return true;
}

// Duplicate = create a new skin then copy every assignment from the source, all in ONE interaction session
// so the whole duplication is a single undo step (no dedicated composite command needed).
function duplicateSkin(source: SkinEntity, existingNames: readonly string[]): void {
  const doc = documentHost.current();
  const id = doc.ids.mint('skin');
  const name = duplicateSkinName(existingNames, source.name);
  doc.history.beginInteraction();
  try {
    doc.history.execute(new CreateSkinCommand(id, name));
    for (const [slotId, byName] of source.attachments) {
      for (const [, entity] of byName) {
        doc.history.execute(new SetSkinAttachmentCommand(id, slotId, entity));
      }
    }
  } finally {
    doc.history.endInteraction('Duplicate Skin');
  }
  useSkinPreviewStore.getState().setActiveSkin(name);
}

function deleteSkin(skin: SkinEntity): void {
  documentHost.current().history.execute(new DeleteSkinCommand(skin.id));
  const store = useSkinPreviewStore.getState();
  store.setActiveSkin(previewAfterDelete(skin.name, store.activeSkin));
}

function assignSkinAttachment(skinId: SkinId, slot: SlotEntity, region: AtlasRegion): void {
  if (slot.attachment === null) return;
  documentHost
    .current()
    .history.execute(
      new SetSkinAttachmentCommand(skinId, slot.id, skinRegionEntity(slot.attachment, region)),
    );
}

function removeSkinAttachment(skinId: SkinId, slot: SlotEntity, name: string): void {
  documentHost.current().history.execute(new RemoveSkinAttachmentCommand(skinId, slot.id, name));
}

interface SkinRowProps {
  readonly name: string;
  readonly isSelected: boolean;
  readonly isDefault: boolean;
  readonly onSelect: () => void;
  readonly onRename?: (next: string) => boolean;
  readonly onDuplicate?: () => void;
  readonly onDelete?: () => void;
}

function SkinRow(props: SkinRowProps): ReactElement {
  const { name, isSelected, isDefault, onSelect, onRename, onDuplicate, onDelete } = props;
  return (
    <div style={isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle} onClick={onSelect}>
      <span style={nameStyle}>
        {name}
        {isDefault && <span style={badgeStyle}>base</span>}
      </span>
      {isSelected && <span style={previewBadgeStyle}>previewing</span>}
      {!isDefault && onRename !== undefined && (
        <input
          type="text"
          defaultValue={name}
          key={name}
          spellCheck={false}
          style={renameInputStyle}
          title="Rename skin"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            else if (event.key === 'Escape') {
              event.currentTarget.value = name;
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => {
            if (!onRename(event.currentTarget.value)) event.currentTarget.value = name;
          }}
        />
      )}
      {!isDefault && onDuplicate !== undefined && (
        <button
          type="button"
          style={smallButtonStyle}
          title="Duplicate this skin and its assignments"
          onClick={(event) => {
            event.stopPropagation();
            onDuplicate();
          }}
        >
          Dup
        </button>
      )}
      {!isDefault && onDelete !== undefined && (
        <button
          type="button"
          style={smallButtonStyle}
          title="Delete skin"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}

interface SkinAssignmentsProps {
  readonly skin: SkinEntity;
  readonly slots: readonly SlotEntity[];
  readonly atlasRegions: readonly AtlasRegion[];
}

// The assignment editor for one skin: every slot that has an active (placeholder) attachment can override
// it with an atlas region in this skin. A live skin switch then swaps the override in for that placeholder.
function SkinAssignments(props: SkinAssignmentsProps): ReactElement {
  const { skin, slots, atlasRegions } = props;
  const placeholders = slots.filter((slot) => slot.attachment !== null);

  return (
    <div style={detailBodyStyle}>
      <div style={subHeaderStyle}>Skin: {skin.name}</div>
      {placeholders.length === 0 && (
        <div style={emptyStyle}>
          No slot has an active attachment yet. Set a slot attachment in the Inspector, then override it here.
        </div>
      )}
      {placeholders.map((slot) => {
        const placeholder = slot.attachment ?? '';
        const override = skin.attachments.get(slot.id)?.get(placeholder);
        return (
          <div key={slot.id} style={assignRowStyle}>
            <span style={slotNameStyle}>{slot.name}</span>
            <span style={placeholderStyle}>{placeholder}</span>
            {override !== undefined ? (
              <span style={overrideStyle}>
                {override.kind === 'region' ? override.path : override.kind}
              </span>
            ) : (
              <span style={inheritStyle}>(inherits default)</span>
            )}
            {atlasRegions.length > 0 ? (
              <select
                style={selectStyle}
                value=""
                title="Assign a region override in this skin"
                onChange={(event) => {
                  const region = atlasRegions.find((r) => r.name === event.target.value);
                  if (region !== undefined) assignSkinAttachment(skin.id, slot, region);
                }}
              >
                <option value="">Assign region...</option>
                {atlasRegions.map((region) => (
                  <option key={region.name} value={region.name}>
                    {region.name}
                  </option>
                ))}
              </select>
            ) : (
              <span style={inheritStyle}>import an atlas</span>
            )}
            {override !== undefined && (
              <button
                type="button"
                style={smallButtonStyle}
                title="Remove this override (the slot inherits the default skin)"
                onClick={() => removeSkinAttachment(skin.id, slot, placeholder)}
              >
                Remove
              </button>
            )}
          </div>
        );
      })}
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

const listStyle: CSSProperties = { flex: '0 0 auto', maxHeight: '40%', overflowY: 'auto' };

const detailStyle: CSSProperties = {
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  borderTop: '1px solid #333333',
};

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

const nameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#eeeeee',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const badgeStyle: CSSProperties = {
  fontSize: 10,
  color: '#8899aa',
  border: '1px solid #3a4a5a',
  borderRadius: 3,
  padding: '0 4px',
};

const previewBadgeStyle: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 10,
  color: ACCENT,
};

const renameInputStyle: CSSProperties = {
  flex: '0 0 96px',
  fontSize: 11,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
};

const detailBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
};

const subHeaderStyle: CSSProperties = {
  color: '#cccccc',
  fontWeight: 600,
  paddingBottom: 4,
  borderBottom: '1px solid #2c2c2c',
};

const assignRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const slotNameStyle: CSSProperties = { flex: '0 0 auto', color: '#eeeeee', minWidth: 64 };

const placeholderStyle: CSSProperties = { flex: '0 0 auto', color: '#8899aa' };

const overrideStyle: CSSProperties = { flex: '0 0 auto', color: '#7ad07a' };

const inheritStyle: CSSProperties = { flex: '0 0 auto', color: '#777777' };

const selectStyle: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 11,
  color: '#dddddd',
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
