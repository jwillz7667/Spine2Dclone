import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { assertTopologyEditable } from './mesh-support';

// Delete a mesh vertex (command-history catalog DeleteMeshVertex, `mesh.deleteVertex`; TASK-2.1.2). The
// editor re-triangulates the remaining vertices and passes the recomputed `newUvs`/`newTriangles`/
// `newVertices` (forbidding deletion of a hull vertex that would open the polygon is an EDITOR concern;
// this command just applies). The full prior MeshGeometry is the before memento. Topology-locked:
// forbidden on a weighted or deformed mesh (TASK-2.1.8), thrown before any mutation. NOT coalescing.
export class DeleteMeshVertexCommand implements Command {
  readonly kind = 'mesh.deleteVertex';
  readonly label = 'Delete Mesh Vertex';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly newUvs: readonly number[],
    private readonly newTriangles: readonly number[],
    private readonly newVertices: readonly number[],
  ) {}

  do(ctx: CommandContext): void {
    const mesh = assertTopologyEditable(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      this.before = meshGeometryOf(mesh);
      this.after = {
        ...this.before,
        uvs: this.newUvs,
        triangles: this.newTriangles,
        vertices: this.newVertices,
      };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const deleteMeshVertexSpec: CommandSpec = {
  kind: 'mesh.deleteVertex',
  // 'meshed' carries an unweighted 5-vertex mesh; deleting the interior vertex returns it to the 4-corner
  // quad (hullLength 4 stays valid).
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (att && att.kind === 'mesh' && att.bones === undefined && att.vertices.length > 8) {
        return {
          command: new DeleteMeshVertexCommand(
            slot.id,
            att.name,
            [0, 0, 1, 0, 1, 1, 0, 1],
            [0, 1, 2, 0, 2, 3],
            [0, 0, 64, 0, 64, 64, 0, 64],
          ),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let shrank = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (
        a &&
        a.kind === 'mesh' &&
        a.uvs.length < b.uvs.length &&
        a.vertices.length < b.vertices.length
      ) {
        shrank = true;
      }
    }
    if (!shrank) throw new Error('mesh.deleteVertex did not shrink the mesh geometry');
  },
};
