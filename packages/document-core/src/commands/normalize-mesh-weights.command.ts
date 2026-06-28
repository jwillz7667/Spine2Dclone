import { decodeWeightedVertices, encodeWeightedVertices } from '@marionette/format';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { finalizeVertexWeights } from '../weights';
import { requireWeightedMesh } from './mesh-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Re-normalize every vertex of a weighted mesh to sum 1 and cap to MAX_BONE_INFLUENCES (command-history
// catalog NormalizeMeshWeights, `mesh.normalizeWeights`; TASK-2.4.3 / TASK-2.4.4). A backstop the artist
// can run explicitly; idempotent on an already-normalized, already-capped mesh. The mesh must already be
// weighted (else notWeighted). The prior weighted geometry is the before memento. NOT coalescing.
export class NormalizeMeshWeightsCommand implements Command {
  readonly kind = 'mesh.normalizeWeights';
  readonly label = 'Normalize Mesh Weights';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const decoded = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      const bindings = decoded.map((influences) => finalizeVertexWeights(influences));
      const { vertices, bones } = encodeWeightedVertices(bindings);
      this.before = meshGeometryOf(mesh);
      this.after = { ...this.before, vertices, bones };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const normalizeMeshWeightsSpec: CommandSpec = {
  kind: 'mesh.normalizeWeights',
  // 'weighted' carries per-vertex weights that sum to 0.99995 (within WEIGHT_SUM_EPSILON but not exactly
  // 1), so normalizing them to sum exactly 1 produces a real delta.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (att && att.kind === 'mesh') {
        return { command: new NormalizeMeshWeightsCommand(slot.id, att.name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let normalized = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (
        a &&
        a.kind === 'mesh' &&
        a.bones !== undefined &&
        a.vertices.join(',') !== b.vertices.join(',')
      ) {
        normalized = true;
      }
    }
    if (!normalized) throw new Error('mesh.normalizeWeights produced no change');
  },
};
