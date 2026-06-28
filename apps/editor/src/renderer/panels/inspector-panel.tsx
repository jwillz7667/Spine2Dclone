import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { AtlasRegion, BlendMode, RGBA } from '@marionette/format/types';
import {
  AddRegionAttachmentCommand,
  CreateSlotCommand,
  DeleteSlotCommand,
  RemoveAttachmentCommand,
  RenameSlotCommand,
  ReorderSlotCommand,
  SetActiveAttachmentCommand,
  SetRegionAttachmentTransformCommand,
  SetSlotBlendModeCommand,
  SetSlotColorCommand,
  documentHost,
  type AttachmentEntity,
  type RegionAttachmentEntity,
  type RegionTransform,
  type SlotEntity,
  type SlotId,
} from '../document';
import { useSelectionStore } from '../editor-state/selection-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import {
  nextSlotAfterDelete,
  parseChannel,
  parseFinite,
  regionAttachmentDefaults,
  reorderTarget,
  uniqueAttachmentName,
  uniqueSlotName,
} from './inspector-logic';

const ACCENT = '#5aa0ff';
const BLEND_MODES: readonly BlendMode[] = ['normal', 'additive', 'multiply', 'screen'];

// A fresh white tint per call: CreateSlotCommand stores the color by reference (it does not clone, unlike
// the attachment commands), so each new slot must get its own object to avoid aliasing one shared color.
function whiteColor(): RGBA {
  return { r: 1, g: 1, b: 1, a: 1 };
}

type ColorChannel = 'r' | 'g' | 'b' | 'a';
type TransformField = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'width' | 'height';

// The slot/attachment inspector (WP-1.2, editor half): the SLOT LIST (always visible, in draw order) plus
// the SELECTED-SLOT detail (rename, color, blend, active attachment, attachments, add region). Every
// document change routes through a document-core command on the live History (LAW 2); SELECTING a slot is
// ephemeral editor state in the slot-selection store (the document/editor wall, LAW 1), so it never
// touches History. The panel polls model.revision (like the other panels) to re-render after any command
// (including undo/redo and edits made elsewhere, e.g. a bone delete cascading its slots), and reads live
// state through documentHost.current() inside handlers so no handler closes over a stale model. All naming,
// parsing, draw-order, and the trim-offset placement DECISIONS live in the pure inspector-logic module;
// this file is glue plus styling. The command-dispatch handlers are module-scope (they need only the
// documentHost/store singletons plus their arguments), which keeps the components prop-light.
export function InspectorPanel(_props: IDockviewPanelProps): ReactElement {
  const revision = useDocumentRevision();
  const model = documentHost.current().model;
  const selectedSlotId = useSlotSelectionStore((state) => state.selectedSlotId);

  const slots = useMemo(() => model.slots(), [model, revision]);
  const boneCount = useMemo(() => model.bones().length, [model, revision]);
  const atlasRegions = useMemo(
    () => model.preserved().atlas.pages.flatMap((page) => page.regions),
    [model, revision],
  );

  // The selected slot resolved against the LIVE model: undefined when nothing is selected, or when the
  // selected slot was deleted/undone away (a bone delete cascades its slots, undo removes a created slot).
  // Slot ids are minted monotonically and never reused, so a stale id never aliases a different slot.
  const selectedSlot = useMemo(
    () => (selectedSlotId !== null ? model.getSlot(selectedSlotId) : undefined),
    [model, revision, selectedSlotId],
  );
  const attachments = useMemo(
    () => (selectedSlotId !== null ? model.attachments(selectedSlotId) : []),
    [model, revision, selectedSlotId],
  );

  // Prune a selection that no longer resolves (the inspector's own DeleteSlot reconciles via
  // nextSlotAfterDelete; this clears it after an EXTERNAL removal, e.g. a cascaded bone delete or an undo).
  useEffect(() => {
    if (selectedSlotId !== null && model.getSlot(selectedSlotId) === undefined) {
      useSlotSelectionStore.getState().clearSlot();
    }
  }, [model, revision, selectedSlotId]);

  const selectedSet = useMemo(() => new Set(slots.map((slot) => slot.id)), [slots]);

  return (
    <div style={rootStyle}>
      <div style={sectionStyle}>
        <div style={toolbarStyle}>
          <button
            type="button"
            style={boneCount > 0 ? buttonStyle : { ...buttonStyle, ...buttonDisabledStyle }}
            disabled={boneCount === 0}
            title={boneCount === 0 ? 'Add a bone first: a slot must ride a bone.' : 'Create a slot'}
            onClick={createSlot}
          >
            New Slot
          </button>
          <span style={countStyle}>
            {slots.length} {slots.length === 1 ? 'slot' : 'slots'}
          </span>
        </div>

        <div style={listStyle}>
          {slots.length === 0 && (
            <div style={emptyStyle}>
              {boneCount === 0
                ? 'No bones yet. Add a bone, then create a slot to attach a sprite (WP-1.2).'
                : 'No slots. Create one to attach a sprite (WP-1.2).'}
            </div>
          )}
          {slots.map((slot, index) => (
            <SlotListRow
              key={slot.id}
              slot={slot}
              index={index}
              count={slots.length}
              boneName={model.getBone(slot.bone)?.name ?? '(no bone)'}
              isSelected={selectedSet.has(slot.id) && slot.id === selectedSlotId}
            />
          ))}
        </div>
      </div>

      <div style={detailSectionStyle}>
        {selectedSlot === undefined ? (
          <div style={emptyStyle}>
            Select a slot to edit its color, attachments, and draw order.
          </div>
        ) : (
          <SlotDetail slot={selectedSlot} attachments={attachments} atlasRegions={atlasRegions} />
        )}
      </div>
    </div>
  );
}

