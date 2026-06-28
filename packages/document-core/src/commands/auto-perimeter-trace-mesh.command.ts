import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { assertTopologyEditable, type MeshAutoFill } from './mesh-support';

// Auto perimeter-trace a mesh (command-history catalog AutoPerimeterTraceMesh, `mesh.autoPerimeterTrace`;
// TASK-2.1.6). The editor traces the sprite's alpha silhouette (marching-squares on the trimmed alpha
// mask), simplifies it (Douglas-Peucker) to seed a hull, grid-fills the interior, and triangulates, then
// passes the full new geometry; this command replaces it as ONE undoable step. The full prior
// MeshGeometry is the before memento. `edges` from the trace replaces the wireframe (omitted clears it);
// `bones` is preserved. Topology-locked (changes vertex count/order): forbidden on a weighted or deformed
// mesh (TASK-2.1.8). NOT coalescing. (Same data-swap shape as AutoGridFillMesh; distinct command kind so
// the two appear as separate, labelled undo steps.)
export class AutoPerimeterTraceMeshCommand implements Command {
  readonly kind = 'mesh.autoPerimeterTrace';
  readonly label = 'Auto Perimeter-Trace Mesh';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly mesh: MeshAutoFill,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = assertTopologyEditable(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      this.before = meshGeometryOf(mesh);
      this.after = {
        ...this.before,
        uvs: this.mesh.uvs,
        triangles: this.mesh.triangles,
        hullLength: this.mesh.hullLength,
        vertices: this.mesh.vertices,
        edges: this.mesh.edges,
      };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const autoPerimeterTraceMeshSpec: CommandSpec = {
  kind: 'mesh.autoPerimeterTrace',
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (att && att.kind === 'mesh' && att.bones === undefined) {
        // A traced hexagonal hull (6 hull vertices) plus a center vertex, fan-triangulated, with the
        // hull edges as the wireframe.
        return {
          command: new AutoPerimeterTraceMeshCommand(slot.id, att.name, {
            uvs: [0.5, 0, 1, 0.25, 1, 0.75, 0.5, 1, 0, 0.75, 0, 0.25, 0.5, 0.5],
            triangles: [0, 1, 6, 1, 2, 6, 2, 3, 6, 3, 4, 6, 4, 5, 6, 5, 0, 6],
            hullLength: 6,
            vertices: [32, 0, 64, 16, 64, 48, 32, 64, 0, 48, 0, 16, 32, 32],
            edges: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0],
          }),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let changed = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh' && a.uvs.join(',') !== b.uvs.join(',')) changed = true;
    }
    if (!changed) throw new Error('mesh.autoPerimeterTrace produced no geometry delta');
  },
};
