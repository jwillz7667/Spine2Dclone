import {
  decodeWeightedVertices,
  encodeWeightedVertices,
  MAX_BONE_INFLUENCES,
  type WeightedInfluence,
} from '@marionette/format';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { distanceToSegment, finalizeVertexWeights } from '../weights';
import { requireWeightedMesh } from './mesh-support';
import { boneSegment, solveSetupWorld, toBindLocal, vertexWorldPosition } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Avoids a divide-by-zero when a vertex sits exactly on a bone segment (distance 0). Small enough that an
// on-segment vertex still dominates the inverse-distance weighting, large enough to stay finite.
const SEGMENT_DISTANCE_EPSILON = 1e-6;

// Re-seed a weighted mesh's weights by inverse distance to each BOUND bone's line SEGMENT (command-history
// catalog AutoWeightFromProximity, `mesh.autoWeight`; TASK-2.4.1). For each vertex the setup world
// position is recovered from its current influences, each bound bone gets weight = 1 / (distance + eps)
// to its segment, the 4 nearest are kept, and the result is normalized. This is the §10 mitigation: it
// produces a plausible deformation in one click so manual paint is touch-up, not from-scratch. The mesh
// must already be weighted (else notWeighted). The prior weighted geometry is the before memento. NOT coalescing.
export class AutoWeightFromProximityCommand implements Command {
  readonly kind = 'mesh.autoWeight';
  readonly label = 'Auto-Weight From Proximity';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const manifest = mesh.bones ?? [];
      const setup = solveSetupWorld(ctx.mutate);
      const decoded = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      const bindings = decoded.map((influences) => {
        const [wx, wy] = vertexWorldPosition(influences, setup.worldByIndex);
        const seeded: WeightedInfluence[] = manifest
          .map((boneIndex) => {
            const world = setup.worldByIndex[boneIndex]!;
            const [vx, vy] = toBindLocal(world, wx, wy);
            const [ax, ay, bx, by] = boneSegment(world, setup.bones[boneIndex]!.length);
            const dist = distanceToSegment(wx, wy, ax, ay, bx, by);
            return { boneIndex, vx, vy, dist, weight: 1 / (dist + SEGMENT_DISTANCE_EPSILON) };
          })
          .sort((a, b) => a.dist - b.dist || a.boneIndex - b.boneIndex)
          .slice(0, MAX_BONE_INFLUENCES)
          .map((c) => ({ boneIndex: c.boneIndex, vx: c.vx, vy: c.vy, weight: c.weight }));
        return finalizeVertexWeights(seeded);
      });
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

export const autoWeightFromProximitySpec: CommandSpec = {
  kind: 'mesh.autoWeight',
  // 'weighted' carries a mesh bound to [root, arm]; proximity weighting differs from the seed's flat
  // split, so this produces a real delta.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (att && att.kind === 'mesh') {
        return { command: new AutoWeightFromProximityCommand(slot.id, att.name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let reweighted = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (
        a &&
        a.kind === 'mesh' &&
        a.bones !== undefined &&
        a.vertices.join(',') !== b.vertices.join(',')
      ) {
        reweighted = true;
      }
    }
    if (!reweighted) throw new Error('mesh.autoWeight produced no weight change');
  },
};