// Module-scope command dispatch. Each reads the LIVE document through documentHost.current() so nothing
// closes over a stale model, and routes every document change through History (LAW 2). Selecting and the
// post-delete reconcile touch the ephemeral slot-selection store only (the document/editor wall, LAW 1).

function selectSlotRow(id: SlotId): void {
  useSlotSelectionStore.getState().selectSlot(id);
}

// Create a slot riding the currently selected bone, or the first bone when none is selected. The button is
// disabled when there are no bones; this returns defensively in that case. The id is minted here so redo
// reuses it; the default name is uniquified against the live slot names. The new slot is selected
// explicitly (the DocumentHost reconciler drives the BONE store only, not this one), mirroring how the
// animation panel activates a freshly created animation.
function createSlot(): void {
  const doc = documentHost.current();
  const first = doc.model.bones()[0];
  if (first === undefined) return;
  const selectedBone = useSelectionStore.getState().selectedBoneIds[0];
  const bone = selectedBone ?? first.id;
  const existingNames = doc.model.slots().map((slot) => slot.name);
  const id = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(id, {
      name: uniqueSlotName(existingNames),
      bone,
      color: whiteColor(),
      darkColor: null,
      attachment: null,
      blendMode: 'normal',
    }),
  );
  useSlotSelectionStore.getState().selectSlot(id);
}

// Delete through History (cascades the slot's attachments and tracks in ONE undo step), then reconcile the
// EPHEMERAL selection from the POST-command model (read AFTER execute), never inside the command.
function deleteSlot(id: SlotId): void {
  const doc = documentHost.current();
  doc.history.execute(new DeleteSlotCommand(id));
  const remaining = doc.model.slots().map((slot) => slot.id);
  const current = useSlotSelectionStore.getState().selectedSlotId;
  useSlotSelectionStore.getState().selectSlot(nextSlotAfterDelete(remaining, id, current));
}

