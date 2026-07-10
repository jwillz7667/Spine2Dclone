import type { IDockviewPanelProps } from 'dockview';
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import type { AtlasRegion, BlendMode, RGBA, Sequence } from '@marionette/format/types';
import {
  AddRegionAttachmentCommand,
  AutoWeightFromProximityCommand,
  BindMeshToBonesCommand,
  CreateLinkedMeshCommand,
  CreateSlotCommand,
  DeleteSlotCommand,
  LinkedMeshError,
  MeshBindingError,
  NormalizeMeshWeightsCommand,
  RemoveAttachmentCommand,
  SequenceError,
  SetAttachmentSequenceCommand,
  UnlinkMeshCommand,
  RenameSlotCommand,
  ReorderSlotCommand,
  SetActiveAttachmentCommand,
  SetRegionAttachmentTransformCommand,
  SetSlotBlendModeCommand,
  SetSlotColorCommand,
  SetSlotDarkColorCommand,
  UnbindMeshCommand,
  AddPathCurveCommand,
  RemovePathCurveCommand,
  SetPathClosedCommand,
  SetPathConstantSpeedCommand,
  documentHost,
  type AttachmentEntity,
  type BoneEntity,
  type BoneId,
  type LinkedMeshAttachmentEntity,
  type MeshAttachmentEntity,
  type PathAttachmentEntity,
  type RegionAttachmentEntity,
  type RegionTransform,
  type SlotEntity,
  type SlotId,
} from '../document';
import { useSelectionStore } from '../editor-state/selection-store';
import { useSlotSelectionStore } from '../editor-state/slot-selection-store';
import { usePlaybackStore } from '../editor-state/playback-store';
import { useDocumentRevision } from '../editor-state/use-document-revision';
import { dispatchBoneTransform, type EditDispatchContext } from '../viewport/edit-dispatcher';
import { buildBoneEdit, parseBoneField, type BoneTransformField } from './bone-inspector-logic';
import {
  buildBoneComponentKeyCommands,
  buildBoneKeyCommands,
  buildSlotColorKeyCommand,
  buildSlotColorSplitKeyCommands,
  buildSlotDarkKeyCommand,
} from './manual-key';
import { MeshError } from '../modules/mesh/mesh-error';
import { autoGridFillMesh, generateMeshFromRegion } from '../modules/mesh/mesh-tool';
import { regionToMeshInit } from '../modules/mesh/region-to-mesh';
import { autoGridFillGeometry } from '../modules/mesh/topology-edit';
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
  const selectedBoneIds = useSelectionStore((state) => state.selectedBoneIds);

  // The PRIMARY selected bone (the pivot; the gizmo and numeric entry act on it). Resolved against the
  // LIVE model so an undo/redo/delete that removes it collapses the section rather than showing a stale
  // transform. Multiple bones may be selected; the numeric fields edit the primary and the header notes
  // the count (batch numeric entry across a selection is intentionally out of scope, unlike the gizmo
  // drag which does move all).
  const primaryBoneId = selectedBoneIds.length > 0 ? selectedBoneIds[0]! : null;
  const primaryBone = useMemo(
    () => (primaryBoneId !== null ? model.getBone(primaryBoneId) : undefined),
    [model, revision, primaryBoneId],
  );

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
      {primaryBone !== undefined && (
        <BoneTransformSection bone={primaryBone} selectionCount={selectedBoneIds.length} />
      )}

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

// Create a linked mesh (PP-D10) that reuses `mesh`'s geometry, defaulting its name to "<mesh> linked"
// uniquified per slot and inheriting the parent's atlas path and size. A LinkedMeshError (a duplicate name)
// is swallowed at the UI edge: the command already guards it and the panel re-renders unchanged.
function createLinkedMeshFrom(slotId: SlotId, mesh: MeshAttachmentEntity): void {
  const doc = documentHost.current();
  const existing = doc.model.attachments(slotId).map((a) => a.name);
  let name = `${mesh.name} linked`;
  let suffix = 2;
  while (existing.includes(name)) {
    name = `${mesh.name} linked ${suffix}`;
    suffix += 1;
  }
  try {
    doc.history.execute(
      new CreateLinkedMeshCommand(slotId, {
        name,
        path: mesh.path,
        parent: mesh.name,
        timelines: true,
        width: mesh.width,
        height: mesh.height,
        color: { ...mesh.color },
      }),
    );
  } catch (error) {
    if (!(error instanceof LinkedMeshError)) throw error;
  }
}

