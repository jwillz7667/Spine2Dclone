import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, MeshTopologyLockedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { requireMesh } from './mesh-support';

// Move one mesh vertex (command-history catalog MoveMeshVertex, `mesh.moveVertex`; TASK-2.1.2). The drag
// runs inside an interaction group (beginInteraction/endInteraction); each pointer-move is one command,
// and consecutive moves of the SAME (slot, attachment, vertexIndex) coalesce into one undo step keeping
// the gesture-start geometry as the single before memento. MOVE never re-triangulates: triangle indices
// stay stable, only the vertex position changes, so a DEFORMED mesh stays movable (offsets are per-vertex
// and the count is unchanged). A WEIGHTED mesh is REJECTED with MeshTopologyLockedError('weighted'): its
// `vertices` array is the self-delimiting influence stream [boneCount, (boneIndex, bindX, bindY, w)...],
// so a flat [2i, 2i+1] write would silently corrupt bone indices/weights. Moving a weighted vertex means
// re-encoding its bind-local influence entries; until that lands, failing loudly beats corrupting.
export class MoveMeshVertexCommand implements Command {
  readonly kind = 'mesh.moveVertex';
  readonly label = 'Move Mesh Vertex';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly vertexIndex: number,
    private readonly x: number,
    private readonly y: number,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireMesh(ctx, this.kind, this.slotId, this.name);
    if (mesh.bones !== undefined) {
      throw new MeshTopologyLockedError(this.slotId, this.name, 'weighted');
    }
    if (this.before === undefined || this.after === undefined) {
      this.before = meshGeometryOf(mesh);
      const vertices = this.before.vertices.slice();
      vertices[this.vertexIndex * 2] = this.x;
      vertices[this.vertexIndex * 2 + 1] = this.y;
      this.after = { ...this.before, vertices };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }

  // Same slot + attachment + vertexIndex only. The merged command keeps the ORIGINAL before (gesture
  // start) and the latest after, so one undo of a coalesced drag returns to the pre-drag geometry
  // (command-history Section 5.3). A different vertex index does not merge.
  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveMeshVertexCommand &&
      prev.slotId === this.slotId &&
      prev.name === this.name &&
      prev.vertexIndex === this.vertexIndex
    ) {
      const merged = new MoveMeshVertexCommand(
        this.slotId,
        this.name,
        this.vertexIndex,
        this.x,
        this.y,
      );
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

export const moveMeshVertexSpec: CommandSpec = {
  kind: 'mesh.moveVertex',
  // 'meshed' carries an unweighted mesh ('panel' on slot 'mesh_slot') with movable vertices. Weighted
  // meshes are excluded: MOVE rejects them (their flat-vertex encoding is the influence stream).
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones === undefined);
      if (att && att.kind === 'mesh' && att.vertices.length >= 2) {
        return { command: new MoveMeshVertexCommand(slot.id, att.name, 0, 5, 7) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let moved = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'mesh') continue;
      if (a.vertices.join(',') !== b.vertices.join(',')) {
        if (
          a.vertices.length !== b.vertices.length ||
          a.triangles.join(',') !== b.triangles.join(',')
        ) {
          throw new Error('mesh.moveVertex changed vertex count or triangulation (it must not)');
        }
        moved = true;
      }
    }
    if (!moved) throw new Error('mesh.moveVertex produced no vertex delta');
  },
};