// Move a slot one step in the draw order. reorderTarget clamps and returns the current index at the ends,
// which we skip so a no-op never creates an undo entry. The command is a discrete step (own undo).
function reorderSlot(id: SlotId, direction: -1 | 1): void {
  const doc = documentHost.current();
  const order = doc.model.slots();
  const currentIndex = order.findIndex((slot) => slot.id === id);
  if (currentIndex < 0) return;
  const target = reorderTarget(currentIndex, direction, order.length);
  if (target === currentIndex) return;
  doc.history.execute(new ReorderSlotCommand(id, target));
}

function renameSlot(id: SlotId, name: string): void {
  documentHost.current().history.execute(new RenameSlotCommand(id, name));
}

function setSlotBlend(id: SlotId, mode: BlendMode): void {
  documentHost.current().history.execute(new SetSlotBlendModeCommand(id, mode));
}

function setActiveAttachment(id: SlotId, name: string | null): void {
  documentHost.current().history.execute(new SetActiveAttachmentCommand(id, name));
}

function removeAttachment(slotId: SlotId, name: string): void {
  documentHost.current().history.execute(new RemoveAttachmentCommand(slotId, name));
}

// Commit a slot color edit inside a coalescing interaction session (mirrors the animation panel's
// commitDuration / MoveBone): SetSlotColorCommand coalesces same-target edits, so a continuous nudge/scrub
// folds to ONE undo step; a discrete field blur is its own step.
function commitSlotColor(id: SlotId, color: RGBA): void {
  const history = documentHost.current().history;
  history.beginInteraction();
  try {
    history.execute(new SetSlotColorCommand(id, color));
  } finally {
    history.endInteraction('Set Slot Color');
  }
}

// Add a region attachment, defaulting its name to the region name uniquified per slot, its path to the
// region name, and its placement/size to the trim-offset defaults so a trimmed sprite lands where its
// untrimmed original sat (regionAttachmentDefaults). Discrete step.
function addRegionAttachment(slotId: SlotId, region: AtlasRegion): void {
  const doc = documentHost.current();
  const existing = doc.model.attachments(slotId).map((attachment) => attachment.name);
  doc.history.execute(
    new AddRegionAttachmentCommand(slotId, {
      name: uniqueAttachmentName(existing, region.name),
      path: region.name,
      ...regionAttachmentDefaults(region),
    }),
  );
}

// Commit a region-attachment transform edit inside a coalescing session (mirrors commitSlotColor):
// SetRegionAttachmentTransformCommand coalesces same (slot, name) edits, so a drag/scrub folds to one undo.
function commitRegionTransform(slotId: SlotId, name: string, transform: RegionTransform): void {
  const history = documentHost.current().history;
  history.beginInteraction();
  try {
    history.execute(new SetRegionAttachmentTransformCommand(slotId, name, transform));
  } finally {
    history.endInteraction('Set Attachment Transform');
  }
}

// Resolve a select value to a BlendMode without an unsafe cast (the options are exactly BLEND_MODES).
function toBlendMode(value: string): BlendMode | null {
  return BLEND_MODES.find((mode) => mode === value) ?? null;
}

function withChannel(color: RGBA, channel: ColorChannel, next: number): RGBA {
  return {
    r: channel === 'r' ? next : color.r,
    g: channel === 'g' ? next : color.g,
    b: channel === 'b' ? next : color.b,
    a: channel === 'a' ? next : color.a,
  };
}

function withTransformField(
  attachment: RegionAttachmentEntity,
  field: TransformField,
  next: number,
): RegionTransform {
  return {
    x: field === 'x' ? next : attachment.x,
    y: field === 'y' ? next : attachment.y,
    rotation: field === 'rotation' ? next : attachment.rotation,
    scaleX: field === 'scaleX' ? next : attachment.scaleX,
    scaleY: field === 'scaleY' ? next : attachment.scaleY,
    width: field === 'width' ? next : attachment.width,
    height: field === 'height' ? next : attachment.height,
  };
}

interface SlotListRowProps {
  readonly slot: SlotEntity;
  readonly index: number;
  readonly count: number;
  readonly boneName: string;
  readonly isSelected: boolean;
}

