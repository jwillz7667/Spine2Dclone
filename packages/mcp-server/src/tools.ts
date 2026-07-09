import {
  AddBoneToMeshBindingCommand,
  AddMeshVertexCommand,
  AddRegionAttachmentCommand,
  AnimationDurationError,
  AutoGridFillMeshCommand,
  AutoPerimeterTraceMeshCommand,
  AutoWeightFromProximityCommand,
  BindMeshToBonesCommand,
  ClearAttachmentDeformCommand,
  ConstraintError,
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateIkConstraintCommand,
  CreateSkinCommand,
  CreateSlotCommand,
  CreateTransformConstraintCommand,
  DeformError,
  DeleteAnimationCommand,
  DeleteBoneCommand,
  DeleteDeformKeyframeCommand,
  DeleteIkConstraintCommand,
  DeleteIkKeyframeCommand,
  DeleteKeyframeCommand,
  SetAttachmentKeyframeCommand,
  DeleteAttachmentKeyframeCommand,
  MoveAttachmentKeyframeCommand,
  MoveIkKeyframeCommand,
  MoveTransformKeyframeCommand,
  CommandTargetMissingError,
  DeleteMeshVertexCommand,
  DeleteSkinCommand,
  DeleteSlotCommand,
  DeleteTransformConstraintCommand,
  DeleteTransformKeyframeCommand,
  DocumentInvariantError,
  DuplicateAnimationCommand,
  ExportValidationError,
  GenerateMeshFromRegionCommand,
  KeyframeCollisionError,
  LinkedMeshError,
  CreateLinkedMeshCommand,
  UnlinkMeshCommand,
  MeshBindingError,
  MeshTopologyLockedError,
  MoveBoneCommand,
  MoveDeformKeyframeCommand,
  MoveKeyframeCommand,
  MoveMeshVertexCommand,
  NormalizeMeshWeightsCommand,
  PaintWeightStrokeCommand,
  PasteKeyframesCommand,
  RemoveAttachmentCommand,
  RemoveBoneFromMeshBindingCommand,
  RemoveSkinAttachmentCommand,
  RenameAnimationCommand,
  RenameBoneCommand,
  RenameSkinCommand,
  RenameSlotCommand,
  ReorderSlotCommand,
  ReparentBoneCommand,
  SetAtlasRefCommand,
  ReparentCycleError,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetActiveAttachmentCommand,
  SetAnimationDurationCommand,
  SetBoneLengthCommand,
  SetBoneShearCommand,
  SetBoneTransformModeCommand,
  SetCurveCommand,
  SetDeformKeyframeCommand,
  SetIkBendPositiveCommand,
  SetIkDepthParamsCommand,
  SetIkKeyframeCommand,
  SetIkMixCommand,
  SetKeyframeCommand,
  SetMeshEdgesCommand,
  SetRegionAttachmentTransformCommand,
  SetSkinAttachmentCommand,
  SetSlotBlendModeCommand,
  SetSlotColorCommand,
  ReorderConstraintsCommand,
  SetTransformConstraintParamsCommand,
  SetTransformConstraintVariantsCommand,
  SetTransformKeyframeCommand,
  SkinError,
  UnbindMeshCommand,
  // Effects (VFX / particles, Phase 3) command surface (WP-3.7) and its typed errors.
  CreateEffectCommand,
  DeleteEffectCommand,
  RenameEffectCommand,
  SetEffectMetaCommand,
  SetEffectsAtlasCommand,
  AddLayerCommand,
  RemoveLayerCommand,
  ReorderLayersCommand,
  SetLayerFieldCommand,
  SetLayerBlendModeCommand,
  AddLifeStopCommand,
  RemoveLifeStopCommand,
  MoveLifeStopCommand,
  SetLifeStopValueCommand,
  SetLifeStopCurveCommand,
  CreateBundleCommand,
  DeleteBundleCommand,
  AddBundleItemCommand,
  RemoveBundleItemCommand,
  ReorderBundleItemsCommand,
  SetBundleItemCommand,
  EffectEditError,
  EffectsAtlasDanglingRegionError,
  findEffectSnapshot,
  findBundleSnapshot,
  // Slot-composer (Phase 4) command surface and its typed errors.
  SetGridConfigCommand,
  MapSymbolAnimSetCommand,
  CreateWinSequenceCommand,
  SetWinSequenceStepCommand,
  ReorderWinSequenceStepCommand,
  SetEscalationThresholdCommand,
  CreateFeatureFlowStateCommand,
  AddFeatureFlowTransitionCommand,
  DeleteFeatureFlowStateCommand,
  RenameFeatureFlowStateCommand,
  RemoveFeatureFlowTransitionCommand,
  SetTumbleChoreographyCommand,
  SlotEditError,
  // Events + draw-order timelines + document metadata (Stage F1, PP-D9) command surface and typed errors.
  DefineEventCommand,
  RenameEventCommand,
  DeleteEventCommand,
  SetEventDefaultsCommand,
  SetEventAudioCommand,
  SetEventKeyCommand,
  MoveEventKeyCommand,
  DeleteEventKeyCommand,
  SetDrawOrderKeyCommand,
  MoveDrawOrderKeyCommand,
  DeleteDrawOrderKeyCommand,
  SetDocumentMetadataCommand,
  EventEditError,
  DrawOrderError,
  exportDocument,
  exportEffects,
  EffectsExportValidationError,
  type AnimationEntity,
  type AnimationId,
  type AttachmentEntity,
  type BoneChannel,
  type BoneEntity,
  type BoneId,
  type Command,
  type DeformSkinKey,
  type DocumentReadModel,
  type IkConstraintEntity,
  type IkConstraintId,
  type IkDepthPatch,
  type KeyframeEntity,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
  type PaintMode,
  type PastedKeyframe,
  type SkinEntity,
  type SkinId,
  type SlotEntity,
  type SlotId,
  type TransformConstraintEntity,
  type TransformConstraintId,
  type TransformConstraintParams,
  type TransformKeyframeMix,
  type TransformVariantPatch,
  type WeightDab,
  type EffectId,
  type EffectLayerId,
  type LifeStopId,
  type BundleItemId,
  type EffectEntity,
  type EffectLayerEntity,
  type BundleEntity,
  type EffectLayerBody,
  type EffectMetaPatch,
  type BundleItemInit,
  type BundleItemPatch,
  type NewLayerKind,
  type MapSymbolAnimSetInit,
  type EffectsReadModel,
  type EventDefEntity,
  type EventDefId,
  type EventDefInit,
  type EventDefaults,
  type EventKeyOverrides,
  type EventAudioValue,
  type DrawOrderOffsetEntity,
} from '@marionette/document-core';
import { FormatValidationError } from '@marionette/format';
import type { AtlasRef, SkeletonDocument, SkeletonMeta } from '@marionette/format/types';
import type { EffectsDocument } from '@marionette/format/effects-types';
import type { SymbolId } from '@marionette/format/slot-types';
import {
  isAtlasError,
  runAtlasPipeline,
  type AtlasFileStore,
  type PackConfig,
} from '@marionette/atlas-pack';
import {
  MAT2X3_STRIDE,
  buildPose,
  computeWorldTransforms,
  resetToSetupPose,
  EffectNotFoundError,
  BundleNotFoundError,
} from '@marionette/runtime-core';
import {
  RenderPreviewError,
  renderFrame,
  renderComposedFrame,
  type AtlasPagePixels,
  type RenderFrameResult,
  type EffectAnchorInput,
} from '@marionette/render-preview';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { McpToolError } from './errors';
import type { FileStore } from './files';
import type { Session, SessionRegistry } from './session';

export interface ToolDeps {
  readonly sessions: SessionRegistry;
  readonly files: FileStore;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.AnyZodObject;
  readonly handler: (deps: ToolDeps, rawInput: unknown) => Promise<unknown>;
}

// Define a tool with a typed input schema. The handler receives the validated, defaults-applied input;
// invalid input becomes a typed McpToolError before the handler runs (validate-at-the-boundary).
function defineTool<S extends z.AnyZodObject>(
  spec: { name: string; title: string; description: string; input: S },
  handler: (deps: ToolDeps, input: z.infer<S>) => Promise<unknown> | unknown,
): ToolDefinition {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: spec.input,
    handler: async (deps, rawInput) => {
      const parsed = spec.input.safeParse(rawInput);
      if (!parsed.success) {
        throw new McpToolError(
          'INVALID_INPUT',
          parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        );
      }
      return handler(deps, parsed.data);
    },
  };
}

// Brand a client-supplied id string. The id is then validated against the live model by getBone, so a
// non-existent id is rejected as BONE_NOT_FOUND rather than silently mutating nothing.
function asBoneId(id: string): BoneId {
  return id as BoneId;
}

function requireBone(session: Session, boneId: string): BoneEntity {
  const bone = session.document.model.getBone(asBoneId(boneId));
  if (bone === undefined) {
    throw new McpToolError('BONE_NOT_FOUND', `no bone with id "${boneId}"`);
  }
  return bone;
}

function asSlotId(id: string): SlotId {
  return id as SlotId;
}

function requireSlot(session: Session, slotId: string): SlotEntity {
  const slot = session.document.model.getSlot(asSlotId(slotId));
  if (slot === undefined) {
    throw new McpToolError('SLOT_NOT_FOUND', `no slot with id "${slotId}"`);
  }
  return slot;
}

// Require an attachment of an exact kind at (slotId, name); else a typed ATTACHMENT_NOT_FOUND. Used by
// the WP-2.1 mesh tools (mesh edits require a 'mesh'; GenerateMeshFromRegion requires a 'region').
function requireAttachmentKind(
  session: Session,
  slotId: string,
  name: string,
  kind: 'mesh' | 'region',
): void {
  const att = session.document.model.getAttachment(asSlotId(slotId), name);
  if (att === undefined || att.kind !== kind) {
    throw new McpToolError(
      'ATTACHMENT_NOT_FOUND',
      `slot "${slotId}" has no ${kind} attachment "${name}"`,
    );
  }
}

