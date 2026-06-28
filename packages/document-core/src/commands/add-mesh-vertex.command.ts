import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { assertTopologyEditable } from './mesh-support';

// Add an interior vertex to a mesh (command-history catalog AddMeshVertex, `mesh.addVertex`; TASK-2.1.2).
// The editor re-triangulates (it owns earcut, the source bitmap, and the uv interpolation) and passes the
// recomputed `newUvs`/`newTriangles`/`newVertices`; this command swaps the geometry. The full prior
// MeshGeometry is the before memento (hullLength/edges/bones are preserved). Topology-locked: forbidden
// on a weighted or deformed mesh (TASK-2.1.8), thrown before any mutation. NOT coalescing (each add is a
// discrete undo step; ADD changes vertex count, so it can never merge with anything).
export class AddMeshVertexCommand implements Command {
  readonly kind = 'mesh.addVertex';
  readonly label = 'Add Mesh Vertex';
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

export const addMeshVertexSpec: CommandSpec = {
  kind: 'mesh.addVertex',
  // 'meshed' carries an unweighted mesh ('panel' on slot 'mesh_slot') a vertex can be added to.
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (att && att.kind === 'mesh' && att.bones === undefined) {
        // Add a second interior vertex (uv 0.25,0.25, pos 16,16) to the seed's 5-vertex mesh and
        // re-triangulate (6 vertices total). The editor computes the real triangulation; here the
        // arrays just need to grow the geometry by one vertex.
        return {
          command: new AddMeshVertexCommand(
            slot.id,
            att.name,
            [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5, 0.25, 0.25],
            [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 5, 5, 0, 4, 5, 4, 3],
            [0, 0, 64, 0, 64, 64, 0, 64, 32, 32, 16, 16],
          ),
        };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let grew = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (
        a &&
        a.kind === 'mesh' &&
        a.uvs.length > b.uvs.length &&
        a.vertices.length > b.vertices.length
      ) {
        grew = true;
      }
    }
    if (!grew) throw new Error('mesh.addVertex did not grow the mesh geometry');
  },
};