function SlotListRow(props: SlotListRowProps): ReactElement {
  const { slot, index, count, boneName, isSelected } = props;
  return (
    <div
      style={isSelected ? { ...rowStyle, ...rowActiveStyle } : rowStyle}
      onClick={() => selectSlotRow(slot.id)}
    >
      <span style={rowNameStyle}>{slot.name}</span>
      <span style={rowBoneStyle}>{boneName}</span>
      <button
        type="button"
        style={index === 0 ? { ...smallButtonStyle, ...buttonDisabledStyle } : smallButtonStyle}
        disabled={index === 0}
        title="Move earlier in draw order"
        onClick={(event) => {
          event.stopPropagation();
          reorderSlot(slot.id, -1);
        }}
      >
        Up
      </button>
      <button
        type="button"
        style={
          index === count - 1 ? { ...smallButtonStyle, ...buttonDisabledStyle } : smallButtonStyle
        }
        disabled={index === count - 1}
        title="Move later in draw order"
        onClick={(event) => {
          event.stopPropagation();
          reorderSlot(slot.id, 1);
        }}
      >
        Down
      </button>
    </div>
  );
}

interface SlotDetailProps {
  readonly slot: SlotEntity;
  readonly attachments: readonly AttachmentEntity[];
  readonly atlasRegions: readonly AtlasRegion[];
}

