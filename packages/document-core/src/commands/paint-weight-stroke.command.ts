import {
  decodeWeightedVertices,
  encodeWeightedVertices,
  type WeightedInfluence,
} from '@marionette/format';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, MeshBindingError } from '../command/errors';
import { meshGeometryOf, type MeshGeometry } from '../model/doc-state';
import type { BoneId, SlotId } from '../model/ids';
import { finalizeVertexWeights } from '../weights';
import { requireWeightedMesh } from './mesh-support';
import { solveSetupWorld, toBindLocal, vertexWorldPosition } from './setup-world';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// How a stroke changes the active bone's weight on a touched vertex. add raises it, subtract lowers it,
// smooth applies the editor-supplied signed move toward the neighbor average (the editor computes the
// neighbor target and passes the delta). Add and smooth use the delta as given; subtract negates it.
export type PaintMode = 'add' | 'subtract' | 'smooth';

// One brush dab: a per-vertex weight adjustment magnitude for the active bone at one vertex. The editor
// computes which vertices a brush touches and their per-vertex delta (radius / strength / falloff is
// editor-side); this command receives the resulting dabs and applies + re-normalizes them.
export interface WeightDab {
  readonly vertexIndex: number;
  readonly deltaWeight: number;
}

// Apply a weight-paint stroke to one bone across a set of vertices (command-history catalog
// PaintWeightStroke, `mesh.paintWeight`; TASK-2.4.2 to TASK-2.4.6). For each dab the active bone's weight
// on that vertex is adjusted, the non-active influences are scaled to fill the remaining mass (their
// relative proportions preserved), and the vertex is capped to 4 influences and normalized (TASK-2.4.3,
// TASK-2.4.4: after any stroke every touched vertex sums to 1 and has at most 4 influences). The active
// bone may not already be an influence of a vertex; an `add`/`smooth` dab introduces it (its bind-local
// (vx, vy) derived from the vertex setup world position). A stroke is an INTERACTION GROUP: consecutive
// PaintWeightStroke commands on the same (slot, attachment, active bone, mode) coalesce into ONE undo step
// keeping the pre-stroke weighted geometry as the single before memento, regardless of elapsed time (the
// group is bounded by pointer-down / pointer-up, not the 250ms window). The mesh must already be weighted
// (else notWeighted); a dab outside the mesh is rejected (vertexOutOfRange).
export class PaintWeightStrokeCommand implements Command {
  readonly kind = 'mesh.paintWeight';
  readonly label = 'Paint Weights';
  private before: MeshGeometry | undefined;
  private after: MeshGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly activeBoneId: BoneId,
    private readonly dabs: readonly WeightDab[],
    private readonly mode: PaintMode,
  ) {}

  do(ctx: CommandContext): void {
    const mesh = requireWeightedMesh(ctx, this.kind, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const setup = solveSetupWorld(ctx.mutate);
      const activeIndex = setup.indexById.get(this.activeBoneId);
      if (activeIndex === undefined) {
        throw new MeshBindingError(this.slotId, this.name, 'boneMissing', this.activeBoneId);
      }
      const activeWorld = setup.worldByIndex[activeIndex]!;
      const working = decodeWeightedVertices({ vertices: [...mesh.vertices] }).map((inf) => [
        ...inf,
      ]);
      for (const dab of this.dabs) {
        if (dab.vertexIndex < 0 || dab.vertexIndex >= working.length) {
          throw new MeshBindingError(
            this.slotId,
            this.name,
            'vertexOutOfRange',
            String(dab.vertexIndex),
          );
        }
        const current = working[dab.vertexIndex]!;
        const [wx, wy] = vertexWorldPosition(current, setup.worldByIndex);
        const [avx, avy] = toBindLocal(activeWorld, wx, wy);
        const signed = this.mode === 'subtract' ? -dab.deltaWeight : dab.deltaWeight;
        working[dab.vertexIndex] = applyDab(current, activeIndex, avx, avy, signed);
      }
      const { vertices, bones } = encodeWeightedVertices(working);
      this.before = meshGeometryOf(mesh);
      this.after = { ...this.before, vertices, bones };
    }
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMeshGeometry(this.slotId, this.name, this.before);
  }

  // Same slot + attachment + active bone + mode only. The merged command concatenates the dab lists, keeps
  // the ORIGINAL before (stroke start) and the latest after, so one undo of a coalesced stroke returns to
  // the pre-stroke weights (command-history Section 5.3, TASK-2.4.6). A different active bone or mode does
  // not merge (it becomes a CompositeCommand within the same interaction group, still one undo step).
  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof PaintWeightStrokeCommand &&
      prev.slotId === this.slotId &&
      prev.name === this.name &&
      prev.activeBoneId === this.activeBoneId &&
      prev.mode === this.mode
    ) {
      const merged = new PaintWeightStrokeCommand(
        this.slotId,
        this.name,
        this.activeBoneId,
        [...prev.dabs, ...this.dabs],
        this.mode,
      );
      merged.before = prev.before;
      merged.after = this.after;
      return merged;
    }
    return null;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Apply one dab to a vertex: set the active bone's weight, scale the non-active influences to fill the
