import {
  decodeWeightedVertices,
  encodeWeightedVertices,
  type WeightedInfluence,
} from '@marionette/format';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, MeshBindingError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { BoneId, SlotId } from '../model/ids';
import { distanceToSegment, finalizeVertexWeights } from '../weights';
import { requireWeightedMesh } from './mesh-support';
import { boneSegment, solveSetupWorld, toBindLocal, vertexWorldPosition } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Add one bone influence to an already-weighted mesh (command-history catalog AddBoneToMeshBinding,
// `mesh.addBoneBinding`; TASK-2.3.3). Each vertex's setup world position is recovered from its current
// influences, the new bone's bind-local (vx, vy) is computed there, and the new bone is SEEDED by inverse
// distance to its segment (weight = 1 / (1 + distance), a small near-the-bone contribution) and then the
// vertex is re-normalized and capped to 4. Seeding by distance (rather than 0) gives the new bone a
// meaningful, deterministic starting weight so the binding is immediately usable; manual paint refines it
// (WP-2.4). Rejected if the bone is not in the document (boneMissing), already bound (boneAlreadyBound),
// or the mesh is unweighted (notWeighted). The prior weighted geometry is the before memento. NOT coalescing.
export class AddBoneToMeshBindingCommand implements Command {
  readonly kind = 'mesh.addBoneBinding';
  readonly label = 'Add Bone To Mesh Binding';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly boneId: BoneId,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const setup = solveSetupWorld(ctx.mutate);
      const newIndex = setup.indexById.get(this.boneId);
      if (newIndex === undefined) {
        throw new MeshBindingError(this.slotId, this.name, 'boneMissing', this.boneId);
      }
      if ((mesh.bones ?? []).includes(newIndex)) {
        throw new MeshBindingError(this.slotId, this.name, 'boneAlreadyBound', this.boneId);
      }
      const newWorld = setup.worldByIndex[newIndex]!;
      const [ax, ay, bx, by] = boneSegment(newWorld, setup.bones[newIndex]!.length);

      const decoded = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      const bindings = decoded.map((influences) => {
        const [wx, wy] = vertexWorldPosition(influences, setup.worldByIndex);
        const [vx, vy] = toBindLocal(newWorld, wx, wy);
        const seed = 1 / (1 + distanceToSegment(wx, wy, ax, ay, bx, by));
        const raw: WeightedInfluence[] = [
          ...influences,
          { boneIndex: newIndex, vx, vy, weight: seed },
        ];
        return finalizeVertexWeights(raw);
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

export const addBoneToMeshBindingSpec: CommandSpec = {
  kind: 'mesh.addBoneBinding',
  // 'weighted' carries a mesh bound to [root, arm]; 'tip' is in the document but unbound, so adding it
  // produces a real delta.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (!att || att.kind !== 'mesh' || att.bones === undefined) continue;
      const bones = model.bones();
      const unbound = bones.find((_bone, index) => !att.bones!.includes(index));
      if (!unbound) continue;
      return { command: new AddBoneToMeshBindingCommand(slot.id, att.name, unbound.id) };
    }
    return null;
  },
  assertApplied: (before, after) => {
    let added = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh' && a.bones !== undefined && a.bones.length > b.bones.length) {
        added = true;
      }
    }
    if (!added) throw new Error('mesh.addBoneBinding did not add a bone to the mesh binding');
  },
};