function SlotDetail(props: SlotDetailProps): ReactElement {
  const { slot, attachments, atlasRegions } = props;
  const { color } = slot;

  function commitName(raw: string): boolean {
    const next = raw.trim();
    if (next === '' || next === slot.name) return false;
    renameSlot(slot.id, next);
    return true;
  }

  // Read the LIVE color so a run of single-channel edits composes correctly; revert (return false) when the
  // parsed, clamped value is unchanged so the field re-syncs to the live value.
  function commitChannel(channel: ColorChannel, raw: string): boolean {
    const live = documentHost.current().model.getSlot(slot.id);
    if (live === undefined) return false;
    const current = live.color[channel];
    const next = parseChannel(raw, current);
    if (next === current) return false;
    commitSlotColor(slot.id, withChannel(live.color, channel, next));
    return true;
  }

  const swatch = `rgba(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)}, ${color.a})`;

  return (
    <div style={detailBodyStyle}>
      <div style={detailRowStyle}>
        <span style={labelStyle}>Name</span>
        <NameField value={slot.name} onCommit={commitName} style={nameInputStyle} />
        <button
          type="button"
          style={smallButtonStyle}
          title="Delete slot"
          onClick={() => deleteSlot(slot.id)}
        >
          Delete
        </button>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Color</span>
        <ColorField channel="r" value={color.r} onCommit={commitChannel} />
        <ColorField channel="g" value={color.g} onCommit={commitChannel} />
        <ColorField channel="b" value={color.b} onCommit={commitChannel} />
        <ColorField channel="a" value={color.a} onCommit={commitChannel} />
        <span style={{ ...swatchStyle, background: swatch }} title={swatch} />
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Blend</span>
        <select
          style={selectStyle}
          value={slot.blendMode}
          onChange={(event) => {
            const mode = toBlendMode(event.target.value);
            if (mode !== null) setSlotBlend(slot.id, mode);
          }}
        >
          {BLEND_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Active</span>
        <select
          style={selectStyle}
          value={slot.attachment ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setActiveAttachment(slot.id, value === '' ? null : value);
          }}
        >
          <option value="">(none)</option>
          {attachments.map((attachment) => (
            <option key={attachment.name} value={attachment.name}>
              {attachment.name}
            </option>
          ))}
        </select>
      </div>

      <div style={subHeaderStyle}>
        <span>Attachments</span>
        <span style={countStyle}>
          {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'}
        </span>
      </div>

      {attachments.length === 0 && (
        <div style={emptyStyle}>No attachments. Add a region from the atlas below.</div>
      )}
      {attachments.map((attachment) => (
        <AttachmentRow key={attachment.name} slotId={slot.id} attachment={attachment} />
      ))}

      <AddRegionControl slotId={slot.id} atlasRegions={atlasRegions} />
    </div>
  );
}

interface AttachmentRowProps {
  readonly slotId: SlotId;
  readonly attachment: AttachmentEntity;
}

function AttachmentRow(props: AttachmentRowProps): ReactElement {
  const { slotId, attachment } = props;

  // Preserved (non-region) attachments are shown read-only: Phase 1 authors region attachments only and
  // never edits a preserved one (it round-trips verbatim).
  if (attachment.kind === 'preserved') {
    return (
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{attachment.name}</span>
        <span style={rowBoneStyle}>preserved, read only</span>
      </div>
    );
  }

  // Mesh attachments (WP-2.1) are listed read-only here: the document model and commands edit them, but
  // their dedicated authoring surface is the viewport mesh tooling, not this region transform grid.
  if (attachment.kind === 'mesh') {
    return (
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{attachment.name}</span>
        <span style={rowBoneStyle}>{attachment.path} (mesh)</span>
      </div>
    );
  }

  function commitField(field: TransformField, raw: string): boolean {
    const live = documentHost.current().model.getAttachment(slotId, attachment.name);
    if (live === undefined || live.kind !== 'region') return false;
    const current = live[field];
    const next = parseFinite(raw, current);
    if (next === current) return false;
    commitRegionTransform(slotId, attachment.name, withTransformField(live, field, next));
    return true;
  }

  return (
    <div style={attachmentBlockStyle}>
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{attachment.name}</span>
        <span style={rowBoneStyle}>{attachment.path}</span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Remove attachment"
          onClick={() => removeAttachment(slotId, attachment.name)}
        >
          Remove
        </button>
      </div>
      <div style={transformGridStyle}>
        <TransformField field="x" label="X" value={attachment.x} step={1} onCommit={commitField} />
        <TransformField field="y" label="Y" value={attachment.y} step={1} onCommit={commitField} />
        <TransformField
          field="rotation"
          label="Rot"
          value={attachment.rotation}
          step={1}
          onCommit={commitField}
        />
        <TransformField
          field="scaleX"
          label="SX"
          value={attachment.scaleX}
          step={0.1}
          onCommit={commitField}
        />
        <TransformField
          field="scaleY"
          label="SY"
          value={attachment.scaleY}
          step={0.1}
          onCommit={commitField}
        />
        <TransformField
          field="width"
          label="W"
          value={attachment.width}
          step={1}
          onCommit={commitField}
        />
        <TransformField
          field="height"
          label="H"
          value={attachment.height}
          step={1}
          onCommit={commitField}
        />
      </div>
    </div>
  );
}

interface AddRegionControlProps {
  readonly slotId: SlotId;
  readonly atlasRegions: readonly AtlasRegion[];
}

function AddRegionControl(props: AddRegionControlProps): ReactElement {
  const { slotId, atlasRegions } = props;
  if (atlasRegions.length === 0) {
    return <div style={emptyStyle}>Import an atlas in the Assets panel first.</div>;
  }
  return (
    <div style={detailRowStyle}>
      <span style={labelStyle}>Add region</span>
      <select
        style={selectStyle}
        value=""
        onChange={(event) => {
          const region = atlasRegions.find((candidate) => candidate.name === event.target.value);
          if (region !== undefined) addRegionAttachment(slotId, region);
        }}
      >
        <option value="">Pick a region...</option>
        {atlasRegions.map((region) => (
          <option key={region.name} value={region.name}>
            {region.name} ({region.w}x{region.h})
          </option>
        ))}
      </select>
    </div>
  );
}

interface NameFieldProps {
  readonly value: string;
  readonly onCommit: (raw: string) => boolean;
  readonly style: CSSProperties;
}

// Uncontrolled text input keyed by its committed value plus a reset nonce (the established panel pattern):
// a committed command changes the prop, remounting to the live value (which also reflects undo/redo/load);
// bumping the nonce remounts to discard an in-progress edit on Escape or a rejected commit.
function NameField(props: NameFieldProps): ReactElement {
  const { value, style } = props;
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);
  return (
    <input
      key={`${value}:${resetNonce}`}
      type="text"
      defaultValue={value}
      spellCheck={false}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.currentTarget.value = value;
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (!props.onCommit(event.currentTarget.value)) revert();
      }}
    />
  );
}

