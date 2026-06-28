import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';
import { requireMesh } from './mesh-support';

// Set or replace a mesh's `edges` array (command-history catalog SetMeshEdges, `mesh.setEdges`;
// TASK-2.1.3). `edges` is the editor wireframe (vertex-index pairs) and does NOT change vertex count or
// order, so this is exempt from the topology lock and allowed on any mesh. An empty array removes the
// wireframe. The full prior MeshGeometry is the before memento (its `edges` field is what undo restores).
// NOT coalescing.
export class SetMeshEdgesCommand implements Command {
  readonly kind = 'mesh.setEdges';
  readonly label = 'Set Mesh Edges';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly edges: readonly number[],
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      this.before = meshGeometryOf(mesh);
      this.after = { ...this.before, edges: this.edges };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const setMeshEdgesSpec: CommandSpec = {
  kind: 'mesh.setEdges',
  // 'meshed' carries a mesh with no edges, so setting the hull edges is a real delta.
  representativeSeedId: 'meshed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (att && att.kind === 'mesh') {
        return { command: new SetMeshEdgesCommand(slot.id, att.name, [0, 1, 1, 2, 2, 3, 3, 0]) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let changed = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'mesh') continue;
      const beforeEdges = b.edges === undefined ? '' : b.edges.join(',');
      const afterEdges = a.edges === undefined ? '' : a.edges.join(',');
      if (beforeEdges !== afterEdges) changed = true;
    }
    if (!changed) throw new Error('mesh.setEdges produced no edges delta');
  },
};