// Execute a topology-changing mesh edit (add/delete vertex, auto grid-fill, auto perimeter-trace),
// converting the topology-lock guard into a typed MESH_TOPOLOGY_LOCKED tool error. The guard throws
// before any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeMeshTopologyEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof MeshTopologyLockedError) {
      throw new McpToolError('MESH_TOPOLOGY_LOCKED', error.message);
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a mesh-weight binding edit (WP-2.3 / WP-2.4), converting the binding guard into a typed
// MESH_BINDING tool error carrying the reason. The guard throws before any mutation, so a rejected edit
// changes nothing and pushes no history entry.
function executeBindingEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof MeshBindingError) {
      throw new McpToolError('MESH_BINDING', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a linked-mesh authoring edit (PP-D10), converting the linked-mesh guard into a typed LINKED_MESH
// tool error carrying the reason (parentMissing / parentInvalid / cycle / duplicateName / notFound). The
// guard throws before any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeLinkedMeshEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof LinkedMeshError) {
      throw new McpToolError('LINKED_MESH', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a constraint authoring edit (WP-2.6 / WP-2.7), converting the constraint guard into a typed
// CONSTRAINT tool error carrying the reason (a bad chain, a duplicate name, a cycle, a missing target).
// The guard throws before any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeConstraintEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof ConstraintError) {
      throw new McpToolError('CONSTRAINT', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a skin authoring edit (WP-2.8), converting the skin guard into a typed SKIN tool error carrying
// the reason (a duplicate name, the reserved 'default', a missing skin, a missing slot). The guard throws
// before any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeSkinEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof SkinError) {
      throw new McpToolError('SKIN', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a deform timeline edit (WP-2.9), converting the deform guard into a typed DEFORM tool error
// carrying the reason (the target is not a mesh, the offsets length is wrong, a keyframe is missing). The
// guard throws before any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeDeformEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof DeformError) {
      throw new McpToolError('DEFORM', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Brand a client-supplied event-definition id string; validated against the live model by requireEventDef,
// so a non-existent id is a typed EVENT_NOT_FOUND rather than a silent no-op (mirrors asBoneId).
function asEventDefId(id: string): EventDefId {
  return id as EventDefId;
}

// Require an existing document-level event definition by id (Stage F1), rejected as EVENT_NOT_FOUND.
function requireEventDef(session: Session, eventId: string): EventDefEntity {
  const def = session.document.model.getEventDef(asEventDefId(eventId));
  if (def === undefined) {
    throw new McpToolError('EVENT_NOT_FOUND', `no event definition with id "${eventId}"`);
  }
  return def;
}

// Execute an event-definition / event-timeline edit (Stage F1), converting the EventEditError guard into a
// typed EVENT_EDIT tool error carrying the reason (a duplicate name, an empty name, a missing definition, an
// audio range). The guard throws BEFORE any mutation, so a rejected edit changes nothing and pushes no
// history entry (mirrors executeSkinEdit).
function executeEventEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof EventEditError) {
      throw new McpToolError('EVENT_EDIT', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// Execute a draw-order-timeline edit (Stage F1), converting the DrawOrderError guard into a typed DRAW_ORDER
// tool error carrying the reason (a missing/duplicate slot, an out-of-range or colliding target offset). The
// guard throws BEFORE any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeDrawOrderEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof DrawOrderError) {
      throw new McpToolError('DRAW_ORDER', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

function asAnimationId(id: string): AnimationId {
  return id as AnimationId;
}

function asKeyframeId(id: string): KeyframeId {
  return id as KeyframeId;
}

function requireAnimation(session: Session, animationId: string): AnimationEntity {
  const animation = session.document.model.getAnimation(asAnimationId(animationId));
  if (animation === undefined) {
    throw new McpToolError('ANIMATION_NOT_FOUND', `no animation with id "${animationId}"`);
  }
  return animation;
}

function asIkConstraintId(id: string): IkConstraintId {
  return id as IkConstraintId;
}

// Require an existing IK constraint by id (WP-2.6). The id is branded and validated against the live model,
// so a non-existent id is rejected as IK_CONSTRAINT_NOT_FOUND before the command runs.
function requireIkConstraint(session: Session, id: string): IkConstraintEntity {
  const constraint = session.document.model.getIkConstraint(asIkConstraintId(id));
  if (constraint === undefined) {
    throw new McpToolError('IK_CONSTRAINT_NOT_FOUND', `no IK constraint with id "${id}"`);
  }
  return constraint;
}

function asTransformConstraintId(id: string): TransformConstraintId {
  return id as TransformConstraintId;
}

// Require an existing transform constraint by id (WP-2.7), rejected as TRANSFORM_CONSTRAINT_NOT_FOUND.
function requireTransformConstraint(session: Session, id: string): TransformConstraintEntity {
  const constraint = session.document.model.getTransformConstraint(asTransformConstraintId(id));
  if (constraint === undefined) {
    throw new McpToolError(
      'TRANSFORM_CONSTRAINT_NOT_FOUND',
      `no transform constraint with id "${id}"`,
    );
  }
  return constraint;
}

function asSkinId(id: string): SkinId {
  return id as SkinId;
}

// Require an existing NAMED skin by id (WP-2.8), rejected as SKIN_NOT_FOUND. The implicit 'default' skin is
// never a SkinEntity, so it is not reachable here (deform tools accept it via resolveDeformSkinKey instead).
function requireSkin(session: Session, id: string): SkinEntity {
  const skin = session.document.model.getSkin(asSkinId(id));
  if (skin === undefined) {
    throw new McpToolError('SKIN_NOT_FOUND', `no named skin with id "${id}"`);
  }
  return skin;
}

// Resolve a deform skin key (WP-2.9): the literal 'default' addresses the implicit default skin, otherwise
// the string is a SkinId that MUST resolve to a live named skin (rejected as SKIN_NOT_FOUND). Deform offsets
// are keyed per skin, so the named-skin existence is validated at the boundary before the command runs.
function resolveDeformSkinKey(session: Session, skin: string): DeformSkinKey {
  if (skin === 'default') return 'default';
  return requireSkin(session, skin).id;
}

// Read the keyframes currently on a target channel (or [] when the bone/slot has no timeline set).
function channelKeyframes(
  animation: AnimationEntity,
  target: KeyframeTarget,
): readonly KeyframeEntity[] {
  if (target.kind === 'bone') {
    return animation.bones.get(target.boneId)?.[target.channel] ?? [];
  }
  return animation.slots.get(target.slotId)?.color ?? [];
}

// Resolve a channel + bone/slot id into a KeyframeTarget, validating that the channel/id pair is
// consistent and the referenced bone/slot exists (a typed boundary check, not a silent no-op).
function resolveTarget(
  session: Session,
  channel: BoneChannel | 'color',
  boneId: string | undefined,
  slotId: string | undefined,
): KeyframeTarget {
  if (channel === 'color') {
    if (slotId === undefined) {
      throw new McpToolError('INVALID_INPUT', 'the color channel requires slotId');
    }
    requireSlot(session, slotId);
    return { kind: 'slot', slotId: asSlotId(slotId), channel: 'color' };
  }
  if (boneId === undefined) {
    throw new McpToolError('INVALID_INPUT', `the ${channel} channel requires boneId`);
  }
  requireBone(session, boneId);
  return { kind: 'bone', boneId: asBoneId(boneId), channel };
}

// Validate that a keyframe value's shape matches its channel (the model stores it as given, so the
// boundary is where a mismatch must be rejected before it reaches the document).
function checkValueShape(channel: BoneChannel | 'color', value: KeyframeValue): KeyframeValue {
  const ok =
    channel === 'rotate'
      ? 'angle' in value
      : channel === 'color'
        ? 'color' in value
        : 'x' in value && 'y' in value;
  if (!ok) {
    throw new McpToolError('INVALID_INPUT', `value shape does not match channel "${channel}"`);
  }
  return value;
}

function requireKeyframe(
  animation: AnimationEntity,
  target: KeyframeTarget,
  keyframeId: string,
): void {
  if (!channelKeyframes(animation, target).some((kf) => kf.id === keyframeId)) {
    throw new McpToolError(
      'KEYFRAME_NOT_FOUND',
      `no keyframe "${keyframeId}" on the target channel`,
    );
  }
}

// Export the model to format, converting the document-core failure modes into typed tool errors (an
// empty document, a dangling reference, or a name collision is INVALID_DOCUMENT, never an uncaught
// throw). This is the LAW 3 fail-loud boundary surfaced to the MCP client.
function exportOrThrow(model: DocumentReadModel): SkeletonDocument {
  try {
    return exportDocument(model);
  } catch (error) {
    if (error instanceof ExportValidationError) {
      throw new McpToolError(
        'INVALID_DOCUMENT',
        'document is not valid for export',
        error.report.errors,
      );
    }
    if (error instanceof DocumentInvariantError) {
      throw new McpToolError('INVALID_DOCUMENT', error.message);
    }
    throw error;
  }
}

function boneView(bone: BoneEntity): Record<string, unknown> {
  return {
    id: bone.id,
    name: bone.name,
    parent: bone.parent,
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  };
}

function slotView(slot: SlotEntity): Record<string, unknown> {
  return {
    id: slot.id,
    name: slot.name,
    bone: slot.bone,
    color: slot.color,
    darkColor: slot.darkColor,
    attachment: slot.attachment,
    blendMode: slot.blendMode,
  };
}

function keyframeView(kf: KeyframeEntity): Record<string, unknown> {
  return { id: kf.id, time: kf.time, value: kf.value, curve: kf.curve };
}

// Project an IK constraint for `ik.list` / `ik.get` (bones/target are internal BoneId references). The Stage
// F2 depth fields (ADR-0009) are projected so a client can read what ik.setDepth wrote; `order` is emitted
// only when the constraint carries an explicit solve order.
function ikConstraintView(c: IkConstraintEntity): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    bones: [...c.bones],
    target: c.target,
    mix: c.mix,
    bendPositive: c.bendPositive,
    softness: c.softness,
    stretch: c.stretch,
    compress: c.compress,
    uniform: c.uniform,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Project a transform constraint for `transform.list` / `transform.get` (all six mix and six offset
// channels; bones/target are internal BoneId references).
function transformConstraintView(c: TransformConstraintEntity): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    bones: [...c.bones],
    target: c.target,
    mixRotate: c.mixRotate,
    mixX: c.mixX,
    mixY: c.mixY,
    mixScaleX: c.mixScaleX,
    mixScaleY: c.mixScaleY,
    mixShearY: c.mixShearY,
    offsetRotation: c.offsetRotation,
    offsetX: c.offsetX,
    offsetY: c.offsetY,
    offsetScaleX: c.offsetScaleX,
    offsetScaleY: c.offsetScaleY,
    offsetShearY: c.offsetShearY,
    // Stage F2 (ADR-0009) variant flags, projected so a client reads what transform.setVariants wrote;
    // `order` is emitted only when the constraint carries an explicit solve order.
    local: c.local,
    relative: c.relative,
    ...(c.order !== undefined ? { order: c.order } : {}),
  };
}

// Project a named skin for `skin.list` / `skin.get`: its attachments as a flat list of (slotId, name, kind)
// addresses (the geometry detail lives on the slot's default-skin attachment query, mirroring slot.get).
function skinView(skin: SkinEntity): Record<string, unknown> {
  const attachments: Array<{ slotId: string; name: string; kind: string }> = [];
  for (const [slotIdKey, byName] of skin.attachments) {
    for (const att of byName.values()) {
      attachments.push({ slotId: slotIdKey, name: att.name, kind: att.kind });
    }
  }
  return { id: skin.id, name: skin.name, attachments };
}

// Project a document-level event definition for `event.list` / `event.get` (its payload defaults and the
// optional audio hint; identity is the id, `name` is the mutable on-disk label the timeline references).
function eventDefView(def: EventDefEntity): Record<string, unknown> {
  return {
    id: def.id,
    name: def.name,
    int: def.int,
    float: def.float,
    string: def.string,
    audio: def.audio,
  };
}

// A summary of an animation (ids, name, duration, and per-bone/slot track + event/draw-order key counts);
// the keyframe detail lives in animationView for `anim.get`.
function animationSummary(animation: AnimationEntity): Record<string, unknown> {
  return {
    id: animation.id,
    name: animation.name,
    duration: animation.duration,
    boneTracks: animation.bones.size,
    slotTracks: animation.slots.size,
    eventKeys: animation.events.length,
    drawOrderKeys: animation.drawOrder.length,
  };
}

// The full animation projection (every track and keyframe) for `anim.get`, keyed by branded bone/slot id.
function animationView(animation: AnimationEntity): Record<string, unknown> {
  return {
    id: animation.id,
    name: animation.name,
    duration: animation.duration,
    bones: [...animation.bones.entries()].map(([boneIdKey, set]) => ({
      boneId: boneIdKey,
      rotate: set.rotate.map(keyframeView),
      translate: set.translate.map(keyframeView),
      scale: set.scale.map(keyframeView),
      shear: set.shear.map(keyframeView),
    })),
    slots: [...animation.slots.entries()].map(([slotIdKey, set]) => ({
      slotId: slotIdKey,
      color: set.color.map(keyframeView),
      attachment: set.attachment.map((frame) => ({
        id: frame.id,
        time: frame.time,
        name: frame.name,
      })),
    })),
    // IK and transform constraint timelines, keyed by constraint id. Each keyframe carries its id so the
    // keyed edit/delete/move tools (ik.deleteKeyframe, ik.moveKeyframe, transform.*) have a target to name.
    ik: [...animation.ik.entries()].map(([constraintIdKey, frames]) => ({
      ikConstraintId: constraintIdKey,
      keyframes: frames.map((kf) => ({
        id: kf.id,
        time: kf.time,
        mix: kf.mix,
        bendPositive: kf.bendPositive,
        curve: kf.curve,
      })),
    })),
    transform: [...animation.transform.entries()].map(([constraintIdKey, frames]) => ({
      transformConstraintId: constraintIdKey,
      keyframes: frames.map((kf) => ({
        id: kf.id,
        time: kf.time,
        mixRotate: kf.mixRotate,
        mixX: kf.mixX,
        mixY: kf.mixY,
        mixScaleX: kf.mixScaleX,
        mixScaleY: kf.mixScaleY,
        mixShearY: kf.mixShearY,
        curve: kf.curve,
      })),
    })),
    events: animation.events.map((key) => ({
      id: key.id,
      time: key.time,
      event: key.event,
      int: key.int,
      float: key.float,
      string: key.string,
    })),
    drawOrder: animation.drawOrder.map((key) => ({
      id: key.id,
      time: key.time,
      offsets: key.offsets.map((entry) => ({ slot: entry.slot, offset: entry.offset })),
    })),
  };
}

const transformModeSchema = z.enum([
  'normal',
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
]);

const blendModeSchema = z.enum(['normal', 'additive', 'multiply', 'screen']);

const colorComponent = z.number().finite().min(0).max(1);
const rgbaSchema = z
  .object({ r: colorComponent, g: colorComponent, b: colorComponent, a: colorComponent })
  .strict();

const documentId = z.string().min(1);
const boneId = z.string().min(1);
const slotId = z.string().min(1);
const animationId = z.string().min(1);
const keyframeId = z.string().min(1);
const attachmentName = z.string().min(1);

// Mesh geometry arrays (WP-2.1). The editor computes triangulation/uv interpolation/silhouette tracing
// and passes the arrays as data; the boundary checks finiteness, and the format validator enforces the
// deep topology rules (even uv/vertex lengths, in-range indices, weighted encoding) on export.
const numberArray = z.array(z.number().finite());
const hullLength = z.number().int().nonnegative();

// Mesh-weight binding (WP-2.3) and weight painting (WP-2.4) inputs. The initial bind weighting mode; the
// brush paint mode; one brush dab (a per-vertex weight adjustment for the active bone). The editor
// computes the dab set (radius / strength / falloff is editor-side); the command applies and normalizes.
const weightModeSchema = z.enum(['rigidNearest', 'equalSplit']);
const paintModeSchema = z.enum(['add', 'subtract', 'smooth']);
const weightDabSchema = z
  .object({
    vertexIndex: z.number().int().nonnegative(),
    deltaWeight: z.number().finite(),
  })
  .strict();

// A keyframe channel name (bone transform channels + the slot color channel). The handler resolves it
// with boneId/slotId into a branded KeyframeTarget and validates the pairing (resolveTarget).
const channelSchema = z.enum(['rotate', 'translate', 'scale', 'shear', 'color']);

// A keyframe value: one of the three disjoint channel value shapes. The handler checks the value shape
// matches the channel (checkValueShape); the union here keeps a malformed shape (e.g. extra keys) out.
const rotateValueSchema = z.object({ angle: z.number().finite() }).strict();
const vec2ValueSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const colorValueSchema = z.object({ color: rgbaSchema }).strict();
const keyframeValueSchema = z.union([rotateValueSchema, vec2ValueSchema, colorValueSchema]);

// A curve: 'linear' / 'stepped' / a cubic bezier. The value is stored AS GIVEN (clamping bezier x into
// [0, 1] is the WP-1.7 curve editor's job; the format validator rejects out-of-range x on export).
const bezierCurveSchema = z
  .object({
    type: z.literal('bezier'),
    cx1: z.number().finite(),
    cy1: z.number().finite(),
    cx2: z.number().finite(),
    cy2: z.number().finite(),
  })
  .strict();
const curveSchema = z.union([z.literal('linear'), z.literal('stepped'), bezierCurveSchema]);

// Constraint / skin reference ids (WP-2.6 to WP-2.9). Branded and validated against the live model by the
// require* helpers, so a non-existent id is a typed *_NOT_FOUND rather than a silent no-op.
const ikConstraintId = z.string().min(1);
const transformConstraintId = z.string().min(1);
const skinId = z.string().min(1);

// An IK constraint's mix blend and bend direction (WP-2.6). `mix` is the [0, 1] blend toward the solved
// pose; `bendPositive` is the bend-direction flag (sampled stepped at solve time).
const ikMixSchema = z.number().finite().min(0).max(1);

// A transform-constraint mix factor (WP-2.7): a per-channel blend in [0, 1]. The offsets are unbounded.
const transformMixSchema = z.number().finite().min(0).max(1);
const transformOffsetSchema = z.number().finite();

// The twelve mix/offset channels a transform constraint carries on create (the six mix factors in [0, 1]
// and the six additive offsets). The boundary validates ranges; the command stores them verbatim.
const transformParamsSchema = z
  .object({
    mixRotate: transformMixSchema.default(1),
    mixX: transformMixSchema.default(0),
    mixY: transformMixSchema.default(0),
    mixScaleX: transformMixSchema.default(0),
    mixScaleY: transformMixSchema.default(0),
    mixShearY: transformMixSchema.default(0),
    offsetRotation: transformOffsetSchema.default(0),
    offsetX: transformOffsetSchema.default(0),
    offsetY: transformOffsetSchema.default(0),
    offsetScaleX: transformOffsetSchema.default(0),
    offsetScaleY: transformOffsetSchema.default(0),
    offsetShearY: transformOffsetSchema.default(0),
  })
  .strict();

// The twelve transform-constraint channel keys as a typed tuple, so the setParams handler assembles a
// patch over a fixed, statically-typed key set (no `any`, no `as`): each key is a numeric channel field.
const TRANSFORM_PARAM_KEYS = [
  'mixRotate',
  'mixX',
  'mixY',
  'mixScaleX',
  'mixScaleY',
  'mixShearY',
  'offsetRotation',
  'offsetX',
  'offsetY',
  'offsetScaleX',
  'offsetScaleY',
  'offsetShearY',
] as const satisfies readonly (keyof TransformConstraintParams)[];

// A PARTIAL transform-constraint params patch (WP-2.7 setParams): only the named channels change; the rest
// keep their current value. At least one channel must be present (an empty patch is a no-op and rejected).
const transformParamsPatchSchema = z
  .object({
    mixRotate: transformMixSchema.optional(),
    mixX: transformMixSchema.optional(),
    mixY: transformMixSchema.optional(),
    mixScaleX: transformMixSchema.optional(),
    mixScaleY: transformMixSchema.optional(),
    mixShearY: transformMixSchema.optional(),
    offsetRotation: transformOffsetSchema.optional(),
    offsetX: transformOffsetSchema.optional(),
    offsetY: transformOffsetSchema.optional(),
    offsetScaleX: transformOffsetSchema.optional(),
    offsetScaleY: transformOffsetSchema.optional(),
    offsetShearY: transformOffsetSchema.optional(),
  })
  .strict();

// A transform keyframe's six per-channel mix factors (WP-2.7). Each is optional at the boundary; an OMITTED
// channel is keyed as `undefined` (it keeps its base value at solve time, ADR-0003), distinct from a 0 mix.
const transformKeyframeMixSchema = z
  .object({
    mixRotate: transformMixSchema.optional(),
    mixX: transformMixSchema.optional(),
    mixY: transformMixSchema.optional(),
    mixScaleX: transformMixSchema.optional(),
    mixScaleY: transformMixSchema.optional(),
    mixShearY: transformMixSchema.optional(),
  })
  .strict();

// A deform skin key (WP-2.9): the literal 'default' addresses the implicit default skin, otherwise a SkinId
// of a named skin (resolveDeformSkinKey validates a named id against the live model).
const deformSkinKey = z.string().min(1);

// One region attachment to set on a named skin (WP-2.8). Mirrors attach.region.add's region fields; the
// path references an atlas region resolved by the import-time validator (the command trusts the caller).
const skinRegionAttachmentSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
    x: z.number().finite().default(0),
    y: z.number().finite().default(0),
    rotation: z.number().finite().default(0),
    scaleX: z.number().finite().default(1),
    scaleY: z.number().finite().default(1),
    width: z.number().finite().default(0),
    height: z.number().finite().default(0),
    color: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
  })
  .strict();

// ============================================================================
// Effects (VFX / particles, Phase 3, WP-3.7) and slot-composer (Phase 4) control surface. Each
// mutating tool drives the SAME document-core command the GUI uses, on the live per-document History
// (LAW 2): effect edits share the ONE project undo stack with skeleton edits. Every input is validated
// at the boundary and every typed document-core failure (EffectEditError / SlotEditError /
// EffectsAtlasDanglingRegionError) is surfaced as a typed McpToolError carrying its reason (LAW 3).
// ============================================================================

const effectId = z.string().min(1);
const effectLayerId = z.string().min(1);
const lifeStopId = z.string().min(1);
const bundleItemId = z.string().min(1);
const bundleName = z.string().min(1);

// Brand a client-supplied id string; the id is validated against the live effects model by the require*
// helpers, so a non-existent id is a typed *_NOT_FOUND rather than a silent no-op (mirrors asBoneId).
function asEffectId(id: string): EffectId {
  return id as EffectId;
}
function asEffectLayerId(id: string): EffectLayerId {
  return id as EffectLayerId;
}
function asLifeStopId(id: string): LifeStopId {
  return id as LifeStopId;
}
function asBundleItemId(id: string): BundleItemId {
  return id as BundleItemId;
}

function requireEffect(session: Session, id: string): EffectEntity {
  const effect = session.document.effects.getEffect(asEffectId(id));
  if (effect === undefined) {
    throw new McpToolError('EFFECT_NOT_FOUND', `no effect with id "${id}"`);
  }
  return effect;
}

function requireLayer(session: Session, effect: string, layer: string): EffectLayerEntity {
  const found = session.document.effects.getLayer(asEffectId(effect), asEffectLayerId(layer));
  if (found === undefined) {
    throw new McpToolError('EFFECT_LAYER_NOT_FOUND', `no layer "${layer}" on effect "${effect}"`);
  }
  return found;
}

function requireBundle(session: Session, name: string): BundleEntity {
  const bundle = session.document.effects.getBundle(name);
  if (bundle === undefined) {
    throw new McpToolError('BUNDLE_NOT_FOUND', `no bundle "${name}"`);
  }
  return bundle;
}

// Execute an effect-editing command, converting the effects guards into typed tool errors. An
// EffectEditError carries its reason (a missing entity, a bad simulationDt, a life-curve floor, a stop
// order break, a value-shape mismatch, a missing bundle effect); a SetEffectsAtlas that drops a still
// referenced region carries the cross-reference report. The guards throw BEFORE any mutation, so a
// rejected edit changes nothing and pushes no history entry.
function executeEffectEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof EffectEditError) {
      throw new McpToolError('EFFECT_EDIT', error.message, { reason: error.reason });
    }
    if (error instanceof EffectsAtlasDanglingRegionError) {
      throw new McpToolError('EFFECTS_ATLAS_DANGLING_REGION', error.message, {
        errors: error.report.errors,
      });
    }
    throw error;
  }
  return session.document.effects.revision;
}

// Execute a slot-scene-editing command (grid / symbol / win-sequence / feature-flow / tumble),
// converting the SlotEditError guard into a typed SLOT_EDIT tool error carrying the reason. The guard
// throws BEFORE any mutation, so a rejected edit changes nothing and pushes no history entry.
function executeSlotEdit(session: Session, cmd: Command): number {
  try {
    session.document.history.execute(cmd);
  } catch (error) {
    if (error instanceof SlotEditError) {
      throw new McpToolError('SLOT_EDIT', error.message, { reason: error.reason });
    }
    throw error;
  }
  return session.document.model.revision;
}

// ----- effects value schemas (mirror the format effects layer contract at the MCP boundary) -----
// The effects layer sub-schemas are internal to the format package (they are not on its public barrel,
// and the document-core layer BODY drops the promoted life curves and trail curves), so the boundary
// contract is re-declared here as the exact shape of a document-core EffectLayerBody (effects-state.ts).

const effectsRangeSchema = z
  .object({ min: z.number().finite(), max: z.number().finite() })
  .strict();
const effectsVec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const effectsRgbSchema = z
  .object({ r: colorComponent, g: colorComponent, b: colorComponent })
  .strict();

const spawnConfigSchema = z.discriminatedUnion('mode', [
  z
    .object({ mode: z.literal('rate'), particlesPerSecond: z.number().finite().nonnegative() })
    .strict(),
  z
    .object({
      mode: z.literal('burst'),
      count: z.number().int().nonnegative(),
      atTime: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('bursts'),
      bursts: z
        .array(
          z
            .object({
              atTime: z.number().finite().nonnegative(),
              count: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);

const emitterShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point') }).strict(),
  z
    .object({
      kind: z.literal('line'),
      x1: z.number().finite(),
      y1: z.number().finite(),
      x2: z.number().finite(),
      y2: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('circle'),
      radius: z.number().finite().nonnegative(),
      edgeOnly: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rect'),
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
    })
    .strict(),
]);

const particleTextureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), region: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('animated'),
      regions: z.array(z.string().min(1)).min(1),
      fps: z.number().finite().positive(),
      mode: z.enum(['loop', 'overLife', 'once']),
    })
    .strict(),
]);

// The emitter's particle trail MINUS its two over-length life curves (those are promoted into the
// layer's curve set and edited through the life-stop tools); null when the emitter has no trail.
const emitterTrailBodySchema = z
  .object({
    region: z.string().min(1),
    maxSegments: z.number().int().min(1),
    segmentSpacing: z.number().finite().positive(),
  })
  .strict();

const emitterLayerBodySchema = z
  .object({
    type: z.literal('emitter'),
    name: z.string().min(1),
    maxParticles: z.number().int().min(1),
    spawn: spawnConfigSchema,
    shape: emitterShapeSchema,
    lifetime: effectsRangeSchema,
    startSpeed: effectsRangeSchema,
    emissionAngle: effectsRangeSchema,
    startRotation: effectsRangeSchema,
    angularVelocity: effectsRangeSchema,
    startScale: effectsRangeSchema,
    gravity: effectsVec2Schema,
    acceleration: effectsVec2Schema,
    drag: z.number().finite().nonnegative(),
    texture: particleTextureSchema,
    trail: emitterTrailBodySchema.nullable(),
  })
  .strict();

const spriteAnimatorLayerBodySchema = z
  .object({
    type: z.literal('spriteAnimator'),
    name: z.string().min(1),
    region: z.string().min(1),
    anchorSpace: z.enum(['world', 'screen']),
    rotationDegPerSec: z.number().finite(),
    loop: z.boolean(),
    layerDuration: z.number().finite().positive(),
  })
  .strict();

const ribbonTrailLayerBodySchema = z
  .object({
    type: z.literal('ribbonTrail'),
    name: z.string().min(1),
    region: z.string().min(1),
    anchorRef: z.string().min(1),
    maxSegments: z.number().int().min(1),
    segmentSpacing: z.number().finite().positive(),
  })
  .strict();

const layerBodySchema = z.discriminatedUnion('type', [
  emitterLayerBodySchema,
  spriteAnimatorLayerBodySchema,
  ribbonTrailLayerBodySchema,
]);

const newLayerKindSchema = z.enum(['emitter', 'spriteAnimator', 'ribbonTrail']);

// The eight life-curve fields a layer can carry (effects-state.ts LifeCurveField).
const lifeCurveFieldSchema = z.enum([
  'scaleOverLife',
  'colorOverLife',
  'alphaOverLife',
  'widthOverLength',
  'colorOverLength',
  'alphaOverLength',
  'trailWidthOverLength',
  'trailAlphaOverLength',
]);

// A life-curve stop value: a scalar (scale/alpha curves) or an RGB color (color curves). The command
// rejects a value whose shape does not match the target curve (lifeStopValueShape) at execute time.
const lifeStopValueSchema = z.union([z.number().finite(), effectsRgbSchema]);

// The effects atlas (AtlasRef): pages of packed regions. Mirrors the skeletal atlas schema; SetEffectsAtlas
// re-validates every layer's region reference against the candidate atlas and fails loudly on a dangling one.
const effectsAtlasRegionSchema = z
  .object({
    name: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
    rotated: z.boolean(),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    originalW: z.number().finite(),
    originalH: z.number().finite(),
  })
  .strict();
const effectsAtlasPageSchema = z
  .object({
    file: z.string(),
    width: z.number().finite(),
    height: z.number().finite(),
    regions: z.array(effectsAtlasRegionSchema),
  })
  .strict();
const effectsAtlasSchema = z.object({ pages: z.array(effectsAtlasPageSchema) }).strict();

// A bundle item's editable fields (the format BundleItem minus its id, with `effect` an EffectId string).
const bundleItemInitSchema = z
  .object({
    effect: effectId,
    startOffset: z.number().finite(),
    anchorRole: z.string().min(1),
    seedSalt: z.number().int(),
  })
  .strict();

// Project an effect entity to a list summary (the layer detail lives in `effect.get`).
function effectSummary(effect: EffectEntity): Record<string, unknown> {
  return {
    id: effect.id,
    name: effect.name,
    duration: effect.duration,
    deterministic: effect.deterministic,
    simulationDt: effect.simulationDt,
    blendMode: effect.blendMode,
    layerCount: effect.layerOrder.length,
  };
}

function bundleSummary(bundle: BundleEntity): Record<string, unknown> {
  return { name: bundle.name, itemCount: bundle.itemOrder.length };
}

// The slot-scene composer tools address symbols by SymbolId (a validated non-empty string brand). The
// input is bounded non-empty at the boundary; the phantom brand exists only in the type system.
const symbolIdInput = z.string().min(1);
function asSymbolId(id: string): SymbolId {
  return id as SymbolId;
}

// ----- slot-composer value schemas (mirror the format slot contract at the MCP boundary) -----
// The format slot sub-schemas resolve to a different Zod version than mcp-server (they cannot compose
// with mcp-server's Zod at the type level), so the boundary contract is re-declared here as the exact
// shape of each authored slot type (format-contract section 15.3); the commands re-validate semantics.
const symbolIdValueSchema = z
  .string()
  .min(1)
  .transform((value): SymbolId => value as SymbolId);

const gridTopologySchema = z.enum(['reelStrip', 'scatterPay', 'cluster']);
const gravityRuleSchema = z.enum(['column-down', 'cluster-down']);
const gridDimensionSchema = z.number().int().min(1).max(12);
const anticipationConfigSchema = z
  .object({
    triggerSymbols: z.array(symbolIdValueSchema),
    thresholdCount: z.number().int().finite(),
    maxAnticipatingCols: z.number().int().finite(),
  })
  .strict();
const gridConfigSchema = z
  .object({
    topology: gridTopologySchema,
    cols: gridDimensionSchema,
    rows: gridDimensionSchema,
    cellWidth: z.number().int().positive(),
    cellHeight: z.number().int().positive(),
    cellGap: z.number().int().nonnegative(),
    reelStopStaggerMs: z.number().int().nonnegative(),
    gravity: gravityRuleSchema,
    anticipation: anticipationConfigSchema,
  })
  .strict();

const symbolAnimSetSchema = z
  .object({
    skeletonRef: z.string().min(1),
    idle: z.string().min(1),
    land: z.string().min(1),
    win: z.string().min(1),
    anticipation: z.string().min(1).optional(),
  })
  .strict();

const rollupCurveSchema = z.enum(['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic']);
const escalationTierSchema = z.enum(['big', 'mega', 'epic']);
const winTargetRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allWinningCells') }).strict(),
  z.object({ kind: z.literal('byLine'), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('bySymbol'), symbol: symbolIdValueSchema }).strict(),
]);
const winStepActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('animateWin') }).strict(),
  z
    .object({
      kind: z.literal('vfx'),
      preset: z.string().min(1),
      anchorRule: z.enum(['eachCell', 'gridCenter']),
    })
    .strict(),
  z.object({ kind: z.literal('rollupStart'), curve: rollupCurveSchema }).strict(),
  z.object({ kind: z.literal('escalationBanner'), tier: escalationTierSchema }).strict(),
]);
const winSequenceStepSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    target: winTargetRuleSchema,
    action: winStepActionSchema,
  })
  .strict();
