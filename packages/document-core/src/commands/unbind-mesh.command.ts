import { decodeWeightedVertices } from '@marionette/format';
import { invert, transformPoint } from '@marionette/runtime-core';
import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  MeshBindingError,
} from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { attachmentHasDeform, requireWeightedMesh } from './mesh-support';
import { solveSetupWorld, vertexWorldPosition } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Clear all weights and return a mesh to the unweighted flat encoding (command-history catalog
// UnbindMesh, `mesh.unbind`; TASK-2.3.5). Each vertex's setup world position is recovered from its
// current weighted influences and re-expressed in the slot bone's local frame
// (inverse(slotBoneWorld) * vertexWorld), so the unbound mesh renders identically at setup pose
// (solveSkinUnweighted reproduces the same world points). Required by the topology-lock policy
// (TASK-2.1.8): a weighted mesh must be unbound before its vertex count/order can change. Forbidden while
// the mesh still has deform keyframes (deformPresent; the guard is inert until WP-2.9 adds deform state).
// The prior WEIGHTED geometry is the before memento, so do/undo restores the weighted encoding deep-equal.
// NOT coalescing.
export class UnbindMeshCommand implements Command {
  readonly kind = 'mesh.unbind';
  readonly label = 'Unbind Mesh';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      if (attachmentHasDeform(this.slotId, this.name)) {
        throw new MeshBindingError(this.slotId, this.name, 'deformPresent');
      }
      const slot = ctx.mutate.getSlot(this.slotId);
      if (slot === undefined) throw new CommandTargetMissingError(this.kind, this.slotId);
      const setup = solveSetupWorld(ctx.mutate);
      const slotWorld = setup.worldById.get(slot.bone);
      if (slotWorld === undefined) throw new CommandTargetMissingError(this.kind, slot.bone);
      const slotInverse = invert(slotWorld);

      const decoded = decodeWeightedVertices({ vertices: [...mesh.vertices] });
      const flat: number[] = [];
      for (const influences of decoded) {
        const [wx, wy] = vertexWorldPosition(influences, setup.worldByIndex);
        const [x, y] = transformPoint(slotInverse, wx, wy);
        flat.push(x, y);
      }
      this.before = meshGeometryOf(mesh);
      // bones: undefined clears the manifest, returning the mesh to the unweighted flat encoding.
      this.after = { ...this.before, vertices: flat, bones: undefined };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }
}

export const unbindMeshSpec: CommandSpec = {
  kind: 'mesh.unbind',
  // 'weighted' carries a weighted mesh to unbind back to the flat encoding.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (att && att.kind === 'mesh') {
        return { command: new UnbindMeshCommand(slot.id, att.name) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let unbound = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (a && a.kind === 'mesh' && a.bones === undefined) unbound = true;
    }
    if (!unbound) throw new Error('mesh.unbind did not return the mesh to the unweighted encoding');
  },
};