// Unlink (bake) a linked mesh to a plain mesh (PP-D10).
function unlinkMesh(slotId: SlotId, name: string): void {
  try {
    documentHost.current().history.execute(new UnlinkMeshCommand(slotId, name));
  } catch (error) {
    if (!(error instanceof LinkedMeshError)) throw error;
  }
}

// Set or clear the Stage F2 frame-sequence on a region/mesh attachment (PP-D10). setupIndex is clamped into
// [0, count) so the command's validation never rejects a UI edit; a SequenceError is swallowed at the edge.
function setAttachmentSequence(slotId: SlotId, name: string, sequence: Sequence | null): void {
  const clamped: Sequence | null =
    sequence === null
      ? null
      : {
          count: Math.max(1, Math.floor(sequence.count)),
          start: Math.max(0, Math.floor(sequence.start)),
          digits: Math.max(0, Math.floor(sequence.digits)),
          setupIndex: Math.min(
            Math.max(0, Math.floor(sequence.setupIndex)),
            Math.max(1, Math.floor(sequence.count)) - 1,
          ),
        };
  try {
    documentHost.current().history.execute(new SetAttachmentSequenceCommand(slotId, name, clamped));
  } catch (error) {
    if (!(error instanceof SequenceError)) throw error;
  }
}

// A compact frame-sequence editor for a region/mesh attachment (PP-D10). Shows count/setupIndex when a
// sequence is present (with a Clear), else a button that adds a default 2-frame sequence.
function SequenceControl(props: {
  readonly slotId: SlotId;
  readonly name: string;
  readonly sequence: Sequence | undefined;
}): ReactElement {
  const { slotId, name, sequence } = props;
  if (sequence === undefined) {
    return (
      <div style={detailRowStyle}>
        <span style={labelStyle}>Sequence</span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Add a frame-sequence playback block to this attachment (Stage F2)"
          onClick={() =>
            setAttachmentSequence(slotId, name, { count: 2, start: 0, digits: 2, setupIndex: 0 })
          }
        >
          Add Sequence
        </button>
      </div>
    );
  }
  return (
    <div style={detailRowStyle}>
      <span style={labelStyle}>Sequence</span>
      <span style={rowBoneStyle}>count</span>
      <input
        style={cellSizeInputStyle}
        defaultValue={sequence.count}
        inputMode="numeric"
        key={`count-${sequence.count}`}
        title="Number of frames"
        onBlur={(event) =>
          setAttachmentSequence(slotId, name, {
            ...sequence,
            count: parseFinite(event.currentTarget.value, sequence.count),
          })
        }
      />
      <span style={rowBoneStyle}>setup</span>
      <input
        style={cellSizeInputStyle}
        defaultValue={sequence.setupIndex}
        inputMode="numeric"
        key={`setup-${sequence.setupIndex}`}
        title="The frame shown in setup pose (0-based)"
        onBlur={(event) =>
          setAttachmentSequence(slotId, name, {
            ...sequence,
            setupIndex: parseFinite(event.currentTarget.value, sequence.setupIndex),
          })
        }
      />
      <button
        type="button"
        style={smallButtonStyle}
        title="Remove the frame-sequence block"
        onClick={() => setAttachmentSequence(slotId, name, null)}
      >
        Clear
      </button>
    </div>
  );
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
  const canKey = usePlaybackStore((state) => state.activeAnimation) !== null;

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

  // Edit one channel of the setup DARK color (PP-D10), reading the LIVE dark color so a run composes.
  function commitDarkChannel(channel: ColorChannel, raw: string): boolean {
    const live = documentHost.current().model.getSlot(slot.id);
    if (live === undefined || live.darkColor === null) return false;
    const current = live.darkColor[channel];
    const next = parseChannel(raw, current);
    if (next === current) return false;
    commitSlotDarkColor(slot.id, withChannel(live.darkColor, channel, next));
    return true;
  }

  const swatch = `rgba(${to255(color.r)}, ${to255(color.g)}, ${to255(color.b)}, ${color.a})`;
  const dark = slot.darkColor;

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
        <button
          type="button"
          style={canKey ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
          disabled={!canKey}
          title={
            canKey
              ? 'Key this color at the playhead'
              : 'Select an animation in the dopesheet to key'
          }
          onClick={() => keySlotColorAtPlayhead(slot.id)}
        >
          Key
        </button>
        <button
          type="button"
          style={canKey ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
          disabled={!canKey}
          title={
            canKey
              ? 'Key this color as split RGB + Alpha tracks at the playhead'
              : 'Select an animation in the dopesheet to key'
          }
          onClick={() => keySlotColorSplitAtPlayhead(slot.id)}
        >
          Key Split
        </button>
      </div>

      <div style={detailRowStyle}>
        <span style={labelStyle}>Dark</span>
        {dark === null ? (
          <button
            type="button"
            style={smallButtonStyle}
            title="Enable the Stage F2 two-color dark tint on this slot"
            onClick={() => commitSlotDarkColor(slot.id, { r: 0, g: 0, b: 0, a: 1 })}
          >
            Enable
          </button>
        ) : (
          <>
            <ColorField channel="r" value={dark.r} onCommit={commitDarkChannel} />
            <ColorField channel="g" value={dark.g} onCommit={commitDarkChannel} />
            <ColorField channel="b" value={dark.b} onCommit={commitDarkChannel} />
            <span
              style={{
                ...swatchStyle,
                background: `rgb(${to255(dark.r)}, ${to255(dark.g)}, ${to255(dark.b)})`,
              }}
            />
            <button
              type="button"
              style={canKey ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
              disabled={!canKey}
              title={canKey ? 'Key the dark color at the playhead' : 'Select an animation to key'}
              onClick={() => keySlotDarkAtPlayhead(slot.id)}
            >
              Key
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              title="Disable the two-color dark tint"
              onClick={() => commitSlotDarkColor(slot.id, null)}
            >
              Off
            </button>
          </>
        )}
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

  // Mesh attachments (WP-2.1): vertex editing lives in the viewport mesh tool (M); this row carries the
  // one-click topology actions. Grid fill replaces the interior with a regular grid (topology-locked:
  // disabled for a weighted mesh, which must be unbound first).
  if (attachment.kind === 'mesh') {
    return <MeshAttachmentRow slotId={slotId} name={attachment.name} mesh={attachment} />;
  }

  // Linked meshes (PP-D10) reuse a parent mesh's geometry; the row carries the Unlink (bake) action.
  if (attachment.kind === 'linkedmesh') {
    return <LinkedMeshAttachmentRow slotId={slotId} linked={attachment} />;
  }

  // Path attachments (PP-D11): a Bezier rail. Control-point editing lives in the viewport Path tool; this
  // row carries the openness / parametrization flags and the add/remove-curve actions.
  if (attachment.kind === 'path') {
    return <PathAttachmentRow slotId={slotId} path={attachment} />;
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
          title="Convert to an editable mesh (WP-2.1); the quad renders identically, then edit vertices with the Mesh tool (M)"
          onClick={() => convertRegionToMesh(slotId, attachment)}
        >
          To Mesh
        </button>
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
      <SequenceControl slotId={slotId} name={attachment.name} sequence={attachment.sequence} />
    </div>
  );
}

interface MeshAttachmentRowProps {
  readonly slotId: SlotId;
  readonly name: string;
  readonly mesh: MeshAttachmentEntity;
}

// The mesh row: vertex/hull counts, weighted state, the one-click grid fill (TASK-2.1.5) whose cell size is
// a local input (ephemeral UI state, not document state), and the bone-binding actions (WP-2.3 / WP-2.4). An
// unweighted mesh binds to the selected bones; a weighted mesh auto-weights, normalizes, or unbinds and is
// painted with the Weights tool. Every action dispatches ONE undoable command through History (Law 2); a
// weighted mesh disables grid fill (topology lock: unbind first). The bone selection it binds against is
// ephemeral editor state, so the row subscribes to it to enable/disable the bind button live.
function MeshAttachmentRow(props: MeshAttachmentRowProps): ReactElement {
  const { slotId, name, mesh } = props;
  const [cellSize, setCellSize] = useState('16');
  const selectedBoneIds = useSelectionStore((state) => state.selectedBoneIds);
  const weighted = mesh.bones !== undefined && mesh.bones.length > 0;
  const vertexCount = mesh.vertices.length / 2;
  const hasBoneSelection = selectedBoneIds.length > 0;

  return (
    <div style={attachmentBlockStyle}>
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{name}</span>
        <span style={rowBoneStyle}>
          {mesh.path} (mesh, {weighted ? 'weighted, ' : ''}
          {vertexCount} verts, hull {mesh.hullLength})
        </span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Create a linked mesh that reuses this mesh's geometry (one undo step)"
          onClick={() => createLinkedMeshFrom(slotId, mesh)}
        >
          Link
        </button>
        <button
          type="button"
          style={smallButtonStyle}
          title="Remove attachment"
          onClick={() => removeAttachment(slotId, name)}
        >
          Remove
        </button>
      </div>
      <div style={detailRowStyle}>
        <span style={labelStyle}>Grid cell</span>
        <input
          style={cellSizeInputStyle}
          value={cellSize}
          inputMode="numeric"
          onChange={(event) => setCellSize(event.target.value)}
        />
        <button
          type="button"
          style={weighted ? { ...smallButtonStyle, ...buttonDisabledStyle } : smallButtonStyle}
          disabled={weighted}
          title={
            weighted
              ? 'Topology is locked while the mesh is weighted; unbind it first'
              : 'Replace the interior with a regular grid at this cell size (one undo step)'
          }
          onClick={() => gridFillMeshAttachment(slotId, name, parseFinite(cellSize, 16))}
        >
          Grid Fill
        </button>
        <span style={rowBoneStyle}>edit vertices with the Mesh tool (M)</span>
      </div>
      <div style={detailRowStyle}>
        <span style={labelStyle}>Binding</span>
        {weighted ? (
          <>
            <button
              type="button"
              style={smallButtonStyle}
              title="Re-seed weights from bone proximity (one undo step)"
              onClick={() => autoWeightMesh(slotId, name)}
            >
              Auto Weights
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              title="Re-normalize every vertex to sum 1 and cap the influences (one undo step)"
              onClick={() => normalizeMeshWeights(slotId, name)}
            >
              Normalize
            </button>
            <button
              type="button"
              style={smallButtonStyle}
              title="Return the mesh to the unweighted encoding (one undo step)"
              onClick={() => unbindMesh(slotId, name)}
            >
              Unbind
            </button>
            <span style={rowBoneStyle}>paint weights with the Weights tool (W)</span>
          </>
        ) : (
          <>
            <button
              type="button"
              style={
                hasBoneSelection
                  ? smallButtonStyle
                  : { ...smallButtonStyle, ...buttonDisabledStyle }
              }
              disabled={!hasBoneSelection}
              title={
                hasBoneSelection
                  ? 'Bind this mesh to the selected bones (one undo step); paint weights afterward'
                  : 'Select one or more bones in the hierarchy first'
              }
              onClick={() => bindMeshToSelectedBones(slotId, name)}
            >
              Bind to Selected Bones
            </button>
            <span style={rowBoneStyle}>
              {hasBoneSelection
                ? `binds to ${selectedBoneIds.length} selected ${
                    selectedBoneIds.length === 1 ? 'bone' : 'bones'
                  }`
                : 'select bones in the hierarchy first'}
            </span>
          </>
        )}
      </div>
      <SequenceControl slotId={slotId} name={name} sequence={mesh.sequence} />
    </div>
  );
}

// A linked-mesh attachment row (PP-D10): shows its parent reference and the Unlink (bake to plain mesh)
// action. Geometry editing is done on the PARENT mesh; a linked mesh has none of its own.
function LinkedMeshAttachmentRow(props: {
  readonly slotId: SlotId;
  readonly linked: LinkedMeshAttachmentEntity;
}): ReactElement {
  const { slotId, linked } = props;
  return (
    <div style={attachmentBlockStyle}>
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{linked.name}</span>
        <span style={rowBoneStyle}>
          {linked.path} (linked -&gt; {linked.parent}
          {linked.skin !== undefined ? ` @ ${linked.skin}` : ''})
        </span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Bake this linked mesh to a plain mesh with the resolved geometry (one undo step)"
          onClick={() => unlinkMesh(slotId, linked.name)}
        >
          Unlink
        </button>
        <button
          type="button"
          style={smallButtonStyle}
          title="Remove attachment"
          onClick={() => removeAttachment(slotId, linked.name)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// The path attachment inspector row (PP-D11): its curve count and control-point count, the openness and
// constant-speed flags (each a checkbox dispatching its command), and the add/remove-curve actions. Control
// points are dragged in the viewport Path tool; the arc-length table is recomputed by the commands.
function PathAttachmentRow(props: {
  readonly slotId: SlotId;
  readonly path: PathAttachmentEntity;
}): ReactElement {
  const { slotId, path } = props;
  const curveCount = path.lengths.length;
  const pointCount = path.vertices.length / 2;
  return (
    <div style={attachmentBlockStyle}>
      <div style={attachmentRowStyle}>
        <span style={rowNameStyle}>{path.name}</span>
        <span style={rowBoneStyle}>
          path: {curveCount} {curveCount === 1 ? 'curve' : 'curves'}, {pointCount} points
        </span>
        <button
          type="button"
          style={smallButtonStyle}
          title="Append a cubic curve (three control points) to the end of the spline"
          onClick={() => addPathCurve(slotId, path.name)}
        >
          + Curve
        </button>
        <button
          type="button"
          style={curveCount > 1 ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
          disabled={curveCount <= 1}
          title="Drop the last curve (a path keeps at least one)"
          onClick={() => removePathCurve(slotId, path.name)}
        >
          - Curve
        </button>
        <button
          type="button"
          style={smallButtonStyle}
          title="Remove attachment"
          onClick={() => removeAttachment(slotId, path.name)}
        >
          Remove
        </button>
      </div>
      <div style={detailRowStyle}>
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={path.closed}
            onChange={(event) => setPathClosed(slotId, path.name, event.target.checked)}
          />{' '}
          Closed
        </label>
        <label style={labelStyle}>
          <input
            type="checkbox"
            checked={path.constantSpeed}
            onChange={(event) => setPathConstantSpeed(slotId, path.name, event.target.checked)}
          />{' '}
          Constant speed
        </label>
      </div>
    </div>
  );
}

function setPathClosed(slotId: SlotId, name: string, closed: boolean): void {
  documentHost.current().history.execute(new SetPathClosedCommand(slotId, name, closed));
}

function setPathConstantSpeed(slotId: SlotId, name: string, constantSpeed: boolean): void {
  documentHost
    .current()
    .history.execute(new SetPathConstantSpeedCommand(slotId, name, constantSpeed));
}

function addPathCurve(slotId: SlotId, name: string): void {
  documentHost.current().history.execute(new AddPathCurveCommand(slotId, name));
}

function removePathCurve(slotId: SlotId, name: string): void {
  documentHost.current().history.execute(new RemovePathCurveCommand(slotId, name));
}

// Convert a region attachment to a pixel-identical 4-vertex quad mesh (TASK-2.1.1) as one undo step.
// The entity carries exactly the RegionSource fields regionToMeshInit consumes.
function convertRegionToMesh(slotId: SlotId, region: RegionAttachmentEntity): void {
  generateMeshFromRegion(
    documentHost.current().history,
    slotId,
    region.name,
    regionToMeshInit(region),
  );
}

// One-click grid fill over the CURRENT hull (TASK-2.1.5): pure geometry (uv-preserving) then one
// command through the glue. Rejections (degenerate hull, a cell size producing an invalid mesh) are
// typed MeshErrors surfaced once at this boundary.
function gridFillMeshAttachment(slotId: SlotId, name: string, cellSize: number): void {
  const doc = documentHost.current();
  const live = doc.model.getAttachment(slotId, name);
  if (live === undefined || live.kind !== 'mesh') return;
  if (cellSize <= 0) return;
  try {
    const result = autoGridFillGeometry(live, cellSize);
    autoGridFillMesh(doc.history, slotId, name, {
      uvs: result.uvs,
      triangles: result.triangles,
      hullLength: live.hullLength,
      vertices: result.vertices,
    });
  } catch (error) {
    if (error instanceof MeshError) {
      console.error(`[marionette] grid fill rejected: ${error.message}`);
      return;
    }
    throw error;
  }
}

// Bind an UNWEIGHTED mesh to the currently selected bones (WP-2.3, TASK-2.3.1) as one undo step, seeding
// rigid-nearest weights (real weights are painted with the Weights tool). The button is disabled when no
// bones are selected; this returns defensively in that case. Selecting bones is ephemeral editor state (the
// document/editor wall); the bind itself is the command (Law 2).
function bindMeshToSelectedBones(slotId: SlotId, name: string): void {
  const boneIds = useSelectionStore.getState().selectedBoneIds;
  if (boneIds.length === 0) return;
  documentHost
    .current()
    .history.execute(new BindMeshToBonesCommand(slotId, name, boneIds, 'rigidNearest'));
}

// Re-seed a weighted mesh's weights from bone proximity (WP-2.3) as one undo step.
function autoWeightMesh(slotId: SlotId, name: string): void {
  documentHost.current().history.execute(new AutoWeightFromProximityCommand(slotId, name));
}

// Re-normalize every vertex of a weighted mesh to sum 1 and cap to the influence limit (WP-2.4) as one
// undo step.
function normalizeMeshWeights(slotId: SlotId, name: string): void {
  documentHost.current().history.execute(new NormalizeMeshWeightsCommand(slotId, name));
}

// Return a weighted mesh to the unweighted encoding (WP-2.3, TASK-2.3.5) as one undo step. The command
// rejects a mesh that still carries deform keyframes with a typed MeshBindingError; that is surfaced once at
// this boundary (matching gridFillMeshAttachment), not swallowed.
function unbindMesh(slotId: SlotId, name: string): void {
  try {
    documentHost.current().history.execute(new UnbindMeshCommand(slotId, name));
  } catch (error) {
    if (error instanceof MeshBindingError) {
      console.error(`[marionette] unbind rejected: ${error.message}`);
      return;
    }
    throw error;
  }
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

// Snapshot the ephemeral edit context from the playback store (read at commit time, not per keystroke).
function editorContext(): EditDispatchContext {
  const state = usePlaybackStore.getState();
  return {
    mode: state.mode,
    autoKey: state.autoKey,
    activeAnimation: state.activeAnimation,
    playhead: state.playhead,
  };
}

// Commit one numeric bone-field edit. Reads the LIVE bone so a field always parses against the current
// value (and so a run of edits composes), validates through parseBoneField, then routes the desired local
// value through the SINGLE edit dispatcher (never constructing a bone command here, R1.4) inside ONE
// interaction session so the edit is exactly one undo step. In setup mode the dispatcher writes the setup
// pose; in animation mode with auto-key it keys the setup-relative delta at the playhead, matching the
// gizmo. Returns true only when the SETUP pose changed: the numeric fields display the setup pose, so an
// animation-mode keyed edit (setup unchanged) returns false, reverting the field to the setup value to
// signal the edit was keyed rather than applied to setup.
function commitBoneField(boneId: BoneId, field: BoneTransformField, raw: string): boolean {
  const doc = documentHost.current();
  const live = doc.model.getBone(boneId);
  if (live === undefined) return false;
  const value = parseBoneField(field, raw, live[field]);
  if (value === null) return false;

  const edit = buildBoneEdit(field, value, live);
  const ctx = editorContext();
  const label = ctx.mode === 'animation' ? boneFieldKeyLabel(field) : boneFieldSetupLabel(field);
  doc.history.beginInteraction();
  let outcomeKind: string;
  try {
    outcomeKind = dispatchBoneTransform(doc.history, doc.model, boneId, edit, ctx).kind;
  } finally {
    doc.history.endInteraction(label);
  }
  return outcomeKind === 'setup';
}

// The undo-step label for a setup-pose numeric edit, per channel.
function boneFieldSetupLabel(field: BoneTransformField): string {
  if (field === 'x' || field === 'y') return 'Move Bone';
  if (field === 'rotation') return 'Rotate Bone';
  if (field === 'scaleX' || field === 'scaleY') return 'Scale Bone';
  return 'Shear Bone';
}

// The undo-step label for a keyed numeric edit (animation mode), per channel.
function boneFieldKeyLabel(field: BoneTransformField): string {
  if (field === 'x' || field === 'y') return 'Key Bone Position';
  if (field === 'rotation') return 'Key Bone Rotation';
  if (field === 'scaleX' || field === 'scaleY') return 'Key Bone Scale';
  return 'Key Bone Shear';
}

// Manually key the bone's CURRENT transform (all four channels) at the playhead in ONE undo step,
// independent of the auto-key toggle. A no-op with no active animation (the button is disabled then). The
// live BoneEntity is structurally a SetupTransform, so it feeds the manual-key builder directly.
function keyBoneAtPlayhead(boneId: BoneId): void {
  const doc = documentHost.current();
  const bone = doc.model.getBone(boneId);
  const state = usePlaybackStore.getState();
  if (bone === undefined || state.activeAnimation === null) return;
  const commands = buildBoneKeyCommands(state.activeAnimation, boneId, bone, state.playhead);
  doc.history.beginInteraction();
  try {
    for (const command of commands) doc.history.execute(command);
  } finally {
    doc.history.endInteraction('Key Bone');
  }
}

// Manually key the bone's per-component split channels (Stage F2, ADR-0009 section 4.1) at the playhead in
// ONE undo step. A joint channel and its split components must not coexist (TIMELINE_COMPONENT_CONFLICT); if
// the bone already keys a joint channel of some group, the split command for that group throws, so the whole
// interaction is rolled back (cancelInteraction) and nothing partial lands. Use "Key" (joint) OR "Key Split"
// on a given bone, not both.
function keyBoneComponentsAtPlayhead(boneId: BoneId): void {
  const doc = documentHost.current();
  const bone = doc.model.getBone(boneId);
  const state = usePlaybackStore.getState();
  if (bone === undefined || state.activeAnimation === null) return;
  const commands = buildBoneComponentKeyCommands(
    state.activeAnimation,
    boneId,
    bone,
    state.playhead,
  );
  doc.history.beginInteraction();
  try {
    for (const command of commands) doc.history.execute(command);
    doc.history.endInteraction('Key Bone Components');
  } catch {
    doc.history.cancelInteraction();
  }
}

// Manually key the slot's CURRENT color at the playhead as one undo step. A no-op with no active animation.
function keySlotColorAtPlayhead(slotId: SlotId): void {
  const doc = documentHost.current();
  const slot = doc.model.getSlot(slotId);
  const state = usePlaybackStore.getState();
  if (slot === undefined || state.activeAnimation === null) return;
  doc.history.execute(
    buildSlotColorKeyCommand(state.activeAnimation, slotId, slot.color, state.playhead),
  );
}

// Key the slot's current color as split RGB + Alpha tracks (Stage F2, ADR-0009 section 4.2) at the playhead
// in ONE undo step. The joint `color` and the split `rgb`/`alpha` must not coexist; if the slot already keys
// `color`, the split commands throw and the whole interaction is rolled back (cancelInteraction). Use "Key"
// OR "Key Split" on a given slot, not both.
function keySlotColorSplitAtPlayhead(slotId: SlotId): void {
  const doc = documentHost.current();
  const slot = doc.model.getSlot(slotId);
  const state = usePlaybackStore.getState();
  if (slot === undefined || state.activeAnimation === null) return;
  const commands = buildSlotColorSplitKeyCommands(
    state.activeAnimation,
    slotId,
    slot.color,
    state.playhead,
  );
  doc.history.beginInteraction();
  try {
    for (const command of commands) doc.history.execute(command);
    doc.history.endInteraction('Key Slot Color Split');
  } catch {
    doc.history.cancelInteraction();
  }
}

// Set or clear a slot's setup DARK color (PP-D10) inside a coalescing session (mirrors commitSlotColor).
function commitSlotDarkColor(id: SlotId, color: RGBA | null): void {
  const history = documentHost.current().history;
  history.beginInteraction();
  try {
    history.execute(new SetSlotDarkColorCommand(id, color));
  } finally {
    history.endInteraction('Set Slot Dark Color');
  }
}

// Key the slot's current setup dark color at the playhead (only meaningful when the slot has a dark color;
// the command enforces ANIM_DARK_NO_SETUP otherwise).
function keySlotDarkAtPlayhead(slotId: SlotId): void {
  const doc = documentHost.current();
  const slot = doc.model.getSlot(slotId);
  const state = usePlaybackStore.getState();
  if (slot === undefined || slot.darkColor === null || state.activeAnimation === null) return;
  doc.history.execute(
    buildSlotDarkKeyCommand(state.activeAnimation, slotId, slot.darkColor, state.playhead),
  );
}

interface BoneTransformSectionProps {
  readonly bone: BoneEntity;
  readonly selectionCount: number;
}

// The bone transform inspector (PP-D1): numeric entry for the primary selected bone's local x, y,
// rotation, scaleX, scaleY, shearX, shearY. Every field commits through commitBoneField (the dispatcher,
// LAW 2) so it honors setup-vs-animation mode exactly like the gizmo. The fields show the SETUP pose; a
// header note flags a multi-bone selection (the gizmo drag moves all, numeric entry edits the primary).
function BoneTransformSection(props: BoneTransformSectionProps): ReactElement {
  const { bone, selectionCount } = props;
  const activeAnimation = usePlaybackStore((state) => state.activeAnimation);
  const canKey = activeAnimation !== null;

  const field = (label: string, name: BoneTransformField, step: number): ReactElement => (
    <label style={transformCellStyle}>
      <span style={transformLabelStyle}>{label}</span>
      <NumberField
        value={bone[name]}
        step={step}
        width={62}
        title={name}
        onCommit={(raw) => commitBoneField(bone.id, name, raw)}
      />
    </label>
  );

  return (
    <div style={boneSectionStyle}>
      <div style={subHeaderStyle}>
        <span>Bone: {bone.name}</span>
        {selectionCount > 1 && (
          <span style={countStyle}>{selectionCount} selected (editing primary)</span>
        )}
        <button
          type="button"
          style={
            canKey
              ? { ...smallButtonStyle, marginLeft: 'auto' }
              : { ...smallButtonStyle, ...buttonDisabledStyle, marginLeft: 'auto' }
          }
          disabled={!canKey}
          title={
            canKey
              ? 'Key this bone (all channels) at the playhead'
              : 'Select an animation in the dopesheet to key'
          }
          onClick={() => keyBoneAtPlayhead(bone.id)}
        >
          Key
        </button>
        <button
          type="button"
          style={canKey ? smallButtonStyle : { ...smallButtonStyle, ...buttonDisabledStyle }}
          disabled={!canKey}
          title={
            canKey
              ? 'Key this bone as per-component split tracks (translateX/Y, scaleX/Y, shearX/Y) at the playhead'
              : 'Select an animation in the dopesheet to key'
          }
          onClick={() => keyBoneComponentsAtPlayhead(bone.id)}
        >
          Key Split
        </button>
      </div>
      <div style={transformGridStyle}>
        {field('X', 'x', 1)}
        {field('Y', 'y', 1)}
        {field('Rot', 'rotation', 1)}
        {field('SX', 'scaleX', 0.1)}
        {field('SY', 'scaleY', 0.1)}
        {field('ShX', 'shearX', 1)}
        {field('ShY', 'shearY', 1)}
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

const boneSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px',
  flex: '0 0 auto',
  borderBottom: '1px solid #333333',
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

const cellSizeInputStyle: CSSProperties = {
  flex: '0 0 48px',
  padding: '3px 6px',
  fontSize: 11,
  color: '#dddddd',
  background: '#1e1e1e',
  border: '1px solid #444444',
  borderRadius: 4,
};

const buttonDisabledStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};