const escalationThresholdsSchema = z
  .object({
    big: z.number().nonnegative().finite(),
    mega: z.number().nonnegative().finite(),
    epic: z.number().nonnegative().finite(),
  })
  .strict();

const featureMatchSchema = z
  .object({
    type: z.string().min(1),
    dataEquals: z
      .object({ field: z.string().min(1), equals: z.union([z.number(), z.string(), z.boolean()]) })
      .strict()
      .optional(),
  })
  .strict();
const featureFlowCinematicSchema = z
  .object({ vfxPreset: z.string().min(1).optional(), animation: z.string().min(1).optional() })
  .strict();
const featureFlowNodeSchema = z
  .object({ cinematic: featureFlowCinematicSchema.optional() })
  .strict();
const featureFlowTransitionSchema = z
  .object({ from: z.string().min(1), on: featureMatchSchema, to: z.string().min(1) })
  .strict();

const durationMsSchema = z.number().int().nonnegative();
const tumbleChoreographySchema = z
  .object({
    explodeMs: durationMsSchema,
    dropMs: durationMsSchema,
    dropEasing: rollupCurveSchema,
    refillStaggerMs: durationMsSchema,
    settleMs: durationMsSchema,
    stepGapMs: durationMsSchema,
    rollupCurve: rollupCurveSchema,
  })
  .strict();

