import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, LinkedMeshError } from '../command/errors';
import type { AttachmentEntity, MeshAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { DEFAULT_SKIN_NAME, resolveGeometrySource } from './linked-mesh-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Unlink a linked mesh, BAKING it to a plain mesh (`attach.linkedmesh.unlink`, PP-D10). The linked mesh's
// geometry is resolved by walking its parent chain to the root mesh (mirroring the format's
// resolveGeometrySource); the baked mesh takes that geometry (uvs/triangles/hull/vertices/edges/bones) and
// keeps the linked mesh's OWN identity (name, atlas path, size, color). The target must be a linked mesh in
// the slot's default skin, else a typed LinkedMeshError('notFound'). before/after are the whole attachment
// entity, so undo restores the exact prior linked mesh. Never coalesces.
export class UnlinkMeshCommand implements Command {
  readonly kind = 'attach.linkedmesh.unlink';
  readonly label = 'Unlink Mesh';
  private before: AttachmentEntity | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const current = ctx.mutate.getAttachment(this.slotId, this.name);
    if (current === undefined || current.kind !== 'linkedmesh') {
      throw new LinkedMeshError(this.slotId, this.name, 'notFound');
    }
    this.before = current;
    // Resolve the geometry by walking THIS linked mesh's parent chain (it lives in the default skin).
    const source = resolveGeometrySource(ctx.mutate, DEFAULT_SKIN_NAME, this.slotId, this.name);
    if (source.kind === 'missing') {
      throw new LinkedMeshError(this.slotId, this.name, 'parentMissing', current.parent);
    }
    if (source.kind === 'invalid') {
      throw new LinkedMeshError(this.slotId, this.name, 'parentInvalid', current.parent);
    }
    if (source.kind === 'cycle') {
      throw new LinkedMeshError(this.slotId, this.name, 'cycle', current.parent);
    }
    const geometry = source.mesh;
    const baked: MeshAttachmentEntity = {
      kind: 'mesh',
      name: current.name,
      path: current.path,
      uvs: geometry.uvs.slice(),
      triangles: geometry.triangles.slice(),
      hullLength: geometry.hullLength,
      width: current.width,
      height: current.height,
      color: { ...current.color },
      vertices: geometry.vertices.slice(),
      ...(geometry.edges !== undefined ? { edges: geometry.edges.slice() } : {}),
      ...(geometry.bones !== undefined ? { bones: geometry.bones.slice() } : {}),
    };
    ctx.mutate.addAttachment(this.slotId, baked);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.addAttachment(this.slotId, this.before);
  }
}

export const unlinkMeshSpec: CommandSpec = {
  kind: 'attach.linkedmesh.unlink',
  // The 'linked' seed carries a linked mesh ('panel_ref' on 'mesh_slot') whose parent is the real mesh 'panel'.
  representativeSeedId: 'linked',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const linked = model.attachments(slot.id).find((a) => a.kind === 'linkedmesh');
      if (linked === undefined) continue;
      return { command: new UnlinkMeshCommand(slot.id, linked.name) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const att of before.attachments) {
      if (att.kind !== 'linkedmesh') continue;
      const baked = findAttachmentSnapshot(after, att.slotId, att.name);
      if (baked === undefined || baked.kind !== 'mesh') {
        throw new Error('attach.linkedmesh.unlink did not bake the linked mesh to a mesh');
      }
      return;
    }
    throw new Error('attach.linkedmesh.unlink fixture seed had no linked mesh');
  },
};