// rest (preserving their proportions), then cap to 4 and normalize. A vertex can never be emptied: if the
// dab would zero out its only (active) influence, the active bone is floored at full weight.
function applyDab(
  influences: readonly WeightedInfluence[],
  activeIndex: number,
  activeVx: number,
  activeVy: number,
  signedDelta: number,
): WeightedInfluence[] {
  const existing = influences.find((inf) => inf.boneIndex === activeIndex);
  const newActive = clamp01((existing?.weight ?? 0) + signedDelta);
  const others = influences.filter((inf) => inf.boneIndex !== activeIndex);
  if (newActive <= 0) {
    if (others.length === 0) {
      return [{ boneIndex: activeIndex, vx: activeVx, vy: activeVy, weight: 1 }];
    }
    return finalizeVertexWeights(others);
  }
  const otherSum = others.reduce((sum, inf) => sum + inf.weight, 0);
  const target = 1 - newActive;
  const scaled =
    otherSum > 0 ? others.map((inf) => ({ ...inf, weight: (inf.weight * target) / otherSum })) : [];
  const activeInfluence: WeightedInfluence = existing
    ? { ...existing, weight: newActive }
    : { boneIndex: activeIndex, vx: activeVx, vy: activeVy, weight: newActive };
  return finalizeVertexWeights([...scaled, activeInfluence]);
}

export const paintWeightStrokeSpec: CommandSpec = {
  kind: 'mesh.paintWeight',
  // 'weighted' carries a mesh bound to [root, arm]; adding weight to the first bound bone on vertex 0
  // produces a real delta.
  representativeSeedId: 'weighted',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model
        .attachments(slot.id)
        .find((a) => a.kind === 'mesh' && a.bones !== undefined);
      if (!att || att.kind !== 'mesh' || att.bones === undefined || att.bones.length === 0)
        continue;
      const bones = model.bones();
      const activeBone = bones[att.bones[0]!];
      if (activeBone === undefined) continue;
      return {
        command: new PaintWeightStrokeCommand(
          slot.id,
          att.name,
          activeBone.id,
          [{ vertexIndex: 0, deltaWeight: 0.3 }],
          'add',
        ),
      };
    }
    return null;
  },
  assertApplied: (before, after) => {
    let painted = false;
    for (const b of before.attachments) {
      if (b.kind !== 'mesh' || b.bones === undefined) continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (
        a &&
        a.kind === 'mesh' &&
        a.bones !== undefined &&
        a.vertices.join(',') !== b.vertices.join(',')
      ) {
        painted = true;
      }
    }
    if (!painted) throw new Error('mesh.paintWeight produced no weight change');
  },
};