const effectsTools: readonly ToolDefinition[] = [
  // ----- effects: library + effect meta (each drives the WP-3.7 command on the shared History, LAW 2) -----
  defineTool(
    {
      name: 'effect.create',
      title: 'Create effect',
      description:
        'Create a new, layer-less effect in the VFX library and return its id. Add layers with ' +
        'effect.layer.add.',
      input: z
        .object({
          documentId,
          name: z.string().min(1),
          duration: z.number().finite().nullable().default(null),
          deterministic: z.boolean().default(true),
          simulationDt: z
            .number()
            .finite()
            .positive()
            .default(1 / 60),
          blendMode: blendModeSchema.default('normal'),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const command = new CreateEffectCommand({
        name: input.name,
        duration: input.duration,
        deterministic: input.deterministic,
        simulationDt: input.simulationDt,
        blendMode: input.blendMode,
      });
      executeEffectEdit(session, command);
      return { effectId: command.createdId };
    },
  ),
  defineTool(
    {
      name: 'effect.delete',
      title: 'Delete effect',
      description:
        'Delete an effect and cascade-remove every bundle item that references it (one undo step).',
      input: z.object({ documentId, effectId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      return {
        revision: executeEffectEdit(session, new DeleteEffectCommand(asEffectId(input.effectId))),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.rename',
      title: 'Rename effect',
      description:
        'Rename an effect (identity is the id, so bundle-item references are unaffected).',
      input: z.object({ documentId, effectId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      return {
        revision: executeEffectEdit(
          session,
          new RenameEffectCommand(asEffectId(input.effectId), input.name),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.setMeta',
      title: 'Set effect meta',
      description:
        'Set an effect duration (null = endless), deterministic flag, and/or simulationDt (must be > 0). ' +
        'Only the provided fields change.',
      input: z
        .object({
          documentId,
          effectId,
          duration: z.number().finite().nullable().optional(),
          deterministic: z.boolean().optional(),
          simulationDt: z.number().finite().positive().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      const patch: EffectMetaPatch = {
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.deterministic !== undefined ? { deterministic: input.deterministic } : {}),
        ...(input.simulationDt !== undefined ? { simulationDt: input.simulationDt } : {}),
      };
      return {
        revision: executeEffectEdit(
          session,
          new SetEffectMetaCommand(asEffectId(input.effectId), patch),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.setAtlas',
      title: 'Set effects atlas',
      description:
        'Replace the VFX atlas. Rejects (EFFECTS_ATLAS_DANGLING_REGION) any swap that drops a region a ' +
        'layer still references.',
      input: z.object({ documentId, atlas: effectsAtlasSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return { revision: executeEffectEdit(session, new SetEffectsAtlasCommand(input.atlas)) };
    },
  ),

  // ----- effects: layers -----
  defineTool(
    {
      name: 'effect.layer.add',
      title: 'Add effect layer',
      description:
        'Append a default layer (emitter / spriteAnimator / ribbonTrail) to an effect and return its id. ' +
        '`region` must resolve in the effects atlas or export will fail.',
      input: z
        .object({
          documentId,
          effectId,
          kind: newLayerKindSchema,
          blendMode: blendModeSchema.default('additive'),
          region: z.string().min(1),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      const command = new AddLayerCommand(
        asEffectId(input.effectId),
        input.kind satisfies NewLayerKind,
        input.blendMode,
        input.region,
      );
      executeEffectEdit(session, command);
      return { layerId: command.createdLayerId };
    },
  ),
  defineTool(
    {
      name: 'effect.layer.remove',
      title: 'Remove effect layer',
      description:
        'Remove a layer from an effect (one undo step restores it at its prior z position).',
      input: z.object({ documentId, effectId, layerId: effectLayerId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new RemoveLayerCommand(asEffectId(input.effectId), asEffectLayerId(input.layerId)),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.layer.reorder',
      title: 'Reorder effect layers',
      description:
        'Reorder an effect layers by an explicit ordered layer-id list (a permutation of the current ' +
        'layer ids; z order, first is bottom).',
      input: z.object({ documentId, effectId, order: z.array(effectLayerId).min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      return {
        revision: executeEffectEdit(
          session,
          new ReorderLayersCommand(asEffectId(input.effectId), input.order.map(asEffectLayerId)),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.layer.setField',
      title: 'Set effect layer field',
      description:
        'Replace a layer body with a full rebuilt body (the caller patches one field and passes the whole ' +
        'body). `field` is the coalesce key. The body `type` must match the existing layer type.',
      input: z
        .object({
          documentId,
          effectId,
          layerId: effectLayerId,
          field: z.string().min(1),
          body: layerBodySchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const layer = requireLayer(session, input.effectId, input.layerId);
      if (input.body.type !== layer.body.type) {
        throw new McpToolError(
          'INVALID_INPUT',
          `body type "${input.body.type}" does not match the layer type "${layer.body.type}"`,
        );
      }
      const body: EffectLayerBody = input.body;
      return {
        revision: executeEffectEdit(
          session,
          new SetLayerFieldCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            input.field,
            body,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.layer.setBlendMode',
      title: 'Set effect layer blend mode',
      description: 'Set a layer per-layer blend mode.',
      input: z
        .object({ documentId, effectId, layerId: effectLayerId, blendMode: blendModeSchema })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new SetLayerBlendModeCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            input.blendMode,
          ),
        ),
      };
    },
  ),

  // ----- effects: life curves (per-layer scale/color/alpha over life or over length) -----
  defineTool(
    {
      name: 'effect.lifeStop.add',
      title: 'Add life-curve stop',
      description:
        'Insert an interior stop (t in (0,1)) into a layer life curve, keeping t strictly ascending. ' +
        '`value` is a scalar or an {r,g,b} matching the curve field.',
      input: z
        .object({
          documentId,
          effectId,
          layerId: effectLayerId,
          field: lifeCurveFieldSchema,
          t: z.number().finite(),
          value: lifeStopValueSchema,
          curve: curveSchema.default('linear'),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new AddLifeStopCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            input.field,
            input.t,
            input.value,
            input.curve,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.lifeStop.remove',
      title: 'Remove life-curve stop',
      description:
        'Remove an interior stop from a layer life curve. The t=0 / t=1 anchors and the two-stop floor ' +
        'are protected (EFFECT_EDIT lifeCurveMinStops).',
      input: z
        .object({ documentId, effectId, layerId: effectLayerId, stopId: lifeStopId })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new RemoveLifeStopCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            asLifeStopId(input.stopId),
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.lifeStop.move',
      title: 'Move life-curve stop',
      description:
        'Move a stop to a new t, keeping strict-ascending order and the t=0 / t=1 anchor positions.',
      input: z
        .object({
          documentId,
          effectId,
          layerId: effectLayerId,
          stopId: lifeStopId,
          t: z.number().finite(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new MoveLifeStopCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            asLifeStopId(input.stopId),
            input.t,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.lifeStop.setValue',
      title: 'Set life-curve stop value',
      description: 'Set a stop value (a scalar or an {r,g,b} matching the curve field shape).',
      input: z
        .object({
          documentId,
          effectId,
          layerId: effectLayerId,
          stopId: lifeStopId,
          value: lifeStopValueSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new SetLifeStopValueCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            asLifeStopId(input.stopId),
            input.value,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.lifeStop.setCurve',
      title: 'Set life-curve stop easing',
      description: 'Set a stop outgoing easing (linear / stepped / a cubic bezier).',
      input: z
        .object({
          documentId,
          effectId,
          layerId: effectLayerId,
          stopId: lifeStopId,
          curve: curveSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireLayer(session, input.effectId, input.layerId);
      return {
        revision: executeEffectEdit(
          session,
          new SetLifeStopCurveCommand(
            asEffectId(input.effectId),
            asEffectLayerId(input.layerId),
            asLifeStopId(input.stopId),
            input.curve,
          ),
        ),
      };
    },
  ),

  // ----- effects: bundles (composed effect playlists, e.g. a big-win coin shower + ray burst) -----
  defineTool(
    {
      name: 'bundle.create',
      title: 'Create bundle',
      description: 'Create a new, empty, named effect bundle.',
      input: z.object({ documentId, name: bundleName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      executeEffectEdit(session, new CreateBundleCommand(input.name));
      return { name: input.name };
    },
  ),
  defineTool(
    {
      name: 'bundle.delete',
      title: 'Delete bundle',
      description: 'Delete a named bundle and all its items (one undo step).',
      input: z.object({ documentId, name: bundleName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      return { revision: executeEffectEdit(session, new DeleteBundleCommand(input.name)) };
    },
  ),
  defineTool(
    {
      name: 'bundle.item.add',
      title: 'Add bundle item',
      description:
        'Append an item (a referenced effect + startOffset + anchorRole + seedSalt) to a bundle. The ' +
        'referenced effect must exist (EFFECT_EDIT bundleEffectMissing).',
      input: z.object({ documentId, name: bundleName, item: bundleItemInitSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      const init: BundleItemInit = {
        effect: asEffectId(input.item.effect),
        startOffset: input.item.startOffset,
        anchorRole: input.item.anchorRole,
        seedSalt: input.item.seedSalt,
      };
      return { revision: executeEffectEdit(session, new AddBundleItemCommand(input.name, init)) };
    },
  ),
  defineTool(
    {
      name: 'bundle.item.remove',
      title: 'Remove bundle item',
      description: 'Remove an item from a bundle by its item id.',
      input: z.object({ documentId, name: bundleName, itemId: bundleItemId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      return {
        revision: executeEffectEdit(
          session,
          new RemoveBundleItemCommand(input.name, asBundleItemId(input.itemId)),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'bundle.item.reorder',
      title: 'Reorder bundle items',
      description: 'Reorder a bundle items by an explicit ordered item-id list (a permutation).',
      input: z
        .object({ documentId, name: bundleName, order: z.array(bundleItemId).min(1) })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      return {
        revision: executeEffectEdit(
          session,
          new ReorderBundleItemsCommand(input.name, input.order.map(asBundleItemId)),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'bundle.item.set',
      title: 'Set bundle item',
      description:
        'Patch a bundle item fields (effect / startOffset / anchorRole / seedSalt). Only the provided ' +
        'fields change; a new effect reference must exist.',
      input: z
        .object({
          documentId,
          name: bundleName,
          itemId: bundleItemId,
          effect: effectId.optional(),
          startOffset: z.number().finite().optional(),
          anchorRole: z.string().min(1).optional(),
          seedSalt: z.number().int().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      const patch: BundleItemPatch = {
        ...(input.effect !== undefined ? { effect: asEffectId(input.effect) } : {}),
        ...(input.startOffset !== undefined ? { startOffset: input.startOffset } : {}),
        ...(input.anchorRole !== undefined ? { anchorRole: input.anchorRole } : {}),
        ...(input.seedSalt !== undefined ? { seedSalt: input.seedSalt } : {}),
      };
      return {
        revision: executeEffectEdit(
          session,
          new SetBundleItemCommand(input.name, asBundleItemId(input.itemId), patch),
        ),
      };
    },
  ),

  // ----- effects: read (so an LLM can see the current library / atlas / bundles) -----
  defineTool(
    {
      name: 'effect.getSnapshot',
      title: 'Get effects snapshot',
      description:
        'Return the deterministic snapshot of the whole effects library (effects, atlas, bundles).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      snapshot: deps.sessions.get(input.documentId).document.effects.snapshot(),
    }),
  ),
  defineTool(
    {
      name: 'effect.list',
      title: 'List effects',
      description: 'List the effects (id, name, meta, layer count) in library order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      effects: deps.sessions.get(input.documentId).document.effects.effects().map(effectSummary),
    }),
  ),
  defineTool(
    {
      name: 'effect.get',
      title: 'Get effect',
      description: 'Get one effect with all its layers, bodies, and life curves by id.',
      input: z.object({ documentId, effectId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEffect(session, input.effectId);
      return {
        effect: findEffectSnapshot(session.document.effects.snapshot(), input.effectId),
      };
    },
  ),
  defineTool(
    {
      name: 'effect.getAtlas',
      title: 'Get effects atlas',
      description: 'Return the current VFX atlas (pages and regions).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ atlas: deps.sessions.get(input.documentId).document.effects.atlas() }),
  ),
  defineTool(
    {
      name: 'bundle.list',
      title: 'List bundles',
      description: 'List the effect bundles (name, item count) in bundle order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      bundles: deps.sessions.get(input.documentId).document.effects.bundles().map(bundleSummary),
    }),
  ),
  defineTool(
    {
      name: 'bundle.get',
      title: 'Get bundle',
      description: 'Get one bundle with all its items by name.',
      input: z.object({ documentId, name: bundleName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBundle(session, input.name);
      return { bundle: findBundleSnapshot(session.document.effects.snapshot(), input.name) };
    },
  ),
];

const slotSceneTools: readonly ToolDefinition[] = [
  // ----- slot composer: grid (each drives the WP-4.5+ command on the shared History, LAW 2) -----
  defineTool(
    {
      name: 'slot.grid.set',
      title: 'Set slot grid',
      description:
        'Set the slot grid config (topology + dimensions + gravity, optional anticipation). Rejects an ' +
        'invalid topology/shape combination (SLOT_EDIT).',
      input: z.object({ documentId, grid: gridConfigSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return { revision: executeSlotEdit(session, new SetGridConfigCommand(input.grid)) };
    },
  ),
  defineTool(
    {
      name: 'slot.grid.preset',
      title: 'Apply slot grid preset',
      description:
        'Apply a canonical grid preset in one call: reelStrip5x3, scatterPay6x5, or cluster7x7.',
      input: z
        .object({
          documentId,
          preset: z.enum(['reelStrip5x3', 'scatterPay6x5', 'cluster7x7']),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const command =
        input.preset === 'reelStrip5x3'
          ? SetGridConfigCommand.reelStrip5x3()
          : input.preset === 'scatterPay6x5'
            ? SetGridConfigCommand.scatterPay6x5()
            : SetGridConfigCommand.cluster7x7();
      return { revision: executeSlotEdit(session, command) };
    },
  ),

  // ----- slot composer: symbol library -----
  defineTool(
    {
      name: 'slot.symbol.map',
      title: 'Map symbol anim set',
      description:
        'Map a SymbolId to a skeleton + idle/land/win(/anticipation) animation set, adding the skeletonRef ' +
        'to the scene refs. Provide `skeletonAnimationNames` to enforce that the chosen names exist.',
      input: z
        .object({
          documentId,
          symbolId: symbolIdInput,
          animSet: symbolAnimSetSchema,
          skeletonAnimationNames: z.array(z.string()).optional(),
          skeletonHash: z.string().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const init: MapSymbolAnimSetInit = {
        animSet: input.animSet,
        ...(input.skeletonAnimationNames !== undefined
          ? { skeletonAnimationNames: input.skeletonAnimationNames }
          : {}),
        ...(input.skeletonHash !== undefined ? { skeletonHash: input.skeletonHash } : {}),
      };
      return {
        revision: executeSlotEdit(
          session,
          new MapSymbolAnimSetCommand(asSymbolId(input.symbolId), init),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'slot.symbol.unmap',
      title: 'Unmap symbol',
      description:
        'Remove a SymbolId mapping, pruning its skeletonRef when no remaining symbol references it. ' +
        'Rejects an unmapped symbol (SLOT_EDIT notMapped).',
      input: z.object({ documentId, symbolId: symbolIdInput }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(
          session,
          new MapSymbolAnimSetCommand(asSymbolId(input.symbolId), { animSet: null }),
        ),
      };
    },
  ),

  // ----- slot composer: win sequencer -----
  defineTool(
    {
      name: 'slot.winseq.create',
      title: 'Create win sequence',
      description: 'Create a new, empty, named win sequence. Rejects a duplicate name (SLOT_EDIT).',
      input: z.object({ documentId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return { revision: executeSlotEdit(session, new CreateWinSequenceCommand(input.name)) };
    },
  ),
  defineTool(
    {
      name: 'slot.winseq.setStep',
      title: 'Set win sequence step',
      description:
        'Set or append a step (atMs + target + action) at an index in a named sequence. An index equal to ' +
        'the step count appends; a smaller index replaces. The step shape is validated at the boundary.',
      input: z
        .object({
          documentId,
          sequenceName: z.string().min(1),
          index: z.number().int().nonnegative(),
          step: winSequenceStepSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(
          session,
          new SetWinSequenceStepCommand(input.sequenceName, input.index, input.step),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'slot.winseq.reorderSteps',
      title: 'Reorder win sequence steps',
      description:
        'Reorder a sequence steps by an explicit new-order array of current step indices (a permutation).',
      input: z
        .object({
          documentId,
          sequenceName: z.string().min(1),
          order: z.array(z.number().int().nonnegative()),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(
          session,
          new ReorderWinSequenceStepCommand(input.sequenceName, input.order),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'slot.winseq.setThresholds',
      title: 'Set escalation thresholds',
      description:
        'Set the big/mega/epic win escalation thresholds (finite, non-negative). Coalesces on the session.',
      input: z.object({ documentId, thresholds: escalationThresholdsSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(session, new SetEscalationThresholdCommand(input.thresholds)),
      };
    },
  ),

  // ----- slot composer: feature flow graph -----
  defineTool(
    {
      name: 'slot.flow.createState',
      title: 'Create feature flow state',
      description:
        'Add a named feature-flow state (optional cinematic node). Rejects a duplicate or empty name (SLOT_EDIT).',
      input: z
        .object({ documentId, name: z.string().min(1), node: featureFlowNodeSchema.optional() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const command =
        input.node !== undefined
          ? new CreateFeatureFlowStateCommand(input.name, input.node)
          : new CreateFeatureFlowStateCommand(input.name);
      return { revision: executeSlotEdit(session, command) };
    },
  ),
  defineTool(
    {
      name: 'slot.flow.deleteState',
      title: 'Delete feature flow state',
      description:
        'Delete a named state and every transition incident to it (one undo step). The mandatory "base" ' +
        'state cannot be deleted (SLOT_EDIT baseStateProtected).',
      input: z.object({ documentId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return { revision: executeSlotEdit(session, new DeleteFeatureFlowStateCommand(input.name)) };
    },
  ),
  defineTool(
    {
      name: 'slot.flow.renameState',
      title: 'Rename feature flow state',
      description:
        'Rename a state and rewrite every transition that references it. "base" cannot be renamed and the ' +
        'new name must not collide (SLOT_EDIT).',
      input: z.object({ documentId, from: z.string().min(1), to: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(session, new RenameFeatureFlowStateCommand(input.from, input.to)),
      };
    },
  ),
  defineTool(
    {
      name: 'slot.flow.addTransition',
      title: 'Add feature flow transition',
      description:
        'Append a transition (from + on match + to) to the feature-flow graph. The shape is validated at ' +
        'the boundary; endpoint existence is an import-time validator concern.',
      input: z.object({ documentId, transition: featureFlowTransitionSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(session, new AddFeatureFlowTransitionCommand(input.transition)),
      };
    },
  ),
  defineTool(
    {
      name: 'slot.flow.removeTransition',
      title: 'Remove feature flow transition',
      description: 'Remove one transition by its index in the graph transition list.',
      input: z.object({ documentId, index: z.number().int().nonnegative() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeSlotEdit(session, new RemoveFeatureFlowTransitionCommand(input.index)),
      };
    },
  ),

  // ----- slot composer: tumble / cascade choreography -----
  defineTool(
    {
      name: 'slot.tumble.set',
      title: 'Set tumble choreography',
      description:
        'Set the tumble/cascade timing (explode/drop/refill/settle/step ms as non-negative integers) plus ' +
        'the drop easing and rollup curve. Coalesces on the session.',
      input: z.object({ documentId, tumble: tumbleChoreographySchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return { revision: executeSlotEdit(session, new SetTumbleChoreographyCommand(input.tumble)) };
    },
  ),

  // ----- slot composer: read (so an LLM can see the current scene state) -----
  defineTool(
    {
      name: 'slot.scene.get',
      title: 'Get slot scene',
      description:
        'Return the whole slot-scene snapshot (grid, symbol library, win sequencer, feature flows, tumble, refs).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      scene: deps.sessions.get(input.documentId).document.model.snapshot().slotScene,
    }),
  ),
  defineTool(
    {
      name: 'slot.grid.get',
      title: 'Get slot grid',
      description: 'Return the current slot grid config.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ grid: deps.sessions.get(input.documentId).document.model.slotGrid() }),
  ),
  defineTool(
    {
      name: 'slot.symbol.list',
      title: 'List mapped symbols',
      description: 'List the mapped symbols (SymbolId + anim set) in id order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      symbols: deps.sessions.get(input.documentId).document.model.snapshot().slotScene.symbols,
    }),
  ),
  defineTool(
    {
      name: 'slot.symbol.get',
      title: 'Get mapped symbol',
      description:
        'Return the anim set mapped to one SymbolId, or null when the symbol is unmapped.',
      input: z.object({ documentId, symbolId: symbolIdInput }).strict(),
    },
    (deps, input) => ({
      animSet:
        deps.sessions
          .get(input.documentId)
          .document.model.getSymbolAnimSet(asSymbolId(input.symbolId)) ?? null,
    }),
  ),
  defineTool(
    {
      name: 'slot.winseq.get',
      title: 'Get win sequencer',
      description: 'Return the win-sequencer config (sequences, thresholds, default sequence).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      winSequencer: deps.sessions.get(input.documentId).document.model.slotScene().winSequencer,
    }),
  ),
  defineTool(
    {
      name: 'slot.flow.get',
      title: 'Get feature flow graph',
      description: 'Return the feature-flow graph (states, transitions, entry).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      featureFlows: deps.sessions.get(input.documentId).document.model.slotScene().featureFlows,
    }),
  ),
  defineTool(
    {
      name: 'slot.tumble.get',
      title: 'Get tumble choreography',
      description: 'Return the tumble/cascade choreography.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ tumble: deps.sessions.get(input.documentId).document.model.slotTumble() }),
  ),
];

// ============================================================================
// Events, draw-order timelines, and document metadata (Stage F1, ADR-0008, PP-D9). Each mutating tool
// drives the SAME document-core command the GUI uses on the shared per-document History (LAW 2): an event
// or draw-order edit shares the ONE project undo stack with skeleton edits. Ids are client-supplied and
// validated against the live model by the require* helpers; every typed document-core failure
// (EventEditError / DrawOrderError / KeyframeCollisionError / CommandTargetMissingError) is surfaced as a
// typed McpToolError (LAW 3).
// ============================================================================

const eventId = z.string().min(1);

// An event's optional audio hint. `volume` / `balance` are passed through unclamped so the command's
// audioRange guard (volume in [0, 1], balance in [-1, 1]) is the single range authority and surfaces as a
// typed EVENT_EDIT (mirroring how the effects tools defer semantic range checks to the command).
const eventAudioSchema = z
  .object({
    path: z.string().min(1),
    volume: z.number().finite(),
    balance: z.number().finite(),
  })
  .strict();

// One draw-order offset entry: move `slot` by a signed integer number of positions from its setup draw
// index. The command re-validates slot existence and target consistency (assertConsistentDrawOrder).
const drawOrderOffsetSchema = z
  .object({ slot: slotId, offset: z.number().int().finite() })
  .strict();

const eventTools: readonly ToolDefinition[] = [
  // ----- event definitions (document-level; each drives the Stage F1 command on the shared History) -----
  defineTool(
    {
      name: 'event.define',
      title: 'Define event',
      description:
        'Create a document-level event definition (its int/float/string payload defaults and an optional ' +
        'audio hint) and return its id. The name must be unique across event definitions.',
      input: z
        .object({
          documentId,
          name: z.string().min(1),
          int: z.number().finite().optional(),
          float: z.number().finite().optional(),
          string: z.string().optional(),
          audio: eventAudioSchema.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const id = session.document.ids.mint('eventDef');
      const init: EventDefInit = {
        int: input.int,
        float: input.float,
        string: input.string,
        audio: input.audio,
      };
      executeEventEdit(session, new DefineEventCommand(id, input.name, init));
      return { eventId: id };
    },
  ),
  defineTool(
    {
      name: 'event.rename',
      title: 'Rename event',
      description:
        'Rename an event definition (identity is the id, so an animation event key never re-binds). The ' +
        'new name must be unique across event definitions.',
      input: z.object({ documentId, eventId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEventDef(session, input.eventId);
      return {
        revision: executeEventEdit(
          session,
          new RenameEventCommand(asEventDefId(input.eventId), input.name),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'event.delete',
      title: 'Delete event',
      description:
        'Delete an event definition and cascade-remove every animation event key that fires it (one undo ' +
        'step).',
      input: z.object({ documentId, eventId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEventDef(session, input.eventId);
      return {
        revision: executeEventEdit(session, new DeleteEventCommand(asEventDefId(input.eventId))),
      };
    },
  ),
  defineTool(
    {
      name: 'event.setDefaults',
      title: 'Set event defaults',
      description:
        'Replace an event definition int/float/string payload defaults wholesale (an absent field clears ' +
        'that default). The audio hint is left untouched.',
      input: z
        .object({
          documentId,
          eventId,
          int: z.number().finite().optional(),
          float: z.number().finite().optional(),
          string: z.string().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEventDef(session, input.eventId);
      const defaults: EventDefaults = {
        int: input.int,
        float: input.float,
        string: input.string,
      };
      return {
        revision: executeEventEdit(
          session,
          new SetEventDefaultsCommand(asEventDefId(input.eventId), defaults),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'event.setAudio',
      title: 'Set event audio',
      description:
        'Set (or, when audio is absent, clear) an event definition audio hint. `volume` must be in [0, 1] ' +
        'and `balance` in [-1, 1] (EVENT_EDIT audioRange otherwise).',
      input: z.object({ documentId, eventId, audio: eventAudioSchema.optional() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireEventDef(session, input.eventId);
      const audio: EventAudioValue | undefined = input.audio;
      return {
        revision: executeEventEdit(
          session,
          new SetEventAudioCommand(asEventDefId(input.eventId), audio),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'event.list',
      title: 'List events',
      description: 'List the document-level event definitions (id, name, payload defaults, audio hint).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      events: deps.sessions.get(input.documentId).document.model.eventDefs().map(eventDefView),
    }),
  ),
  defineTool(
    {
      name: 'event.get',
      title: 'Get event',
      description: 'Get one document-level event definition by id.',
      input: z.object({ documentId, eventId }).strict(),
    },
    (deps, input) => ({
      event: eventDefView(requireEventDef(deps.sessions.get(input.documentId), input.eventId)),
    }),
  ),

  // ----- event timeline keys (per animation; fire an event definition at a time, optional overrides) -----
  defineTool(
    {
      name: 'event.key.set',
      title: 'Set event key',
      description:
        'Insert or update an event-timeline key that fires an event definition at a time, optionally ' +
        'overriding its int/float/string payload defaults (an absent override defers to the definition). ' +
        'Updating an existing key that fires the same event at the same time keeps its id.',
      input: z
        .object({
          documentId,
          animationId,
          eventId,
          time: z.number().finite().nonnegative(),
          int: z.number().finite().optional(),
          float: z.number().finite().optional(),
          string: z.string().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireEventDef(session, input.eventId);
      const overrides: EventKeyOverrides = {
        int: input.int,
        float: input.float,
        string: input.string,
      };
      return {
        revision: executeEventEdit(
          session,
          new SetEventKeyCommand(
            asAnimationId(input.animationId),
            asEventDefId(input.eventId),
            input.time,
            overrides,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'event.key.move',
      title: 'Move event key',
      description:
        'Move an event-timeline key (by id) to a new time, keeping the timeline non-decreasing in time ' +
        '(coincident event firings are legal). A time with no such key is a typed KEYFRAME_NOT_FOUND.',
      input: z
        .object({
          documentId,
          animationId,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      try {
        session.document.history.execute(
          new MoveEventKeyCommand(
            asAnimationId(input.animationId),
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no event key "${input.keyframeId}" on animation "${input.animationId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'event.key.delete',
      title: 'Delete event key',
      description:
        'Delete an event-timeline key (by id) from an animation. A missing key is a typed ' +
        'KEYFRAME_NOT_FOUND.',
      input: z.object({ documentId, animationId, keyframeId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      try {
        session.document.history.execute(
          new DeleteEventKeyCommand(
            asAnimationId(input.animationId),
            asKeyframeId(input.keyframeId),
          ),
        );
      } catch (error) {
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no event key "${input.keyframeId}" on animation "${input.animationId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),

  // ----- draw-order timeline keys (per animation; reorder slots over time by signed offsets) -----
  defineTool(
    {
      name: 'draworder.key.set',
      title: 'Set draw-order key',
      description:
        'Insert or update a draw-order key at a time: a compact list of per-slot signed offsets from the ' +
        'setup draw order (an empty list restores the setup order). Each slot must exist and target a ' +
        'distinct in-range index (DRAW_ORDER otherwise). Updating an existing key at the same time keeps ' +
        'its id.',
      input: z
        .object({
          documentId,
          animationId,
          time: z.number().finite().nonnegative(),
          offsets: z.array(drawOrderOffsetSchema),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const offsets: DrawOrderOffsetEntity[] = input.offsets.map((entry) => ({
        slot: asSlotId(entry.slot),
        offset: entry.offset,
      }));
      return {
        revision: executeDrawOrderEdit(
          session,
          new SetDrawOrderKeyCommand(asAnimationId(input.animationId), input.time, offsets),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'draworder.key.move',
      title: 'Move draw-order key',
      description:
        'Move a draw-order key (by id) to a new time (draw-order times are strictly ascending). Landing ' +
        'on an occupied time is a typed KEYFRAME_COLLISION; a missing key is a typed KEYFRAME_NOT_FOUND.',
      input: z
        .object({
          documentId,
          animationId,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      try {
        session.document.history.execute(
          new MoveDrawOrderKeyCommand(
            asAnimationId(input.animationId),
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no draw-order key "${input.keyframeId}" on animation "${input.animationId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'draworder.key.delete',
      title: 'Delete draw-order key',
      description:
        'Delete a draw-order key (by id) from an animation. A missing key is a typed KEYFRAME_NOT_FOUND.',
      input: z.object({ documentId, animationId, keyframeId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      try {
        session.document.history.execute(
          new DeleteDrawOrderKeyCommand(
            asAnimationId(input.animationId),
            asKeyframeId(input.keyframeId),
          ),
        );
      } catch (error) {
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no draw-order key "${input.keyframeId}" on animation "${input.animationId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
];

// ----- skeletal atlas (AtlasRef) schema: mirrors packages/format schema/atlas.ts at the MCP boundary.
// The editor's atlas-pack pipeline produces this in the main process; atlas.set is the only legal path
// that installs it on the live document (LAW 2, SetAtlasRefCommand). Sprite/mesh attachment `path`
// references resolve against these region names, so setting the atlas unblocks a valid region attachment.
const atlasRegionInputSchema = z
  .object({
    name: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
    rotated: z.boolean(),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    originalW: z.number().finite(),
    originalH: z.number().finite(),
  })
  .strict();
const atlasPageInputSchema = z
  .object({
    file: z.string(),
    width: z.number().finite(),
    height: z.number().finite(),
    regions: z.array(atlasRegionInputSchema),
  })
  .strict();
const atlasRefInputSchema = z.object({ pages: z.array(atlasPageInputSchema) }).strict();

// ----- headless atlas packing (atlas.pack, ADR-0007) -----
// Run the shared deterministic atlas-pack pipeline (import -> alpha-trim -> maxrects pack -> emit) with
// the host FileStore as its AtlasFileStore seam, so an LLM authoring over MCP can PRODUCE an atlas, not
// just install a pre-baked one. Both directories are project-relative and confined to the project root by
// the FileStore (a traversal is PATH_FORBIDDEN before any disk access, identical to the render_frame page
// reads). The pipeline reads source PNGs via readBinary/listDir and writes page PNGs via writeBinary; the
// emitted AtlasRef is then installed through SetAtlasRefCommand on the live History (LAW 2).

// Adapt the MCP FileStore onto the pipeline's AtlasFileStore. The three methods map one-to-one and inherit
// the FileStore's root confinement, so the pipeline cannot read or write outside the project.
function atlasFileStoreFrom(files: FileStore): AtlasFileStore {
  return {
    readBytes: (path) => files.readBinary(path),
    writeBytes: (path, data) => files.writeBinary(path, data),
    listDir: (path) => files.listDir(path),
  };
}

// Record a packed page path project-relative (output-directory-prefixed) so render_frame reads it back
// through the same FileStore. This must mirror the path the pipeline's emit step wrote to
// (join(outputDir, page.file)); page.file is a bare basename with no separators, so a forward-slash join
// is the portable, deterministic form (the FileStore resolves it against the project root on read).
function joinProjectPath(dir: string, file: string): string {
  const trimmed = dir.replace(/[\\/]+$/, '');
  return trimmed.length === 0 ? file : `${trimmed}/${file}`;
}

// Map a pipeline AtlasError onto an ATLAS_PACK_* McpToolError. The AtlasError code (e.g. ATLAS_SPRITE_TOO_LARGE)
// becomes ATLAS_PACK_SPRITE_TOO_LARGE, so a client branches on a stable, loud, pack-scoped code while the
// original code is preserved in `detail`. A PATH_FORBIDDEN from the confined FileStore is surfaced verbatim.
function mapAtlasPackError(error: unknown): never {
  if (error instanceof McpToolError) throw error;
  if (isAtlasError(error)) {
    throw new McpToolError(`ATLAS_PACK_${error.code.replace(/^ATLAS_/, '')}`, error.message, {
      atlasCode: error.code,
    });
  }
  throw error;
}

// ============================================================================
// Headless render feedback (render_frame, ADR-0006): rasterize the CURRENT live document to a PNG so an
// LLM authoring over MCP can SEE a frame. The render itself is the pure @marionette/render-preview CPU
// rasterizer; the MCP layer's job is to (1) export the live document through the SAME LAW-3 boundary the
// other read tools use, (2) resolve and decode the atlas page PNGs the document references from disk, and
// (3) map the rasterizer's typed errors onto McpToolError codes. Atlas pages are located relative to the
// project root the server was launched with: each AtlasPage.file is a project-relative path handed to the
// host FileStore, which resolves it against the root and rejects traversal (PATH_FORBIDDEN).
// ============================================================================

const renderDimension = z.number().int().min(1).max(2048);

// An explicit world rectangle to frame (fit != 'content'). w/h must be positive (a degenerate rect has no
// area to frame); the rasterizer would otherwise reject it as INVALID_VIEWPORT, so validate at the boundary.
const renderFitRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite().positive(),
    h: z.number().finite().positive(),
  })
  .strict();

const renderFitSchema = z.union([z.literal('content'), renderFitRectSchema]);

// The optional effects overlay for render_frame. When present, render_frame exports the live effects
// library, solves the named effect/bundle (runtime-core's EffectSystem, inside renderComposedFrame), and
// draws it AFTER the skeleton into the same framebuffer so an authored big-win moment (scene + coin shower)
// previews as one PNG. Exactly one of `effect` / `bundle` names the trigger target: the render-preview
// EffectTriggerError rejects zero or both as RENDER_INVALID_EFFECT_TRIGGER (validated by the solver, not
// duplicated here). `seed` drives the deterministic solve. `time` defaults to the skeleton `time` (or 0 at
// setup pose). Anchors are WORLD-space only in this pass: a bone anchor (resolveBone) is intentionally NOT
// wired here, so an anchor is an {x, y, rotation?} point keyed by role (a single effect reads the 'default'
// role; a bundle resolves each item's anchorRole).
const renderEffectAnchorSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite().optional(),
  })
  .strict();

const renderEffectSchema = z
  .object({
    effect: z.string().min(1).optional(),
    bundle: z.string().min(1).optional(),
    seed: z.number().int(),
    time: z.number().finite().nonnegative().optional(),
    anchors: z.record(z.string().min(1), renderEffectAnchorSchema).optional(),
  })
  .strict();

// Read one atlas page's bytes through the host FileStore. A path that escapes the project root is a typed
// PATH_FORBIDDEN (surfaced verbatim); any other read failure means the referenced page file is absent or
// unreadable on disk, which is a loud RENDER_ATLAS_PAGE_MISSING per ADR-0006 (the rasterizer's white
// placeholder is only for an absent MAP entry, never for a page the document explicitly references).
async function readAtlasPageBytes(files: FileStore, file: string): Promise<Uint8Array> {
  try {
    return await files.readBinary(file);
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    throw new McpToolError(
      'RENDER_ATLAS_PAGE_MISSING',
      `atlas page file "${file}" is missing or unreadable on disk`,
      { file },
    );
  }
}

// Decode a page PNG into straight-alpha RGBA pixels for the rasterizer. A file that is not a valid PNG is a
// loud RENDER_MALFORMED_ATLAS_PAGE (distinct from a missing file). pngjs decodes to non-premultiplied RGBA
// of length width*height*4, exactly the AtlasPagePixels contract.
function decodeAtlasPage(file: string, bytes: Uint8Array): AtlasPagePixels {
  let png: PNG;
  try {
    png = PNG.sync.read(Buffer.from(bytes));
  } catch {
    throw new McpToolError(
      'RENDER_MALFORMED_ATLAS_PAGE',
      `atlas page file "${file}" is not a valid PNG`,
      { file },
    );
  }
  return { width: png.width, height: png.height, rgba: png.data };
}

// Resolve and decode every page of an AtlasRef into the rasterizer's page-pixel map, keyed by
// AtlasPage.file. Shared by the skeleton atlas and the effects overlay atlas: each page file is read
// through the confined host FileStore (traversal => PATH_FORBIDDEN, absent => RENDER_ATLAS_PAGE_MISSING)
// and decoded (non-PNG => RENDER_MALFORMED_ATLAS_PAGE). An atlas with no pages yields an empty map, which
// the AtlasIndex renders as tintable white placeholders.
async function loadAtlasPages(
  files: FileStore,
  atlas: AtlasRef,
): Promise<Map<string, AtlasPagePixels>> {
  const pages = new Map<string, AtlasPagePixels>();
  for (const page of atlas.pages) {
    pages.set(page.file, decodeAtlasPage(page.file, await readAtlasPageBytes(files, page.file)));
  }
  return pages;
}

// Map a render-preview typed error onto an McpToolError code. UNKNOWN_ANIMATION reuses the surface-wide
// ANIMATION_NOT_FOUND code so a client branches identically regardless of which tool raised it; the rest
// get render-scoped codes. The effects overlay adds three more: an ambiguous/empty trigger
// (EffectTriggerError, INVALID_EFFECT_TRIGGER) and an unknown effect/bundle NAME, which runtime-core's
// EffectSystem raises as EffectNotFoundError / BundleNotFoundError from inside renderComposedFrame. Non
// render-preview errors (including a FormatValidationError from the internal re-validate) propagate
// unchanged for the outer handler to classify.
function mapRenderError(error: unknown): never {
  if (error instanceof EffectNotFoundError) {
    throw new McpToolError('RENDER_EFFECT_NOT_FOUND', error.message);
  }
  if (error instanceof BundleNotFoundError) {
    throw new McpToolError('RENDER_BUNDLE_NOT_FOUND', error.message);
  }
  if (error instanceof RenderPreviewError) {
    switch (error.code) {
      case 'UNKNOWN_ANIMATION':
        throw new McpToolError('ANIMATION_NOT_FOUND', error.message);
      case 'ZERO_CONTENT_FIT':
        throw new McpToolError('RENDER_ZERO_CONTENT', error.message);
      case 'INVALID_VIEWPORT':
        throw new McpToolError('RENDER_INVALID_VIEWPORT', error.message);
      case 'MALFORMED_ATLAS_PAGE':
        throw new McpToolError('RENDER_MALFORMED_ATLAS_PAGE', error.message);
      case 'INVALID_EFFECT_TRIGGER':
        throw new McpToolError('RENDER_INVALID_EFFECT_TRIGGER', error.message);
    }
  }
  throw error;
}

// Export the live effects library to the EffectsDocument format for the render overlay, converting the
// effects-export failure modes into typed tool errors (the effects mirror of exportOrThrow). A dangling
// region reference, a duplicate name, or any other broken projection is RENDER_INVALID_EFFECTS_DOCUMENT
// (LAW 3: an overlay that cannot be represented fails loudly, never renders a silently-wrong frame).
function exportEffectsOrThrow(effects: EffectsReadModel): EffectsDocument {
  try {
    return exportEffects(effects);
  } catch (error) {
    if (error instanceof EffectsExportValidationError) {
      throw new McpToolError(
        'RENDER_INVALID_EFFECTS_DOCUMENT',
        'effects library is not valid for rendering',
        error.report.errors,
      );
    }
    if (error instanceof DocumentInvariantError) {
      throw new McpToolError('RENDER_INVALID_EFFECTS_DOCUMENT', error.message);
    }
    throw error;
  }
}

export const TOOLS: readonly ToolDefinition[] = [
  // ----- document lifecycle -----
  defineTool(
    {
      name: 'document.new',
      title: 'New document',
      description: 'Create a new, empty skeleton document and return its id.',
      input: z.object({ name: z.string().min(1) }).strict(),
    },
    (deps, input) => ({ documentId: deps.sessions.create(input.name).id }),
  ),
  defineTool(
    {
      name: 'document.getSnapshot',
      title: 'Get document snapshot',
      description: 'Return the internal snapshot (bones, order) of an open document.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ snapshot: deps.sessions.get(input.documentId).document.model.snapshot() }),
  ),
  defineTool(
    {
      name: 'document.validate',
      title: 'Validate document',
      description: 'Validate the current document against the format. Returns ok plus any errors.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => {
      const model = deps.sessions.get(input.documentId).document.model;
      try {
        exportDocument(model);
        return { ok: true, errors: [] };
      } catch (error) {
        if (error instanceof ExportValidationError)
          return { ok: false, errors: error.report.errors };
        if (error instanceof DocumentInvariantError) {
          return { ok: false, errors: [{ code: 'DOCUMENT_INVARIANT', message: error.message }] };
        }
        throw error;
      }
    },
  ),
  defineTool(
    {
      name: 'document.export',
      title: 'Export document',
      description: 'Project the document to the portable format JSON (validated and hashed).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      document: exportOrThrow(deps.sessions.get(input.documentId).document.model),
    }),
  ),
  defineTool(
    {
      name: 'document.save',
      title: 'Save document',
      description: 'Export the document and write it to a path through the host file store.',
      input: z.object({ documentId, path: z.string().min(1) }).strict(),
    },
    async (deps, input) => {
      const exported = exportOrThrow(deps.sessions.get(input.documentId).document.model);
      await deps.files.write(input.path, `${JSON.stringify(exported, null, 2)}\n`);
      return { path: input.path };
    },
  ),
  defineTool(
    {
      name: 'document.open',
      title: 'Open document',
      description: 'Read and validate a document from a path, returning a new document id.',
      input: z.object({ path: z.string().min(1) }).strict(),
    },
    async (deps, input) => {
      let raw: string;
      try {
        raw = await deps.files.read(input.path);
      } catch {
        throw new McpToolError('FILE_READ_ERROR', `could not read file "${input.path}"`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new McpToolError('INVALID_JSON', `file "${input.path}" is not valid JSON`);
      }
      try {
        const session = deps.sessions.open(parsed);
        return { documentId: session.id, document: exportOrThrow(session.document.model) };
      } catch (error) {
        if (error instanceof FormatValidationError) {
          throw new McpToolError(
            'INVALID_DOCUMENT',
            'document failed validation',
            error.report.errors,
          );
        }
        throw error;
      }
    },
  ),
  defineTool(
    {
      name: 'document.close',
      title: 'Close document',
      description: 'Discard an open document session.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => {
      deps.sessions.close(input.documentId);
      return { closed: true };
    },
  ),
  defineTool(
    {
      name: 'document.setMetadata',
      title: 'Set document metadata',
      description:
        'Set the optional skeleton metadata block (authoring fps and the project-relative imagesPath / ' +
        'audioPath source directories). Replaced wholesale; when every field is absent the block is ' +
        'cleared. Drives the Stage F1 command on the shared History (LAW 2).',
      input: z
        .object({
          documentId,
          fps: z.number().finite().positive().optional(),
          imagesPath: z.string().min(1).optional(),
          audioPath: z.string().min(1).optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      // exactOptionalPropertyTypes: build the block with only the present fields; all-absent clears it.
      const metadata: SkeletonMeta | undefined =
        input.fps === undefined && input.imagesPath === undefined && input.audioPath === undefined
          ? undefined
          : {
              ...(input.fps !== undefined ? { fps: input.fps } : {}),
              ...(input.imagesPath !== undefined ? { imagesPath: input.imagesPath } : {}),
              ...(input.audioPath !== undefined ? { audioPath: input.audioPath } : {}),
            };
      session.document.history.execute(new SetDocumentMetadataCommand(metadata));
      return { revision: session.document.model.revision };
    },
  ),

  // ----- bone operations (each goes through the same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'bone.create',
      title: 'Create bone',
      description: 'Create a bone (optionally parented) and return its id.',
      input: z
        .object({
          documentId,
          parentId: z.string().nullable().default(null),
          name: z.string().min(1),
          x: z.number().finite().default(0),
          y: z.number().finite().default(0),
          rotation: z.number().finite().default(0),
          length: z.number().finite().nonnegative().default(0),
          scaleX: z.number().finite().default(1),
          scaleY: z.number().finite().default(1),
          shearX: z.number().finite().default(0),
          shearY: z.number().finite().default(0),
          transformMode: transformModeSchema.default('normal'),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const parent = input.parentId === null ? null : requireBone(session, input.parentId).id;
      const newId = session.document.ids.mint('bone');
      session.document.history.execute(
        new CreateBoneCommand(newId, parent, {
          name: input.name,
          length: input.length,
          x: input.x,
          y: input.y,
          rotation: input.rotation,
          scaleX: input.scaleX,
          scaleY: input.scaleY,
          shearX: input.shearX,
          shearY: input.shearY,
          transformMode: input.transformMode,
        }),
      );
      return { boneId: newId };
    },
  ),
  defineTool(
    {
      name: 'bone.move',
      title: 'Move bone',
      description: 'Set a bone local translation (x, y).',
      input: z
        .object({ documentId, boneId, x: z.number().finite(), y: z.number().finite() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new MoveBoneCommand(asBoneId(input.boneId), { x: input.x, y: input.y }),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.rotate',
      title: 'Rotate bone',
      description: 'Set a bone local rotation in degrees.',
      input: z.object({ documentId, boneId, rotation: z.number().finite() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new RotateBoneCommand(asBoneId(input.boneId), input.rotation),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.scale',
      title: 'Scale bone',
      description: 'Set a bone local scale (scaleX, scaleY).',
      input: z
        .object({ documentId, boneId, scaleX: z.number().finite(), scaleY: z.number().finite() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new ScaleBoneCommand(asBoneId(input.boneId), {
          scaleX: input.scaleX,
          scaleY: input.scaleY,
        }),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.shear',
      title: 'Shear bone',
      description: 'Set a bone local shear in degrees (shearX, shearY).',
      input: z
        .object({ documentId, boneId, shearX: z.number().finite(), shearY: z.number().finite() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new SetBoneShearCommand(asBoneId(input.boneId), {
          shearX: input.shearX,
          shearY: input.shearY,
        }),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.setLength',
      title: 'Set bone length',
      description: 'Set a bone length.',
      input: z.object({ documentId, boneId, length: z.number().finite().nonnegative() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new SetBoneLengthCommand(asBoneId(input.boneId), input.length),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.rename',
      title: 'Rename bone',
      description: 'Rename a bone (identity is the id, so references are unaffected).',
      input: z.object({ documentId, boneId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(new RenameBoneCommand(asBoneId(input.boneId), input.name));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.delete',
      title: 'Delete bone',
      description: 'Delete a bone and its descendant bones (one undo step).',
      input: z.object({ documentId, boneId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(new DeleteBoneCommand(asBoneId(input.boneId)));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.reparent',
      title: 'Reparent bone',
      description:
        'Move a bone under a new parent (null for a root), holding its world transform fixed. ' +
        'Rejects a cycle (reparenting under itself or a descendant) as REPARENT_CYCLE.',
      input: z.object({ documentId, boneId, newParentId: z.string().nullable() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      const newParent =
        input.newParentId === null ? null : requireBone(session, input.newParentId).id;
      try {
        session.document.history.execute(
          new ReparentBoneCommand(asBoneId(input.boneId), newParent),
        );
      } catch (error) {
        if (error instanceof ReparentCycleError) {
          throw new McpToolError('REPARENT_CYCLE', error.message);
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.transformMode',
      title: 'Set bone transform mode',
      description: 'Set how a bone inherits its parent transform (the format TransformMode enum).',
      input: z.object({ documentId, boneId, mode: transformModeSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireBone(session, input.boneId);
      session.document.history.execute(
        new SetBoneTransformModeCommand(asBoneId(input.boneId), input.mode),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'bone.list',
      title: 'List bones',
      description: 'List the bones in document order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      bones: deps.sessions.get(input.documentId).document.model.bones().map(boneView),
    }),
  ),
  defineTool(
    {
      name: 'bone.get',
      title: 'Get bone',
      description: 'Get one bone by id.',
      input: z.object({ documentId, boneId }).strict(),
    },
    (deps, input) => ({
      bone: boneView(requireBone(deps.sessions.get(input.documentId), input.boneId)),
    }),
  ),

  // ----- slot + region-attachment operations (same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'slot.create',
      title: 'Create slot',
      description: 'Create a slot riding a bone and return its id.',
      input: z
        .object({
          documentId,
          boneId,
          name: z.string().min(1),
          color: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
          darkColor: rgbaSchema.nullable().default(null),
          attachment: z.string().min(1).nullable().default(null),
          blendMode: blendModeSchema.default('normal'),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const bone = requireBone(session, input.boneId);
      const newId = session.document.ids.mint('slot');
      session.document.history.execute(
        new CreateSlotCommand(newId, {
          name: input.name,
          bone: bone.id,
          color: input.color,
          darkColor: input.darkColor,
          attachment: input.attachment,
          blendMode: input.blendMode,
        }),
      );
      return { slotId: newId };
    },
  ),
  defineTool(
    {
      name: 'slot.delete',
      title: 'Delete slot',
      description: 'Delete a slot and its attachments (one undo step).',
      input: z.object({ documentId, slotId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(new DeleteSlotCommand(asSlotId(input.slotId)));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.rename',
      title: 'Rename slot',
      description: 'Rename a slot (identity is the id, so references are unaffected).',
      input: z.object({ documentId, slotId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(new RenameSlotCommand(asSlotId(input.slotId), input.name));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.blend',
      title: 'Set slot blend mode',
      description: 'Set a slot blend mode (the format BlendMode enum).',
      input: z.object({ documentId, slotId, blendMode: blendModeSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new SetSlotBlendModeCommand(asSlotId(input.slotId), input.blendMode),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.color',
      title: 'Set slot color',
      description: 'Set a slot tint color (RGBA, each channel 0..1).',
      input: z.object({ documentId, slotId, color: rgbaSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new SetSlotColorCommand(asSlotId(input.slotId), input.color),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.reorder',
      title: 'Reorder slot',
      description: 'Move a slot to a new index in the setup-pose draw order.',
      input: z.object({ documentId, slotId, toIndex: z.number().int().nonnegative() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new ReorderSlotCommand(asSlotId(input.slotId), input.toIndex),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.activeAttachment',
      title: 'Set active attachment',
      description: 'Set the slot setup-pose active attachment name (null clears it).',
      input: z.object({ documentId, slotId, attachment: z.string().min(1).nullable() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new SetActiveAttachmentCommand(asSlotId(input.slotId), input.attachment),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'attach.region.add',
      title: 'Add region attachment',
      description:
        'Add a region attachment to a slot. `path` references an atlas region; ' +
        'width/height/offset are caller-supplied (derived from the region by the editor).',
      input: z
        .object({
          documentId,
          slotId,
          name: z.string().min(1),
          path: z.string().min(1),
          x: z.number().finite().default(0),
          y: z.number().finite().default(0),
          rotation: z.number().finite().default(0),
          scaleX: z.number().finite().default(1),
          scaleY: z.number().finite().default(1),
          width: z.number().finite().default(0),
          height: z.number().finite().default(0),
          color: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new AddRegionAttachmentCommand(asSlotId(input.slotId), {
          name: input.name,
          path: input.path,
          x: input.x,
          y: input.y,
          rotation: input.rotation,
          scaleX: input.scaleX,
          scaleY: input.scaleY,
          width: input.width,
          height: input.height,
          color: input.color,
        }),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'attach.linkedmesh.create',
      title: 'Create linked mesh',
      description:
        'Add a linked mesh (Stage F2) to a slot default skin: it reuses the geometry of a PARENT mesh on the ' +
        'SAME slot (in `skin`, default the default skin) while carrying its own atlas `path`, size, and ' +
        'color. `timelines` shares the parent deform timelines. The parent chain is resolved and ' +
        'cycle-checked (LINKED_MESH with reason parentMissing / parentInvalid / cycle / duplicateName).',
      input: z
        .object({
          documentId,
          slotId,
          name: z.string().min(1),
          path: z.string().min(1),
          parent: z.string().min(1),
          skin: z.string().min(1).optional(),
          timelines: z.boolean().default(false),
          width: z.number().finite().default(0),
          height: z.number().finite().default(0),
          color: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      return {
        revision: executeLinkedMeshEdit(
          session,
          new CreateLinkedMeshCommand(asSlotId(input.slotId), {
            name: input.name,
            path: input.path,
            parent: input.parent,
            ...(input.skin !== undefined ? { skin: input.skin } : {}),
            timelines: input.timelines,
            width: input.width,
            height: input.height,
            color: input.color,
          }),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'attach.linkedmesh.unlink',
      title: 'Unlink mesh',
      description:
        'Bake a linked mesh to a plain mesh: it takes the resolved root geometry and keeps its own atlas ' +
        'path, size, and color. A target that is not a linked mesh is LINKED_MESH with reason notFound.',
      input: z.object({ documentId, slotId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      return {
        revision: executeLinkedMeshEdit(
          session,
          new UnlinkMeshCommand(asSlotId(input.slotId), input.name),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'attach.remove',
      title: 'Remove attachment',
      description:
        'Remove an attachment from a slot (clears the slot active attachment if it was it).',
      input: z.object({ documentId, slotId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      if (session.document.model.getAttachment(asSlotId(input.slotId), input.name) === undefined) {
        throw new McpToolError(
          'ATTACHMENT_NOT_FOUND',
          `slot "${input.slotId}" has no attachment "${input.name}"`,
        );
      }
      session.document.history.execute(
        new RemoveAttachmentCommand(asSlotId(input.slotId), input.name),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'attach.region.transform',
      title: 'Set region attachment transform',
      description:
        'Set a region attachment placement/size. Omitted fields keep their current value.',
      input: z
        .object({
          documentId,
          slotId,
          name: z.string().min(1),
          x: z.number().finite().optional(),
          y: z.number().finite().optional(),
          rotation: z.number().finite().optional(),
          scaleX: z.number().finite().optional(),
          scaleY: z.number().finite().optional(),
          width: z.number().finite().optional(),
          height: z.number().finite().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      const current = session.document.model.getAttachment(asSlotId(input.slotId), input.name);
      if (current === undefined || current.kind !== 'region') {
        throw new McpToolError(
          'ATTACHMENT_NOT_FOUND',
          `slot "${input.slotId}" has no region attachment "${input.name}"`,
        );
      }
      // Merge the provided fields over the current transform (absolute target the command stores).
      session.document.history.execute(
        new SetRegionAttachmentTransformCommand(asSlotId(input.slotId), input.name, {
          x: input.x ?? current.x,
          y: input.y ?? current.y,
          rotation: input.rotation ?? current.rotation,
          scaleX: input.scaleX ?? current.scaleX,
          scaleY: input.scaleY ?? current.scaleY,
          width: input.width ?? current.width,
          height: input.height ?? current.height,
        }),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'slot.list',
      title: 'List slots',
      description: 'List the slots in setup-pose draw order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      slots: deps.sessions.get(input.documentId).document.model.slots().map(slotView),
    }),
  ),
  defineTool(
    {
      name: 'slot.get',
      title: 'Get slot',
      description: 'Get one slot (and its attachment names) by id.',
      input: z.object({ documentId, slotId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const slot = requireSlot(session, input.slotId);
      const attachments = session.document.model
        .attachments(asSlotId(input.slotId))
        .map((att) => ({ name: att.name, kind: att.kind }));
      return { slot: slotView(slot), attachments };
    },
  ),

  // ----- mesh creation + editing (WP-2.1, same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'mesh.generateFromRegion',
      title: 'Generate mesh from region',
      description:
        'Replace a region attachment with a mesh under the same name. The editor computes the quad-' +
        'from-region geometry (uvs/triangles/hullLength/flat unweighted vertices) and passes it; the ' +
        'mesh keeps the region atlas path. Undo restores the exact region.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          uvs: numberArray,
          triangles: numberArray,
          hullLength,
          width: z.number().finite(),
          height: z.number().finite(),
          color: rgbaSchema.default({ r: 1, g: 1, b: 1, a: 1 }),
          edges: numberArray.optional(),
          vertices: numberArray,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'region');
      const base = {
        uvs: input.uvs,
        triangles: input.triangles,
        hullLength: input.hullLength,
        width: input.width,
        height: input.height,
        color: input.color,
        vertices: input.vertices,
      };
      session.document.history.execute(
        new GenerateMeshFromRegionCommand(
          asSlotId(input.slotId),
          input.name,
          input.edges === undefined ? base : { ...base, edges: input.edges },
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'mesh.addVertex',
      title: 'Add mesh vertex',
      description:
        'Add an interior vertex to a mesh. The editor re-triangulates and passes the recomputed ' +
        'uvs/triangles/vertices. Rejected as MESH_TOPOLOGY_LOCKED on a weighted or deformed mesh.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          uvs: numberArray,
          triangles: numberArray,
          vertices: numberArray,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      return {
        revision: executeMeshTopologyEdit(
          session,
          new AddMeshVertexCommand(
            asSlotId(input.slotId),
            input.name,
            input.uvs,
            input.triangles,
            input.vertices,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.moveVertex',
      title: 'Move mesh vertex',
      description:
        'Move one mesh vertex to (x, y). Never re-triangulates (indices stable); always allowed (not ' +
        'topology-locked). Wrap a drag in beginInteraction/endInteraction to coalesce it into one undo step.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          vertexIndex: z.number().int().nonnegative(),
          x: z.number().finite(),
          y: z.number().finite(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      session.document.history.execute(
        new MoveMeshVertexCommand(
          asSlotId(input.slotId),
          input.name,
          input.vertexIndex,
          input.x,
          input.y,
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'mesh.deleteVertex',
      title: 'Delete mesh vertex',
      description:
        'Delete a mesh vertex. The editor re-triangulates and passes the recomputed uvs/triangles/' +
        'vertices. Rejected as MESH_TOPOLOGY_LOCKED on a weighted or deformed mesh.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          uvs: numberArray,
          triangles: numberArray,
          vertices: numberArray,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      return {
        revision: executeMeshTopologyEdit(
          session,
          new DeleteMeshVertexCommand(
            asSlotId(input.slotId),
            input.name,
            input.uvs,
            input.triangles,
            input.vertices,
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.setEdges',
      title: 'Set mesh edges',
      description:
        'Set or replace a mesh edges (wireframe) array, as vertex-index pairs. Does not change ' +
        'topology; always allowed. An empty array clears the wireframe.',
      input: z.object({ documentId, slotId, name: attachmentName, edges: numberArray }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      session.document.history.execute(
        new SetMeshEdgesCommand(asSlotId(input.slotId), input.name, input.edges),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'mesh.autoGridFill',
      title: 'Auto grid-fill mesh',
      description:
        'Replace a mesh with an editor-computed regular interior grid (uvs/triangles/hullLength/' +
        'vertices, optional edges) in one undoable step. Rejected as MESH_TOPOLOGY_LOCKED on a weighted ' +
        'or deformed mesh.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          uvs: numberArray,
          triangles: numberArray,
          hullLength,
          vertices: numberArray,
          edges: numberArray.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const fill = {
        uvs: input.uvs,
        triangles: input.triangles,
        hullLength: input.hullLength,
        vertices: input.vertices,
      };
      return {
        revision: executeMeshTopologyEdit(
          session,
          new AutoGridFillMeshCommand(
            asSlotId(input.slotId),
            input.name,
            input.edges === undefined ? fill : { ...fill, edges: input.edges },
          ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.autoPerimeterTrace',
      title: 'Auto perimeter-trace mesh',
      description:
        'Replace a mesh with an editor-computed silhouette-traced hull plus interior fill (uvs/' +
        'triangles/hullLength/vertices, optional edges) in one undoable step. Rejected as ' +
        'MESH_TOPOLOGY_LOCKED on a weighted or deformed mesh.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          uvs: numberArray,
          triangles: numberArray,
          hullLength,
          vertices: numberArray,
          edges: numberArray.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const fill = {
        uvs: input.uvs,
        triangles: input.triangles,
        hullLength: input.hullLength,
        vertices: input.vertices,
      };
      return {
        revision: executeMeshTopologyEdit(
          session,
          new AutoPerimeterTraceMeshCommand(
            asSlotId(input.slotId),
            input.name,
            input.edges === undefined ? fill : { ...fill, edges: input.edges },
          ),
        ),
      };
    },
  ),

  // ----- mesh-to-bone binding (WP-2.3) + weight painting (WP-2.4), same command + History as the GUI -----
  defineTool(
    {
      name: 'mesh.bindToBones',
      title: 'Bind mesh to bones',
      description:
        'Convert an UNWEIGHTED mesh to the weighted encoding by binding it to a set of bones. ' +
        'weightMode rigidNearest gives each vertex weight 1 to its nearest bone; equalSplit splits ' +
        'equally across the (up to 4 nearest) bound bones. Skinning at setup pose reproduces the ' +
        'original geometry. Rejected as MESH_BINDING when the mesh is already weighted, the bone set ' +
        'is empty, or a bone is missing.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          boneIds: z.array(boneId).min(1),
          weightMode: weightModeSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const boneIds = input.boneIds.map((id) => requireBone(session, id).id);
      return {
        revision: executeBindingEdit(
          session,
          new BindMeshToBonesCommand(asSlotId(input.slotId), input.name, boneIds, input.weightMode),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.addBoneBinding',
      title: 'Add bone to mesh binding',
      description:
        'Add one bone influence to an already-weighted mesh, seeded by proximity and re-normalized ' +
        '(capped to 4). Rejected as MESH_BINDING when the mesh is unweighted, the bone is missing, or ' +
        'the bone is already bound.',
      input: z.object({ documentId, slotId, name: attachmentName, boneId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const bone = requireBone(session, input.boneId);
      return {
        revision: executeBindingEdit(
          session,
          new AddBoneToMeshBindingCommand(asSlotId(input.slotId), input.name, bone.id),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.removeBoneBinding',
      title: 'Remove bone from mesh binding',
      description:
        'Drop one bone influence from a weighted mesh and re-normalize (a vertex left with no ' +
        'influence falls back to its nearest remaining bound bone). Rejected as MESH_BINDING when the ' +
        'mesh is unweighted, the bone is not bound, or it is the only bound bone (use mesh.unbind).',
      input: z.object({ documentId, slotId, name: attachmentName, boneId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const bone = requireBone(session, input.boneId);
      return {
        revision: executeBindingEdit(
          session,
          new RemoveBoneFromMeshBindingCommand(asSlotId(input.slotId), input.name, bone.id),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.unbind',
      title: 'Unbind mesh',
      description:
        'Clear all weights, returning a mesh to the unweighted flat encoding (re-derived from the ' +
        'current setup pose so it renders identically). Required before changing a weighted mesh ' +
        'topology. Rejected as MESH_BINDING when the mesh is unweighted or still has deform keyframes.',
      input: z.object({ documentId, slotId, name: attachmentName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      return {
        revision: executeBindingEdit(
          session,
          new UnbindMeshCommand(asSlotId(input.slotId), input.name),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.autoWeight',
      title: 'Auto-weight mesh from proximity',
      description:
        'Re-seed a weighted mesh by inverse distance to each bound bone segment (capped to the 4 ' +
        'nearest, normalized) as a starting point for manual paint. Rejected as MESH_BINDING when the ' +
        'mesh is unweighted.',
      input: z.object({ documentId, slotId, name: attachmentName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      return {
        revision: executeBindingEdit(
          session,
          new AutoWeightFromProximityCommand(asSlotId(input.slotId), input.name),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.paintWeight',
      title: 'Paint mesh weights',
      description:
        'Apply a weight-paint stroke to one active bone across a set of dabs (per-vertex weight ' +
        'adjustments); each touched vertex is re-normalized (non-active proportions preserved) and ' +
        'capped to 4. mode add raises, subtract lowers, smooth applies the supplied signed delta. ' +
        'Wrap a stroke in beginInteraction/endInteraction to coalesce its dabs into one undo step. ' +
        'Rejected as MESH_BINDING when the mesh is unweighted, the bone is missing, or a dab indexes a ' +
        'vertex out of range.',
      input: z
        .object({
          documentId,
          slotId,
          name: attachmentName,
          activeBoneId: boneId,
          dabs: z.array(weightDabSchema).min(1),
          mode: paintModeSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      const active = requireBone(session, input.activeBoneId);
      const mode: PaintMode = input.mode;
      const dabs: WeightDab[] = input.dabs.map((dab) => ({
        vertexIndex: dab.vertexIndex,
        deltaWeight: dab.deltaWeight,
      }));
      return {
        revision: executeBindingEdit(
          session,
          new PaintWeightStrokeCommand(asSlotId(input.slotId), input.name, active.id, dabs, mode),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'mesh.normalizeWeights',
      title: 'Normalize mesh weights',
      description:
        'Re-normalize every vertex of a weighted mesh to sum 1 and cap to 4 influences (idempotent). ' +
        'Rejected as MESH_BINDING when the mesh is unweighted.',
      input: z.object({ documentId, slotId, name: attachmentName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      requireAttachmentKind(session, input.slotId, input.name, 'mesh');
      return {
        revision: executeBindingEdit(
          session,
          new NormalizeMeshWeightsCommand(asSlotId(input.slotId), input.name),
        ),
      };
    },
  ),

  // ----- IK constraints (WP-2.6, same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'ik.createConstraint',
      title: 'Create IK constraint',
      description:
        'Create an IK constraint over a 1 or 2 bone chain reaching toward a target bone, and return its ' +
        'id. The chain is parent-then-direct-child for a two-bone chain. Rejected as CONSTRAINT (with a ' +
        'reason: chainArity, chainDiscontinuous, boneMissing, targetMissing, cycle, or duplicateName).',
      input: z
        .object({
          documentId,
          name: z.string().min(1),
          boneIds: z.array(boneId).min(1).max(2),
          targetId: boneId,
          mix: ikMixSchema.default(1),
          bendPositive: z.boolean().default(true),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const bones = input.boneIds.map((id) => requireBone(session, id).id);
      const target = requireBone(session, input.targetId).id;
      const newId = session.document.ids.mint('ikConstraint');
      executeConstraintEdit(
        session,
        new CreateIkConstraintCommand(
          asIkConstraintId(newId),
          input.name,
          bones,
          target,
          input.mix,
          input.bendPositive,
        ),
      );
      return { ikConstraintId: newId };
    },
  ),
  defineTool(
    {
      name: 'ik.setMix',
      title: 'Set IK mix',
      description:
        'Set an IK constraint mix blend (0..1) toward the solved pose (absolute target).',
      input: z.object({ documentId, ikConstraintId, mix: ikMixSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireIkConstraint(session, input.ikConstraintId);
      session.document.history.execute(
        new SetIkMixCommand(asIkConstraintId(input.ikConstraintId), input.mix),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.setBendPositive',
      title: 'Set IK bend direction',
      description:
        'Set an IK constraint bend-direction flag (true bends positive, false negative).',
      input: z.object({ documentId, ikConstraintId, bendPositive: z.boolean() }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireIkConstraint(session, input.ikConstraintId);
      session.document.history.execute(
        new SetIkBendPositiveCommand(asIkConstraintId(input.ikConstraintId), input.bendPositive),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.setDepth',
      title: 'Set IK depth',
      description:
        'Patch a Stage F2 IK depth field: `softness` (non-negative world-unit ease-in distance), and the ' +
        '`stretch` / `compress` / `uniform` booleans. Only the named fields change; the rest keep their ' +
        'current value. At least one field is required.',
      input: z
        .object({
          documentId,
          ikConstraintId,
          softness: z.number().finite().nonnegative().optional(),
          stretch: z.boolean().optional(),
          compress: z.boolean().optional(),
          uniform: z.boolean().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireIkConstraint(session, input.ikConstraintId);
      // Assemble the patch over only the fields the caller set (exactOptionalPropertyTypes: no explicit
      // `undefined` may reach the command's Partial patch).
      const patch: IkDepthPatch = {
        ...(input.softness !== undefined ? { softness: input.softness } : {}),
        ...(input.stretch !== undefined ? { stretch: input.stretch } : {}),
        ...(input.compress !== undefined ? { compress: input.compress } : {}),
        ...(input.uniform !== undefined ? { uniform: input.uniform } : {}),
      };
      if (Object.keys(patch).length === 0) {
        throw new McpToolError('INVALID_INPUT', 'patch must name at least one depth field');
      }
      session.document.history.execute(
        new SetIkDepthParamsCommand(asIkConstraintId(input.ikConstraintId), patch),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.deleteConstraint',
      title: 'Delete IK constraint',
      description:
        'Delete an IK constraint, cascading every animation IK timeline keyed to it (one undo step).',
      input: z.object({ documentId, ikConstraintId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireIkConstraint(session, input.ikConstraintId);
      session.document.history.execute(
        new DeleteIkConstraintCommand(asIkConstraintId(input.ikConstraintId)),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.setKeyframe',
      title: 'Set IK keyframe',
      description:
        'Insert or update an IK keyframe at a time on a constraint IK channel (mix + bendPositive). ' +
        'Updating an existing time keeps its curve; a new keyframe takes the optional insert `curve` ' +
        '(default linear).',
      input: z
        .object({
          documentId,
          animationId,
          ikConstraintId,
          time: z.number().finite().nonnegative(),
          mix: ikMixSchema,
          bendPositive: z.boolean(),
          curve: curveSchema.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireIkConstraint(session, input.ikConstraintId);
      session.document.history.execute(
        input.curve === undefined
          ? new SetIkKeyframeCommand(
              asAnimationId(input.animationId),
              asIkConstraintId(input.ikConstraintId),
              input.time,
              input.mix,
              input.bendPositive,
            )
          : new SetIkKeyframeCommand(
              asAnimationId(input.animationId),
              asIkConstraintId(input.ikConstraintId),
              input.time,
              input.mix,
              input.bendPositive,
              input.curve,
            ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.deleteKeyframe',
      title: 'Delete IK keyframe',
      description: 'Delete an IK keyframe (by id) from a constraint IK channel.',
      input: z.object({ documentId, animationId, ikConstraintId, keyframeId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireIkConstraint(session, input.ikConstraintId);
      session.document.history.execute(
        new DeleteIkKeyframeCommand(
          asAnimationId(input.animationId),
          asIkConstraintId(input.ikConstraintId),
          asKeyframeId(input.keyframeId),
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.moveKeyframe',
      title: 'Move IK keyframe',
      description:
        'Move an IK keyframe (by id) to a new time on a constraint IK channel (IK times are strictly ' +
        'ascending). Landing on an occupied time is a typed KEYFRAME_COLLISION; a missing key is a typed ' +
        'KEYFRAME_NOT_FOUND. The moved keyframe keeps its mix/bendPositive/curve.',
      input: z
        .object({
          documentId,
          animationId,
          ikConstraintId,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireIkConstraint(session, input.ikConstraintId);
      try {
        session.document.history.execute(
          new MoveIkKeyframeCommand(
            asAnimationId(input.animationId),
            asIkConstraintId(input.ikConstraintId),
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no IK keyframe "${input.keyframeId}" on constraint "${input.ikConstraintId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'ik.list',
      title: 'List IK constraints',
      description: 'List the IK constraints in solve order.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      ikConstraints: deps.sessions
        .get(input.documentId)
        .document.model.ikConstraints()
        .map(ikConstraintView),
    }),
  ),
  defineTool(
    {
      name: 'ik.get',
      title: 'Get IK constraint',
      description: 'Get one IK constraint by id.',
      input: z.object({ documentId, ikConstraintId }).strict(),
    },
    (deps, input) => ({
      ikConstraint: ikConstraintView(
        requireIkConstraint(deps.sessions.get(input.documentId), input.ikConstraintId),
      ),
    }),
  ),

  // ----- transform constraints (WP-2.7, same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'transform.createConstraint',
      title: 'Create transform constraint',
      description:
        'Create a transform constraint that drives a set of bones from a target with per-channel mix and ' +
        'additive offset, and return its id. Solves after all IK. Rejected as CONSTRAINT (with a reason: ' +
        'boneMissing, targetMissing, cycle, or duplicateName).',
      input: z
        .object({
          documentId,
          name: z.string().min(1),
          boneIds: z.array(boneId).min(1),
          targetId: boneId,
          params: transformParamsSchema.default({}),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const bones = input.boneIds.map((id) => requireBone(session, id).id);
      const target = requireBone(session, input.targetId).id;
      const newId = session.document.ids.mint('transformConstraint');
      // The schema applies the per-channel defaults, so params is a complete TransformConstraintParams.
      const params: TransformConstraintParams = input.params;
      executeConstraintEdit(
        session,
        new CreateTransformConstraintCommand(
          asTransformConstraintId(newId),
          input.name,
          bones,
          target,
          params,
        ),
      );
      return { transformConstraintId: newId };
    },
  ),
  defineTool(
    {
      name: 'transform.setParams',
      title: 'Set transform constraint params',
      description:
        'Patch a transform constraint mix/offset channels (only the named channels change; the rest keep ' +
        'their current value). The patch holds the absolute target values. At least one channel required.',
      input: z
        .object({ documentId, transformConstraintId, patch: transformParamsPatchSchema })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireTransformConstraint(session, input.transformConstraintId);
      // Copy only the channels the caller actually set into the patch. The schema makes each channel
      // optional (so an omitted key is absent); under exactOptionalPropertyTypes the command's Partial
      // patch must not carry explicit `undefined`, so we assemble it over the typed key set. The
      // accumulator is the writable twin of the (readonly) params patch (the command stores it as-is).
      const patch: { -readonly [K in keyof TransformConstraintParams]?: number } = {};
      for (const key of TRANSFORM_PARAM_KEYS) {
        const value = input.patch[key];
        if (value !== undefined) patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        throw new McpToolError('INVALID_INPUT', 'patch must name at least one channel');
      }
      session.document.history.execute(
        new SetTransformConstraintParamsCommand(
          asTransformConstraintId(input.transformConstraintId),
          patch,
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.setVariants',
      title: 'Set transform constraint variants',
      description:
        'Patch a transform constraint Stage F2 variant flag: `local` (local-space read/write instead of the ' +
        'world-space blend) and `relative` (offset relative to the bone current value instead of an absolute ' +
        'blend). Only the named flags change. At least one flag is required.',
      input: z
        .object({
          documentId,
          transformConstraintId,
          local: z.boolean().optional(),
          relative: z.boolean().optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireTransformConstraint(session, input.transformConstraintId);
      const patch: TransformVariantPatch = {
        ...(input.local !== undefined ? { local: input.local } : {}),
        ...(input.relative !== undefined ? { relative: input.relative } : {}),
      };
      if (Object.keys(patch).length === 0) {
        throw new McpToolError('INVALID_INPUT', 'patch must name at least one variant flag');
      }
      session.document.history.execute(
        new SetTransformConstraintVariantsCommand(
          asTransformConstraintId(input.transformConstraintId),
          patch,
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.deleteConstraint',
      title: 'Delete transform constraint',
      description:
        'Delete a transform constraint, cascading every animation transform timeline keyed to it (one ' +
        'undo step).',
      input: z.object({ documentId, transformConstraintId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireTransformConstraint(session, input.transformConstraintId);
      session.document.history.execute(
        new DeleteTransformConstraintCommand(asTransformConstraintId(input.transformConstraintId)),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.setKeyframe',
      title: 'Set transform keyframe',
      description:
        'Insert or update a transform keyframe at a time on a constraint channel. `mix` carries the six ' +
        'per-channel factors; an omitted channel keeps its base value at solve time. Updating an existing ' +
        'time keeps its curve; a new keyframe takes the optional insert `curve` (default linear).',
      input: z
        .object({
          documentId,
          animationId,
          transformConstraintId,
          time: z.number().finite().nonnegative(),
          mix: transformKeyframeMixSchema,
          curve: curveSchema.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireTransformConstraint(session, input.transformConstraintId);
      // Key all six channels explicitly: an omitted input channel is `undefined` (keeps its base value).
      const mix: TransformKeyframeMix = {
        mixRotate: input.mix.mixRotate,
        mixX: input.mix.mixX,
        mixY: input.mix.mixY,
        mixScaleX: input.mix.mixScaleX,
        mixScaleY: input.mix.mixScaleY,
        mixShearY: input.mix.mixShearY,
      };
      session.document.history.execute(
        input.curve === undefined
          ? new SetTransformKeyframeCommand(
              asAnimationId(input.animationId),
              asTransformConstraintId(input.transformConstraintId),
              input.time,
              mix,
            )
          : new SetTransformKeyframeCommand(
              asAnimationId(input.animationId),
              asTransformConstraintId(input.transformConstraintId),
              input.time,
              mix,
              input.curve,
            ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.deleteKeyframe',
      title: 'Delete transform keyframe',
      description: 'Delete a transform keyframe (by id) from a constraint channel.',
      input: z.object({ documentId, animationId, transformConstraintId, keyframeId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireTransformConstraint(session, input.transformConstraintId);
      session.document.history.execute(
        new DeleteTransformKeyframeCommand(
          asAnimationId(input.animationId),
          asTransformConstraintId(input.transformConstraintId),
          asKeyframeId(input.keyframeId),
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.moveKeyframe',
      title: 'Move transform keyframe',
      description:
        'Move a transform keyframe (by id) to a new time on a constraint channel (times are strictly ' +
        'ascending). Landing on an occupied time is a typed KEYFRAME_COLLISION; a missing key is a typed ' +
        'KEYFRAME_NOT_FOUND. The moved keyframe keeps all six mix channels and its curve.',
      input: z
        .object({
          documentId,
          animationId,
          transformConstraintId,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireTransformConstraint(session, input.transformConstraintId);
      try {
        session.document.history.execute(
          new MoveTransformKeyframeCommand(
            asAnimationId(input.animationId),
            asTransformConstraintId(input.transformConstraintId),
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no transform keyframe "${input.keyframeId}" on constraint "${input.transformConstraintId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'transform.list',
      title: 'List transform constraints',
      description: 'List the transform constraints in solve order (after all IK).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      transformConstraints: deps.sessions
        .get(input.documentId)
        .document.model.transformConstraints()
        .map(transformConstraintView),
    }),
  ),
  defineTool(
    {
      name: 'transform.get',
      title: 'Get transform constraint',
      description: 'Get one transform constraint by id.',
      input: z.object({ documentId, transformConstraintId }).strict(),
    },
    (deps, input) => ({
      transformConstraint: transformConstraintView(
        requireTransformConstraint(
          deps.sessions.get(input.documentId),
          input.transformConstraintId,
        ),
      ),
    }),
  ),
  defineTool(
    {
      name: 'constraints.reorder',
      title: 'Reorder constraints',
      description:
        'Set the explicit cross-array constraint solve order (ADR-0009): `order` is the combined IK-then-' +
        'transform constraint ids in the desired solve order, a dense unique cover of the current set (a ' +
        'wrong length, duplicate, or unknown id is CONSTRAINT with reason orderInvalid). Pass `order: null` ' +
        'to CLEAR the explicit order and restore the default (all IK in array order, then all transform).',
      input: z
        .object({ documentId, order: z.array(z.string().min(1)).nullable() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      return {
        revision: executeConstraintEdit(session, new ReorderConstraintsCommand(input.order)),
      };
    },
  ),

  // ----- skins (WP-2.8, same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'skin.create',
      title: 'Create skin',
      description:
        'Create a NAMED (non-default) skin and return its id. The implicit "default" skin is reserved. ' +
        'Rejected as SKIN (with a reason: defaultProtected or duplicateName).',
      input: z.object({ documentId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const newId = session.document.ids.mint('skin');
      executeSkinEdit(session, new CreateSkinCommand(asSkinId(newId), input.name));
      return { skinId: newId };
    },
  ),
  defineTool(
    {
      name: 'skin.rename',
      title: 'Rename skin',
      description:
        'Rename a NAMED skin (identity is the id, so deform tracks are unaffected). Rejected as SKIN ' +
        '(with a reason: defaultProtected, notFound, or duplicateName).',
      input: z.object({ documentId, skinId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSkin(session, input.skinId);
      executeSkinEdit(session, new RenameSkinCommand(asSkinId(input.skinId), input.name));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'skin.delete',
      title: 'Delete skin',
      description:
        'Delete a NAMED skin, cascading every animation deform timeline keyed to it (one undo step).',
      input: z.object({ documentId, skinId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSkin(session, input.skinId);
      executeSkinEdit(session, new DeleteSkinCommand(asSkinId(input.skinId)));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'skin.setAttachment',
      title: 'Set skin attachment',
      description:
        'Add or replace a region attachment on a NAMED skin at a (slot, attachment-name) address. The ' +
        '`path` references an atlas region. Rejected as SKIN (with a reason: notFound or slotMissing).',
      input: z
        .object({ documentId, skinId, slotId, attachment: skinRegionAttachmentSchema })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSkin(session, input.skinId);
      requireSlot(session, input.slotId);
      const entity: AttachmentEntity = {
        kind: 'region',
        name: input.attachment.name,
        path: input.attachment.path,
        x: input.attachment.x,
        y: input.attachment.y,
        rotation: input.attachment.rotation,
        scaleX: input.attachment.scaleX,
        scaleY: input.attachment.scaleY,
        width: input.attachment.width,
        height: input.attachment.height,
        color: input.attachment.color,
      };
      executeSkinEdit(
        session,
        new SetSkinAttachmentCommand(asSkinId(input.skinId), asSlotId(input.slotId), entity),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'skin.removeAttachment',
      title: 'Remove skin attachment',
      description:
        'Remove an attachment from a NAMED skin at a (slot, attachment-name) address. Rejected as SKIN ' +
        '(reason notFound) when the skin or the addressed attachment is absent.',
      input: z.object({ documentId, skinId, slotId, name: attachmentName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSkin(session, input.skinId);
      requireSlot(session, input.slotId);
      executeSkinEdit(
        session,
        new RemoveSkinAttachmentCommand(asSkinId(input.skinId), asSlotId(input.slotId), input.name),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'skin.list',
      title: 'List skins',
      description:
        'List the NAMED (non-default) skins in skin order, each with its attachment addresses.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      skins: deps.sessions.get(input.documentId).document.model.skins().map(skinView),
    }),
  ),
  defineTool(
    {
      name: 'skin.get',
      title: 'Get skin',
      description: 'Get one NAMED skin (and its attachment addresses) by id.',
      input: z.object({ documentId, skinId }).strict(),
    },
    (deps, input) => ({
      skin: skinView(requireSkin(deps.sessions.get(input.documentId), input.skinId)),
    }),
  ),

  // ----- deform timelines (WP-2.9, same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'deform.setKeyframe',
      title: 'Set deform keyframe',
      description:
        'Insert or update a deform keyframe at a time on a (skin, slot, attachment) mesh channel. `skin` ' +
        'is "default" or a named SkinId. `offsets` is the flat per-LOGICAL-vertex [dx, dy, ...] array and ' +
        'its length must equal the mesh uvs length. Updating an existing time keeps its curve; a new ' +
        'keyframe takes the optional insert `curve` (default linear). Rejected as DEFORM (reason notMesh ' +
        'or offsetLength).',
      input: z
        .object({
          documentId,
          animationId,
          skin: deformSkinKey,
          slotId,
          name: attachmentName,
          time: z.number().finite().nonnegative(),
          offsets: numberArray,
          curve: curveSchema.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const skinKey = resolveDeformSkinKey(session, input.skin);
      requireSlot(session, input.slotId);
      return {
        revision: executeDeformEdit(
          session,
          input.curve === undefined
            ? new SetDeformKeyframeCommand(
                asAnimationId(input.animationId),
                skinKey,
                asSlotId(input.slotId),
                input.name,
                input.time,
                input.offsets,
              )
            : new SetDeformKeyframeCommand(
                asAnimationId(input.animationId),
                skinKey,
                asSlotId(input.slotId),
                input.name,
                input.time,
                input.offsets,
                input.curve,
              ),
        ),
      };
    },
  ),
  defineTool(
    {
      name: 'deform.deleteKeyframe',
      title: 'Delete deform keyframe',
      description:
        'Delete a deform keyframe (by id) from a (skin, slot, attachment) mesh channel. `skin` is ' +
        '"default" or a named SkinId.',
      input: z
        .object({
          documentId,
          animationId,
          skin: deformSkinKey,
          slotId,
          name: attachmentName,
          keyframeId,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const skinKey = resolveDeformSkinKey(session, input.skin);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new DeleteDeformKeyframeCommand(
          asAnimationId(input.animationId),
          skinKey,
          asSlotId(input.slotId),
          input.name,
          asKeyframeId(input.keyframeId),
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'deform.moveKeyframe',
      title: 'Move deform keyframe',
      description:
        'Move a deform keyframe (by id) to a new time on its (skin, slot, attachment) channel. `skin` is ' +
        '"default" or a named SkinId. Rejects landing on an occupied time as KEYFRAME_COLLISION.',
      input: z
        .object({
          documentId,
          animationId,
          skin: deformSkinKey,
          slotId,
          name: attachmentName,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const skinKey = resolveDeformSkinKey(session, input.skin);
      requireSlot(session, input.slotId);
      try {
        session.document.history.execute(
          new MoveDeformKeyframeCommand(
            asAnimationId(input.animationId),
            skinKey,
            asSlotId(input.slotId),
            input.name,
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'deform.clearAttachment',
      title: 'Clear attachment deform',
      description:
        'Remove every deform keyframe for one (slot, attachment) across all animations and all skins (one ' +
        'undo step). The prerequisite for re-topologizing a deformed mesh.',
      input: z.object({ documentId, slotId, name: attachmentName }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireSlot(session, input.slotId);
      session.document.history.execute(
        new ClearAttachmentDeformCommand(asSlotId(input.slotId), input.name),
      );
      return { revision: session.document.model.revision };
    },
  ),

  // ----- history -----
  defineTool(
    {
      name: 'history.undo',
      title: 'Undo',
      description: 'Undo the last committed change.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ event: deps.sessions.get(input.documentId).document.history.undo() }),
  ),
  defineTool(
    {
      name: 'history.redo',
      title: 'Redo',
      description: 'Redo the last undone change.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({ event: deps.sessions.get(input.documentId).document.history.redo() }),
  ),
  defineTool(
    {
      name: 'history.getState',
      title: 'Get history state',
      description: 'Report whether undo/redo are available and their labels.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => {
      const history = deps.sessions.get(input.documentId).document.history;
      return {
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        undoLabel: history.undoLabel,
        redoLabel: history.redoLabel,
      };
    },
  ),
  defineTool(
    {
      name: 'history.beginInteraction',
      title: 'Begin interaction',
      description: 'Start a coalescing interaction; subsequent edits collapse into one undo step.',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => {
      deps.sessions.get(input.documentId).document.history.beginInteraction();
      return { ok: true };
    },
  ),
  defineTool(
    {
      name: 'history.endInteraction',
      title: 'End interaction',
      description: 'Commit the interaction as a single undo step with the given label.',
      input: z.object({ documentId, label: z.string().min(1) }).strict(),
    },
    (deps, input) => ({
      event: deps.sessions.get(input.documentId).document.history.endInteraction(input.label),
    }),
  ),

  // ----- query (read-only) -----
  defineTool(
    {
      name: 'document.getWorldTransforms',
      title: 'Get world transforms',
      description: 'Solve the setup pose and return each bone world matrix [a, b, c, d, tx, ty].',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => {
      const model = deps.sessions.get(input.documentId).document.model;
      const exported = exportOrThrow(model);
      const pose = buildPose(exported);
      resetToSetupPose(pose);
      computeWorldTransforms(pose);
      const transforms = pose.boneNames.map((name, index) => {
        const base = index * MAT2X3_STRIDE;
        return { name, world: Array.from(pose.world.subarray(base, base + MAT2X3_STRIDE)) };
      });
      return { transforms };
    },
  ),
  defineTool(
    {
      name: 'atlas.pack',
      title: 'Pack atlas',
      description:
        'Pack the source PNGs in a project directory into a deterministic atlas (import -> alpha-trim -> ' +
        'maxrects pack -> emit, ADR-0007) and install it through the command history (LAW 2). `sourceDir` ' +
        'and `outputDir` are project-relative and confined to the project root; page PNGs are written under ' +
        '`outputDir` and the returned AtlasRef records each page path project-relative so render_frame can ' +
        'read it back. Region names are the source file base names; region/mesh attachment `path` resolves ' +
        'against them.',
      input: z
        .object({
          documentId,
          sourceDir: z.string().min(1),
          outputDir: z.string().min(1),
          maxPageSize: z.number().int().min(1).max(4096).optional(),
          padding: z.number().int().nonnegative().optional(),
        })
        .strict(),
    },
    async (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const store = atlasFileStoreFrom(deps.files);

      // Validate the source directory up front so a missing/empty/pngless dir is a loud ATLAS_PACK_*
      // before any pack work, and a traversal surfaces PATH_FORBIDDEN from the confined FileStore.
      let entries: readonly string[];
      try {
        entries = await store.listDir(input.sourceDir);
      } catch (error) {
        if (error instanceof McpToolError) throw error; // PATH_FORBIDDEN
        throw new McpToolError(
          'ATLAS_PACK_SOURCE_MISSING',
          `atlas source directory "${input.sourceDir}" is missing or unreadable`,
          { sourceDir: input.sourceDir },
        );
      }
      if (!entries.some((name) => name.toLowerCase().endsWith('.png'))) {
        throw new McpToolError(
          'ATLAS_PACK_EMPTY_SOURCE',
          `atlas source directory "${input.sourceDir}" contains no PNG sprites`,
          { sourceDir: input.sourceDir },
        );
      }

      const config: PackConfig = {
        ...(input.maxPageSize !== undefined ? { maxPageSize: input.maxPageSize } : {}),
        ...(input.padding !== undefined ? { padding: input.padding } : {}),
      };

      let packed: AtlasRef;
      try {
        packed = await runAtlasPipeline({
          sourceDir: input.sourceDir,
          outputDir: input.outputDir,
          fileStore: store,
          config,
        });
      } catch (error) {
        mapAtlasPackError(error);
      }

      const atlas: AtlasRef = {
        pages: packed.pages.map((page) => ({
          ...page,
          file: joinProjectPath(input.outputDir, page.file),
        })),
      };

      session.document.history.execute(new SetAtlasRefCommand(atlas));
      return { revision: session.document.model.revision, atlas };
    },
  ),
  defineTool(
    {
      name: 'atlas.set',
      title: 'Set atlas',
      description:
        'Install the document atlas (packed pages + regions) through the command history (LAW 2). The ' +
        'editor atlas-pack pipeline produces the AtlasRef; this is the only legal path that sets it. ' +
        'Region/mesh attachment `path` references resolve against the region names installed here.',
      input: z.object({ documentId, atlas: atlasRefInputSchema }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      session.document.history.execute(new SetAtlasRefCommand(input.atlas));
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'atlas.get',
      title: 'Get atlas',
      description: 'Return the document current atlas ref (packed pages + regions).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      atlas: deps.sessions.get(input.documentId).document.model.preserved().atlas,
    }),
  ),
  defineTool(
    {
      name: 'render_frame',
      title: 'Render frame',
      description:
        'Rasterize the current document to a PNG for headless authoring feedback (ADR-0006) and return ' +
        'it base64-encoded. Renders the setup pose, or an animation sampled at `time` (clamped to the ' +
        'animation duration). Atlas page PNGs referenced by the document are loaded from the project ' +
        'root; a referenced page file that is missing on disk is a loud error. When the document has no ' +
        'atlas pages at all, attachments render as tintable white placeholders and `placeholders` is true. ' +
        'Pass `effect` to overlay a solved effect/bundle from the live effects library ON TOP of the ' +
        'skeleton in the same frame (world-space anchors only in this pass; bone anchors are not wired yet).',
      input: z
        .object({
          documentId,
          animation: z.string().min(1).optional(),
          time: z.number().finite().optional(),
          width: renderDimension.default(512),
          height: renderDimension.default(512),
          fit: renderFitSchema.default('content'),
          background: rgbaSchema.optional(),
          effect: renderEffectSchema.optional(),
        })
        .strict(),
    },
    async (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const document = exportOrThrow(session.document.model);

      const pages = await loadAtlasPages(deps.files, document.atlas);
      const placeholders = document.atlas.pages.length === 0;

      let result: RenderFrameResult;
      if (input.effect === undefined) {
        try {
          result = renderFrame({
            document,
            ...(input.animation !== undefined ? { animation: input.animation } : {}),
            ...(input.time !== undefined ? { time: input.time } : {}),
            atlas: { pages },
            viewport: { width: input.width, height: input.height, fit: input.fit },
            ...(input.background !== undefined ? { background: input.background } : {}),
          });
        } catch (error) {
          mapRenderError(error);
        }
      } else {
        // Effects overlay: export + resolve the effects library's OWN atlas (its pages may share the
        // skeleton's names or be wholly separate), build a world-anchor trigger, and compose. The effects
        // export and page reads run BEFORE the render try so their typed McpToolErrors surface directly.
        const spec = input.effect;
        const effectsDocument = exportEffectsOrThrow(session.document.effects);
        const effectPages = await loadAtlasPages(deps.files, effectsDocument.atlas);

        const anchors: Record<string, EffectAnchorInput> = {};
        if (spec.anchors !== undefined) {
          for (const [role, anchor] of Object.entries(spec.anchors)) {
            anchors[role] =
              anchor.rotation === undefined
                ? { x: anchor.x, y: anchor.y }
                : { x: anchor.x, y: anchor.y, rotation: anchor.rotation };
          }
        }
        const trigger = {
          ...(spec.effect !== undefined ? { effect: spec.effect } : {}),
          ...(spec.bundle !== undefined ? { bundle: spec.bundle } : {}),
          seed: spec.seed,
          anchors,
        };
        const effectTime = spec.time ?? input.time ?? 0;

        try {
          result = renderComposedFrame({
            skeleton: {
              document,
              ...(input.animation !== undefined ? { animation: input.animation } : {}),
              ...(input.time !== undefined ? { time: input.time } : {}),
              atlas: { pages },
            },
            effect: {
              effectsDocument,
              trigger,
              time: effectTime,
              atlas: { pages: effectPages },
            },
            viewport: { width: input.width, height: input.height, fit: input.fit },
            ...(input.background !== undefined ? { background: input.background } : {}),
          });
        } catch (error) {
          mapRenderError(error);
        }
      }

      return {
        pngBase64: Buffer.from(result.png).toString('base64'),
        width: result.width,
        height: result.height,
        bytes: result.png.byteLength,
        placeholders,
      };
    },
  ),

  // ----- animation operations (same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'anim.create',
      title: 'Create animation',
      description: 'Create a new, empty animation with a duration and return its id.',
      input: z
        .object({
          documentId,
          name: z.string().min(1),
          duration: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const newId = session.document.ids.mint('animation');
      session.document.history.execute(
        new CreateAnimationCommand(newId, input.name, input.duration),
      );
      return { animationId: newId };
    },
  ),
  defineTool(
    {
      name: 'anim.delete',
      title: 'Delete animation',
      description: 'Delete an animation and all its timelines (one undo step).',
      input: z.object({ documentId, animationId }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      session.document.history.execute(
        new DeleteAnimationCommand(asAnimationId(input.animationId)),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'anim.rename',
      title: 'Rename animation',
      description: 'Rename an animation (identity is the id, so timelines are unaffected).',
      input: z.object({ documentId, animationId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      session.document.history.execute(
        new RenameAnimationCommand(asAnimationId(input.animationId), input.name),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'anim.duration',
      title: 'Set animation duration',
      description:
        'Set an animation duration (seconds). Rejects shrinking below the last keyframe time as ' +
        'ANIMATION_DURATION.',
      input: z
        .object({ documentId, animationId, duration: z.number().finite().nonnegative() })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      try {
        session.document.history.execute(
          new SetAnimationDurationCommand(asAnimationId(input.animationId), input.duration),
        );
      } catch (error) {
        if (error instanceof AnimationDurationError) {
          throw new McpToolError('ANIMATION_DURATION', error.message);
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'anim.duplicate',
      title: 'Duplicate animation',
      description: 'Duplicate an animation under a new name and return the new id (one undo step).',
      input: z.object({ documentId, animationId, name: z.string().min(1) }).strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const newId = session.document.ids.mint('animation');
      session.document.history.execute(
        new DuplicateAnimationCommand(asAnimationId(input.animationId), newId, input.name),
      );
      return { animationId: newId };
    },
  ),
  defineTool(
    {
      name: 'anim.list',
      title: 'List animations',
      description: 'List the animations (id, name, duration, track counts).',
      input: z.object({ documentId }).strict(),
    },
    (deps, input) => ({
      animations: deps.sessions
        .get(input.documentId)
        .document.model.animations()
        .map(animationSummary),
    }),
  ),
  defineTool(
    {
      name: 'anim.get',
      title: 'Get animation',
      description: 'Get one animation with all its timelines and keyframes by id.',
      input: z.object({ documentId, animationId }).strict(),
    },
    (deps, input) => ({
      animation: animationView(
        requireAnimation(deps.sessions.get(input.documentId), input.animationId),
      ),
    }),
  ),

  // ----- keyframe operations (same command + History as the GUI, LAW 2) -----
  defineTool(
    {
      name: 'kf.set',
      title: 'Set keyframe',
      description:
        'Insert or update a keyframe at a time on a channel. `channel` is rotate/translate/scale/' +
        'shear (with boneId) or color (with slotId); `value` must match the channel shape. Updating an ' +
        'existing time keeps its curve; a new keyframe takes the optional insert `curve` (default linear).',
      input: z
        .object({
          documentId,
          animationId,
          channel: channelSchema,
          boneId: boneId.optional(),
          slotId: slotId.optional(),
          time: z.number().finite().nonnegative(),
          value: keyframeValueSchema,
          curve: curveSchema.optional(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const target = resolveTarget(session, input.channel, input.boneId, input.slotId);
      const value = checkValueShape(input.channel, input.value);
      session.document.history.execute(
        input.curve === undefined
          ? new SetKeyframeCommand(asAnimationId(input.animationId), target, input.time, value)
          : new SetKeyframeCommand(
              asAnimationId(input.animationId),
              target,
              input.time,
              value,
              input.curve,
            ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.move',
      title: 'Move keyframe',
      description:
        'Move a keyframe (by id) to a new time on its channel. Rejects landing on an occupied time ' +
        'as KEYFRAME_COLLISION.',
      input: z
        .object({
          documentId,
          animationId,
          channel: channelSchema,
          boneId: boneId.optional(),
          slotId: slotId.optional(),
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const animation = requireAnimation(session, input.animationId);
      const target = resolveTarget(session, input.channel, input.boneId, input.slotId);
      requireKeyframe(animation, target, input.keyframeId);
      try {
        session.document.history.execute(
          new MoveKeyframeCommand(
            asAnimationId(input.animationId),
            target,
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.delete',
      title: 'Delete keyframe',
      description: 'Delete a keyframe (by id) from its channel.',
      input: z
        .object({
          documentId,
          animationId,
          channel: channelSchema,
          boneId: boneId.optional(),
          slotId: slotId.optional(),
          keyframeId,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const animation = requireAnimation(session, input.animationId);
      const target = resolveTarget(session, input.channel, input.boneId, input.slotId);
      requireKeyframe(animation, target, input.keyframeId);
      session.document.history.execute(
        new DeleteKeyframeCommand(
          asAnimationId(input.animationId),
          target,
          asKeyframeId(input.keyframeId),
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.curve',
      title: 'Set keyframe curve',
      description: 'Set a keyframe outgoing interpolation curve (linear / stepped / bezier).',
      input: z
        .object({
          documentId,
          animationId,
          channel: channelSchema,
          boneId: boneId.optional(),
          slotId: slotId.optional(),
          keyframeId,
          curve: curveSchema,
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      const animation = requireAnimation(session, input.animationId);
      const target = resolveTarget(session, input.channel, input.boneId, input.slotId);
      requireKeyframe(animation, target, input.keyframeId);
      session.document.history.execute(
        new SetCurveCommand(
          asAnimationId(input.animationId),
          target,
          asKeyframeId(input.keyframeId),
          input.curve,
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.paste',
      title: 'Paste keyframes',
      description:
        'Insert several keyframes at absolute times in one undo step. Each item names its channel ' +
        '(with boneId/slotId), time, value (matching the channel), and curve.',
      input: z
        .object({
          documentId,
          animationId,
          items: z
            .array(
              z
                .object({
                  channel: channelSchema,
                  boneId: boneId.optional(),
                  slotId: slotId.optional(),
                  time: z.number().finite().nonnegative(),
                  value: keyframeValueSchema,
                  curve: curveSchema.default('linear'),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      const items: PastedKeyframe[] = input.items.map((item) => {
        const target = resolveTarget(session, item.channel, item.boneId, item.slotId);
        const value = checkValueShape(item.channel, item.value);
        return { target, time: item.time, value, curve: item.curve };
      });
      session.document.history.execute(
        new PasteKeyframesCommand(asAnimationId(input.animationId), items),
      );
      return { revision: session.document.model.revision };
    },
  ),

  // ----- attachment-swap keyframes (the stepped slot attachment timeline; each drives the document-core
  // command on the shared History, LAW 2). Targets are pre-validated with the require* helpers so a missing
  // animation/slot is a typed *_NOT_FOUND before the command runs (mirroring ik.setKeyframe); a non-null swap
  // name that resolves to no attachment on the slot is ATTACHMENT_NOT_FOUND (the author-time mirror of the
  // import validator's SLOT_ATTACHMENT_MISSING). Neither command coalesces (a swap is discrete and stepped).
  defineTool(
    {
      name: 'kf.attachment.set',
      title: 'Set attachment keyframe',
      description:
        'Insert or replace a slot attachment-swap frame at a time on the stepped attachment timeline. ' +
        '`name` is the attachment to show (which must resolve on the slot), or null to hide the slot. ' +
        'Replacing an existing frame at the same time keeps its id.',
      input: z
        .object({
          documentId,
          animationId,
          slotId,
          time: z.number().finite().nonnegative(),
          name: z.string().min(1).nullable(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireSlot(session, input.slotId);
      if (
        input.name !== null &&
        session.document.model.getAttachment(asSlotId(input.slotId), input.name) === undefined
      ) {
        throw new McpToolError(
          'ATTACHMENT_NOT_FOUND',
          `slot "${input.slotId}" has no attachment "${input.name}"`,
        );
      }
      session.document.history.execute(
        new SetAttachmentKeyframeCommand(
          asAnimationId(input.animationId),
          asSlotId(input.slotId),
          input.time,
          input.name,
        ),
      );
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.attachment.delete',
      title: 'Delete attachment keyframe',
      description:
        'Delete the slot attachment-swap frame at exactly `time` from the stepped attachment timeline. ' +
        'A time with no frame is a typed KEYFRAME_NOT_FOUND.',
      input: z
        .object({
          documentId,
          animationId,
          slotId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireSlot(session, input.slotId);
      try {
        session.document.history.execute(
          new DeleteAttachmentKeyframeCommand(
            asAnimationId(input.animationId),
            asSlotId(input.slotId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no attachment keyframe at time ${input.time} on slot "${input.slotId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),
  defineTool(
    {
      name: 'kf.attachment.move',
      title: 'Move attachment keyframe',
      description:
        'Move a slot attachment-swap frame (by id) to a new time on the stepped attachment timeline ' +
        '(times are strictly ascending). Landing on an occupied time is a typed KEYFRAME_COLLISION; a ' +
        'missing frame is a typed KEYFRAME_NOT_FOUND. The moved frame keeps its `name`.',
      input: z
        .object({
          documentId,
          animationId,
          slotId,
          keyframeId,
          time: z.number().finite().nonnegative(),
        })
        .strict(),
    },
    (deps, input) => {
      const session = deps.sessions.get(input.documentId);
      requireAnimation(session, input.animationId);
      requireSlot(session, input.slotId);
      try {
        session.document.history.execute(
          new MoveAttachmentKeyframeCommand(
            asAnimationId(input.animationId),
            asSlotId(input.slotId),
            asKeyframeId(input.keyframeId),
            input.time,
          ),
        );
      } catch (error) {
        if (error instanceof KeyframeCollisionError) {
          throw new McpToolError('KEYFRAME_COLLISION', error.message);
        }
        if (error instanceof CommandTargetMissingError) {
          throw new McpToolError(
            'KEYFRAME_NOT_FOUND',
            `no attachment keyframe "${input.keyframeId}" on slot "${input.slotId}"`,
          );
        }
        throw error;
      }
      return { revision: session.document.model.revision };
    },
  ),

  // ----- effects (VFX / particles, Phase 3) + slot composer (Phase 4) -----
  ...effectsTools,
  ...slotSceneTools,
  // ----- events + draw-order timelines (Stage F1, PP-D9) -----
  ...eventTools,
];
