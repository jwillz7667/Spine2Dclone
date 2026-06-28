import {
  encodeWeightedVertices,
  MAX_BONE_INFLUENCES,
  type WeightedInfluence,
} from '@marionette/format';
import { transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  MeshBindingError,
} from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { BoneId, SlotId } from '../model/ids';
import { distanceToSegment, finalizeVertexWeights } from '../weights';
import { requireUnweightedMesh } from './mesh-support';
import { boneSegment, solveSetupWorld, toBindLocal, type SetupWorldSolve } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Initial weighting for a fresh bind (TASK-2.3.1): rigid (weight 1 to the single nearest bone) or an
// equal split across the bound bones. Real weights are painted later (WP-2.4).
export type BindWeightMode = 'rigidNearest' | 'equalSplit';

// Convert an UNWEIGHTED mesh to the weighted encoding by binding it to a set of bones (command-history
// catalog BindMeshToBones, `mesh.bindToBones`; TASK-2.3.1 to TASK-2.3.4). For each logical vertex the
// command computes its setup WORLD position (slotBoneWorld * the flat (x, y)), expresses it in each
// target bone's bind-local frame (inverse(boneSetupWorld) * vertexWorld), assigns initial weights by the
// mode, caps to MAX_BONE_INFLUENCES (the 4 NEAREST per vertex), normalizes, and encodes via the format
// codec. Because every influence maps back to the same setup world point and the weights sum to 1,
// skinning at setup pose reproduces the original unweighted geometry (TASK-2.3.2). Binding to a bone not
// in the document is rejected (boneMissing); an empty bone set is rejected (noBones); an already-weighted
// mesh is rejected (alreadyWeighted). The prior unweighted geometry is the before memento. NOT coalescing.
export class BindMeshToBonesCommand implements Command {
  readonly kind = 'mesh.bindToBones';
  readonly label = 'Bind Mesh To Bones';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly boneIds: readonly BoneId[],
    private readonly weightMode: BindWeightMode,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireUnweightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      if (this.boneIds.length === 0) {
        throw new MeshBindingError(this.slotId, this.name, 'noBones');
      }
      const slot = ctx.mutate.getSlot(this.slotId);
      if (slot === undefined) throw new CommandTargetMissingError(this.kind, this.slotId);
      const setup = solveSetupWorld(ctx.mutate);
      for (const boneId of this.boneIds) {
        if (!setup.indexById.has(boneId)) {
          throw new MeshBindingError(this.slotId, this.name, 'boneMissing', boneId);
        }
      }
      const slotWorld = setup.worldById.get(slot.bone);
      if (slotWorld === undefined) throw new CommandTargetMissingError(this.kind, slot.bone);

      const bindings = bindVertices(mesh.vertices, slotWorld, this.boneIds, this.weightMode, setup);
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

// Build the weighted bindings for an unweighted flat [x, y, ...] vertex stream. Each vertex is bound to
// the candidate bones sorted by distance-to-segment (nearest first); rigidNearest keeps only the nearest
// (weight 1), equalSplit keeps the 4 nearest with equal weight. finalizeVertexWeights then caps to 4 and
// normalizes (TASK-2.3.4 keeps the 4 nearest, never silently exceeds the cap).
function bindVertices(
  flat: readonly number[],
  slotWorld: Mat2x3,
  boneIds: readonly BoneId[],
  mode: BindWeightMode,
  setup: SetupWorldSolve,
): WeightedInfluence[][] {
  const vertexCount = Math.floor(flat.length / 2);
  const bindings: WeightedInfluence[][] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const [wx, wy] = transformPoint(slotWorld, flat[i * 2]!, flat[i * 2 + 1]!);
    const candidates = boneIds
      .map((boneId) => {
        const boneIndex = setup.indexById.get(boneId)!;
        const world = setup.worldByIndex[boneIndex]!;
        const [vx, vy] = toBindLocal(world, wx, wy);
        const [ax, ay, bx, by] = boneSegment(world, setup.bones[boneIndex]!.length);
        return { boneIndex, vx, vy, dist: distanceToSegment(wx, wy, ax, ay, bx, by) };
      })
      .sort((a, b) => a.dist - b.dist || a.boneIndex - b.boneIndex);

    let influences: WeightedInfluence[];
    if (mode === 'rigidNearest') {
      const nearest = candidates[0]!;
      influences = [{ boneIndex: nearest.boneIndex, vx: nearest.vx, vy: nearest.vy, weight: 1 }];
    } else {
      const kept = candidates.slice(0, MAX_BONE_INFLUENCES);
      const weight = 1 / kept.length;
      influences = kept.map((c) => ({ boneIndex: c.boneIndex, vx: c.vx, vy: c.vy, weight }));
    }
    bindings.push(finalizeVertexWeights(influences));
  }
  return bindings;
}

export const bindMeshToBonesSpec: CommandSpec = {
  kind: 'mesh.bindToBones',
  // 'meshed' carries an UNWEIGHTED mesh ('panel' on 'mesh_slot') and two bones to bind it to.
  representativeSeedId: 'meshed',
  fixture: (model) => {
    const boneIds = model.bones().map((bone) => bone.id);
    if (boneIds.length === 0) return null;
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones === undefined);
      if (att && att.kind === 'mesh') {
        return { command: new BindMeshToBonesCommand(slot.id, att.name, boneIds, 'equalSplit') };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let bound = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones !== undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh' && a.bones !== undefined) bound = true;
    }
    if (!bound) throw new Error('mesh.bindToBones did not convert an unweighted mesh to weighted');
  },
};
