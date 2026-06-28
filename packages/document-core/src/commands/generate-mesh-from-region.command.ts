import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, CommandTargetMissingError } from '../command/errors';
import type { MeshAttachmentEntity, RegionAttachmentEntity } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import type { MeshInit } from './mesh-support';

// Replace a RegionAttachment with a MeshAttachment under the same (slot, name) (command-history catalog
// GenerateMeshFromRegion, `mesh.generateFromRegion`; TASK-2.1.1). The editor computes the quad-from-
// region geometry (hull = the 4 region corners, hullLength 4, default 2 triangles, uvs from the atlas
// region, flat unweighted vertices, `bones` omitted) and passes it in; this command is the pure data
// swap. do captures the exact prior region as its memento and overwrites the map entry with the mesh;
// undo overwrites it back with the region. The slot's active-attachment name is unchanged (same name).
// NOT coalescing (structural).
export class GenerateMeshFromRegionCommand implements Command {
  readonly kind = 'mesh.generateFromRegion';
  readonly label = 'Generate Mesh From Region';
  private before: RegionAttachmentEntity | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly mesh: MeshInit,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.before) {
      const att = ctx.mutate.getAttachment(this.slotId, this.name);
      if (!att || att.kind !== 'region') {
        throw new CommandTargetMissingError(this.kind, `${this.slotId}/${this.name}`);
      }
      this.before = att; // a frozen deep copy (getAttachment hand-out)
    }
    const entity: MeshAttachmentEntity = {
      kind: 'mesh',
      name: this.name,
      path: this.before.path, // the mesh references the same atlas region as the source region
      uvs: this.mesh.uvs.slice(),
      triangles: this.mesh.triangles.slice(),
      hullLength: this.mesh.hullLength,
      width: this.mesh.width,
      height: this.mesh.height,
      color: { ...this.mesh.color },
      vertices: this.mesh.vertices.slice(),
      ...(this.mesh.edges !== undefined ? { edges: this.mesh.edges.slice() } : {}),
      // bones omitted: WP-2.1 generates UNWEIGHTED meshes; binding is WP-2.3.
    };
    ctx.mutate.addAttachment(this.slotId, entity); // overwrites the region under the same name
  }

  undo(ctx: CommandContext): void {
    if (!this.before) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.addAttachment(this.slotId, this.before); // overwrites the mesh back to the region
  }
}

export const generateMeshFromRegionSpec: CommandSpec = {
  kind: 'mesh.generateFromRegion',
  // 'meshed' carries a region attachment ('body' on slot 'body') the swap can target.
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'region');
      if (att && att.kind === 'region') {
        return {
          command: new GenerateMeshFromRegionCommand(slot.id, att.name, {
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            hullLength: 4,
            width: att.width,
            height: att.height,
            color: { r: 1, g: 1, b: 1, a: 1 },
            vertices: [0, 0, att.width, 0, att.width, att.height, 0, att.height],
          }),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let swapped = false;
    for (const b of before.attachments) {
      if (b.kind !== 'region') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh') swapped = true;
    }
    if (!swapped) throw new Error('mesh.generateFromRegion did not swap a region to a mesh');
  },
};
