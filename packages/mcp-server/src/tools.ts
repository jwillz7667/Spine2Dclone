import {
  AddMeshVertexCommand,
  AddRegionAttachmentCommand,
  AnimationDurationError,
  AutoGridFillMeshCommand,
  AutoPerimeterTraceMeshCommand,
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateSlotCommand,
  DeleteAnimationCommand,
  DeleteBoneCommand,
  DeleteKeyframeCommand,
  DeleteMeshVertexCommand,
  DeleteSlotCommand,
  DocumentInvariantError,
  DuplicateAnimationCommand,
  ExportValidationError,
  GenerateMeshFromRegionCommand,
  KeyframeCollisionError,
  MeshTopologyLockedError,
  MoveBoneCommand,
  MoveKeyframeCommand,
  MoveMeshVertexCommand,
  PasteKeyframesCommand,
  RemoveAttachmentCommand,
  RenameAnimationCommand,
  RenameBoneCommand,
  RenameSlotCommand,
  ReorderSlotCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetActiveAttachmentCommand,
  SetAnimationDurationCommand,
  SetBoneLengthCommand,
  SetBoneTransformModeCommand,
  SetCurveCommand,
  SetKeyframeCommand,
  SetMeshEdgesCommand,
  SetRegionAttachmentTransformCommand,
  SetSlotBlendModeCommand,
  SetSlotColorCommand,
  exportDocument,
  type AnimationEntity,
  type AnimationId,
  type BoneChannel,
  type BoneEntity,
  type BoneId,
  type Command,
  type DocumentReadModel,
  type KeyframeEntity,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
  type PastedKeyframe,
  type SlotEntity,
  type SlotId,
} from '@marionette/document-core';
import { FormatValidationError } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  MAT2X3_STRIDE,
  buildPose,
  computeWorldTransforms,
  resetToSetupPose,
} from '@marionette/runtime-core';
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

// A summary of an animation (ids, name, duration, and per-bone/slot track counts); the keyframe detail
// lives in animationView for `anim.get`.
function animationSummary(animation: AnimationEntity): Record<string, unknown> {
  return {
    id: animation.id,
    name: animation.name,
    duration: animation.duration,
    boneTracks: animation.bones.size,
    slotTracks: animation.slots.size,
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
];