interface NumberFieldProps {
  readonly value: number;
  readonly step: number;
  readonly width: number;
  readonly min?: number;
  readonly max?: number;
  readonly title: string;
  readonly onCommit: (raw: string) => boolean;
}

// Uncontrolled number input with the same keyed-by-committed-value remount pattern as NameField. onCommit
// returns whether it accepted a real change; a rejected/unchanged commit reverts the field to the live
// value.
function NumberField(props: NumberFieldProps): ReactElement {
  const { value, step, width, min, max, title } = props;
  const [resetNonce, setResetNonce] = useState(0);
  const revert = (): void => setResetNonce((nonce) => nonce + 1);
  return (
    <input
      key={`${value}:${resetNonce}`}
      type="number"
      defaultValue={value}
      step={step}
      min={min}
      max={max}
      title={title}
      style={{ ...numberInputStyle, width }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.currentTarget.value = String(value);
          event.currentTarget.blur();
        }
      }}
      onBlur={(event) => {
        if (!props.onCommit(event.currentTarget.value)) revert();
      }}
    />
  );
}

interface ColorFieldProps {
  readonly channel: ColorChannel;
  readonly value: number;
  readonly onCommit: (channel: ColorChannel, raw: string) => boolean;
}

function ColorField(props: ColorFieldProps): ReactElement {
  const { channel, value } = props;
  return (
    <NumberField
      value={value}
      step={0.05}
      min={0}
      max={1}
      width={54}
      title={`Color ${channel.toUpperCase()} (0 to 1)`}
      onCommit={(raw) => props.onCommit(channel, raw)}
    />
  );
}

interface TransformFieldProps {
  readonly field: TransformField;
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly onCommit: (field: TransformField, raw: string) => boolean;
}

function TransformField(props: TransformFieldProps): ReactElement {
  const { field, label, value, step } = props;
  return (
    <label style={transformCellStyle}>
      <span style={transformLabelStyle}>{label}</span>
      <NumberField
        value={value}
        step={step}
        width={62}
        title={field}
        onCommit={(raw) => props.onCommit(field, raw)}
      />
    </label>
  );
}

function to255(channel: number): number {
  return Math.round(channel * 255);
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

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 40%',
  minHeight: 0,
  borderBottom: '1px solid #333333',
};

const detailSectionStyle: CSSProperties = {
  flex: '1 1 60%',
  minHeight: 0,
  overflowY: 'auto',
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

const rowNameStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: '#eeeeee',
};

const rowBoneStyle: CSSProperties = {
  flex: '0 0 auto',
  color: '#888888',
  maxWidth: '40%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const detailBodyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px',
};

const detailRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const labelStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 64,
  color: '#999999',
};

const subHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 4,
  paddingTop: 6,
  borderTop: '1px solid #2c2c2c',
  color: '#cccccc',
  fontWeight: 600,
};

const attachmentBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px',
  border: '1px solid #2c2c2c',
  borderRadius: 4,
  background: '#1f1f1f',
};

const attachmentRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const transformGridStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const transformCellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const transformLabelStyle: CSSProperties = {
  color: '#888888',
  minWidth: 22,
};

const swatchStyle: CSSProperties = {
  flex: '0 0 auto',
  width: 22,
  height: 22,
  borderRadius: 3,
  border: '1px solid #3a3a3a',
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

const numberInputStyle: CSSProperties = {
  flex: '0 0 auto',
  fontSize: 12,
  color: '#dddddd',
  background: '#222222',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  padding: '2px 6px',
  fontVariantNumeric: 'tabular-nums',
};

const selectStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 12,
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

const buttonDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};
