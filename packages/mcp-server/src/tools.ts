import {
  CreateBoneCommand,
  DeleteBoneCommand,
  DocumentInvariantError,
  ExportValidationError,
  MoveBoneCommand,
  RenameBoneCommand,
  ReparentBoneCommand,
  ReparentCycleError,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetBoneLengthCommand,
  SetBoneTransformModeCommand,
  exportDocument,
  type BoneEntity,
  type BoneId,
  type DocumentReadModel,
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

const transformModeSchema = z.enum([
  'normal',
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
]);

const documentId = z.string().min(1);
const boneId = z.string().min(1);

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
];
