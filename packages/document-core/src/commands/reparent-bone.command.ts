import {
  compose,
  decompose,
  identity,
  invert,
  multiply,
  type Mat2x3,
} from '@marionette/runtime-core';
import type { Command, CommandContext, HistoryPhase, SelectionHint } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  ReparentCycleError,
} from '../command/errors';
import type { BoneEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { CommandSpec } from './spec';

// The local transform a bone carries after a reparent (the decomposed world-stable result) or before it
// (the memento), plus the boneOrder snapshot so the parent-before-child invariant is restored exactly.
interface ReparentState {
  readonly parent: BoneId | null;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
  readonly order: readonly BoneId[];
}

// Reparent a bone while holding its WORLD transform fixed (command-history catalog ReparentBone,
// bone.reparent; LAW 2). The new local transform is local' = inverse(newParentWorld) * oldWorld,
// decomposed back into the format's authored fields by runtime-core (TASK-1.1.4). A reparent under the
// bone itself or one of its descendants is rejected with a typed ReparentCycleError BEFORE any
// mutation, so it leaves no document change and no history entry (TASK-1.1.3). boneOrder is re-derived
// by a stable topological pass so parents keep preceding children (TASK-1.1.5). Both the prior and the
// computed-after state are mementos, so undo and redo are bit-exact and redo never recomputes (a
// re-solve could drift). Never coalesces (a discrete structural edit).
export class ReparentBoneCommand implements Command {
  readonly kind = 'bone.reparent';
  readonly label = 'Reparent Bone';
  private before: ReparentState | undefined;
  private after: ReparentState | undefined;

  constructor(
    private readonly target: BoneId,
    private readonly newParent: BoneId | null,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined || this.after === undefined) {
      this.plan(ctx);
    }
    this.apply(ctx, this.after!);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    this.apply(ctx, this.before);
  }

  coalesceWith(): Command | null {
    return null;
  }

  selectionHint(_phase: HistoryPhase): SelectionHint {
    return { kind: 'select', entities: [{ type: 'bone', id: this.target }] };
  }

  // Compute the mementos once, on first do. Reads the current model; mutates nothing.
  private plan(ctx: CommandContext): void {
    const ordered = ctx.mutate.bones(); // in boneOrder
    const byId = new Map<BoneId, BoneEntity>(ordered.map((bone) => [bone.id, bone]));
    const bone = byId.get(this.target);
    if (!bone) throw new CommandTargetMissingError(this.kind, this.target);

    if (this.newParent !== null && wouldCycle(byId, this.target, this.newParent)) {
      throw new ReparentCycleError(this.target, this.newParent);
    }

    const oldWorld = worldMatrixOf(byId, this.target);
    const newParentWorld =
      this.newParent === null ? identity() : worldMatrixOf(byId, this.newParent);
    const local = decompose(multiply(invert(newParentWorld), oldWorld));

    const currentOrder = ordered.map((b) => b.id);
    this.before = {
      parent: bone.parent,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
      shearX: bone.shearX,
      shearY: bone.shearY,
      order: currentOrder,
    };
    // The new order uses the bone's NEW parent (override the target's edge) so the moved subtree lands
    // under the new parent in a stable topological pass.
    const parentOf = (b: BoneEntity): BoneId | null =>
      b.id === this.target ? this.newParent : b.parent;
    this.after = {
      parent: this.newParent,
      x: local.x,
      y: local.y,
      rotation: local.rotationDeg,
      scaleX: local.scaleX,
      scaleY: local.scaleY,
      shearX: local.shearXDeg,
      shearY: local.shearYDeg,
      order: stableTopoOrder(ordered, parentOf),
    };
  }

  private apply(ctx: CommandContext, state: ReparentState): void {
    ctx.mutate.patchBone(this.target, {
      parent: state.parent,
      x: state.x,
      y: state.y,
      rotation: state.rotation,
      scaleX: state.scaleX,
      scaleY: state.scaleY,
      shearX: state.shearX,
      shearY: state.shearY,
    });
    ctx.mutate.setBoneOrder(state.order);
  }
}

// True if newParent is the bone itself or one of its descendants: walk up from newParent and report a
// hit on target. A null chain end means newParent is not under target.
function wouldCycle(
  byId: ReadonlyMap<BoneId, BoneEntity>,
  target: BoneId,
  newParent: BoneId,
): boolean {
  let cursor: BoneId | null = newParent;
  while (cursor !== null) {
    if (cursor === target) return true;
    cursor = byId.get(cursor)?.parent ?? null;
  }
  return false;
}

// The world matrix of a bone: multiply local matrices from root down to the bone. boneOrder is not
// relied on here; the parent chain is walked directly, so this is correct mid-edit.
function worldMatrixOf(byId: ReadonlyMap<BoneId, BoneEntity>, id: BoneId): Mat2x3 {
  const chain: BoneEntity[] = [];
  let cursor: BoneEntity | undefined = byId.get(id);
  while (cursor) {
    chain.push(cursor);
    cursor = cursor.parent === null ? undefined : byId.get(cursor.parent);
  }
  let world: Mat2x3 = identity();
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const b = chain[i]!;
    world = multiply(world, compose(b.x, b.y, b.rotation, b.scaleX, b.scaleY, b.shearX, b.shearY));
  }
  return world;
}

// A stable topological order (parents before children): depth-first from the roots, visiting children
// in their current relative order. parentOf supplies each bone's parent, letting the caller override
// the reparented edge before the patch lands.
function stableTopoOrder(
  ordered: readonly BoneEntity[],
  parentOf: (bone: BoneEntity) => BoneId | null,
): BoneId[] {
  const childrenOf = new Map<BoneId | null, BoneId[]>();
  for (const bone of ordered) {
    const parent = parentOf(bone);
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(bone.id);
    else childrenOf.set(parent, [bone.id]);
  }
  const result: BoneId[] = [];
  const visit = (id: BoneId): void => {
    result.push(id);
    for (const childId of childrenOf.get(id) ?? []) visit(childId);
  };
  for (const rootId of childrenOf.get(null) ?? []) visit(rootId);
  return result;
}

export const reparentBoneSpec: CommandSpec = {
  kind: 'bone.reparent',
  // 'rig' has a parented child; reparenting it to a root exercises the recompute and the reorder.
  representativeSeedId: 'rig',
  fixture: (model) => {
    const child = model.bones().find((bone) => bone.parent !== null);
    if (!child) return null;
    return { command: new ReparentBoneCommand(child.id, null) };
  },
  assertApplied: (before, after) => {
    const child = before.bones.find((bone) => bone.parent !== null);
    if (!child) throw new Error('bone.reparent fixture seed had no parented bone');
    const a = after.bones.find((bone) => bone.id === child.id);
    if (!a) throw new Error('bone.reparent target missing after');
    if (a.parent !== null) throw new Error('bone.reparent did not move the bone to a root');
  },
};
