import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { assertTopologyEditable, type MeshAutoFill } from './mesh-support';

// Auto grid-fill a mesh (command-history catalog AutoGridFillMesh, `mesh.autoGridFill`; TASK-2.1.5). The
// editor generates a regular interior grid clipped to the hull and triangulates it (it owns earcut and
// the cell-size UI param), then passes the full new geometry; this command replaces it as ONE undoable
// step. The full prior MeshGeometry is the before memento. `edges` from the fill replaces the wireframe
// (an omitted `edges` clears it, since the regenerated topology invalidates old edge indices); `bones`
// is preserved (unweighted stays unweighted). Topology-locked (changes vertex count/order): forbidden on
// a weighted or deformed mesh (TASK-2.1.8). NOT coalescing.
export class AutoGridFillMeshCommand implements Command {
  readonly kind = 'mesh.autoGridFill';
  readonly label = 'Auto Grid-Fill Mesh';
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
        edges: this.mesh.edges, // undefined clears the wireframe
      };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const autoGridFillMeshSpec: CommandSpec = {
  kind: 'mesh.autoGridFill',
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (att && att.kind === 'mesh' && att.bones === undefined) {
        // A 3x3 grid (9 vertices) replacing the seed mesh, with a 2x2 cell triangulation.
        return {
          command: new AutoGridFillMeshCommand(slot.id, att.name, {
            uvs: [0, 0, 0.5, 0, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0.5, 0, 1, 0.5, 1, 1, 1],
            triangles: [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7],
            hullLength: 4,
            vertices: [0, 0, 32, 0, 64, 0, 0, 32, 32, 32, 64, 32, 0, 64, 32, 64, 64, 64],
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
    if (!changed) throw new Error('mesh.autoGridFill produced no geometry delta');
  },
};
