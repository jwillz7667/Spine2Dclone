import type { Command, CommandContext } from '../command/command';
import {
  CommandNotAppliedError,
  CommandTargetMissingError,
  ConstraintError,
} from '../command/errors';
import type { IkConstraintId, TransformConstraintId } from '../model/ids';
import type { DocumentReadModel } from '../model/read-model';
import type { CommandSpec } from './spec';

// One constraint's captured prior order across both arrays (for the undo memento). A discriminated union on
// `kind` keeps each id its proper brand (IK and transform share one name namespace but distinct id brands,
// ADR-0004), so applyOrders dispatches to the right typed mutator method with no `as` cast.
type ConstraintOrderMemento =
  | { readonly kind: 'ik'; readonly id: IkConstraintId; readonly order: number | undefined }
  | {
      readonly kind: 'transform';
      readonly id: TransformConstraintId;
      readonly order: number | undefined;
    };

// Enumerate every constraint (all IK in solve order, then all transform), each with its current explicit
// `order` field, as the before-memento AND the identity of the current constraint set the reorder covers.
function captureOrders(model: DocumentReadModel): ConstraintOrderMemento[] {
  const out: ConstraintOrderMemento[] = [];
  for (const c of model.ikConstraints()) out.push({ kind: 'ik', id: c.id, order: c.order });
  for (const c of model.transformConstraints()) {
    out.push({ kind: 'transform', id: c.id, order: c.order });
  }
  return out;
}

// Edit the OPTIONAL explicit cross-array constraint solve order (ADR-0009 section 1.3), `constraints.reorder`
// (PP-D10). The order is a single permutation over the COMBINED set of IK then transform constraints (they
// share one order space). Two modes:
//   - a permutation: `desiredOrder` is the constraint ids in the desired solve order; it MUST be a dense,
//     unique cover of the current constraint set (every id once, no unknowns, exact length), else a typed
//     ConstraintError('orderInvalid') BEFORE any mutation. Each id at position i gets `order = i`.
//   - clear (`desiredOrder === null`): DELETE `order` from every constraint, restoring the default order
//     (all IK in array order, then all transform, ADR-0003), the state a fresh/migrated document has.
// before/after are whole-set order mementos, so undo is bit-exact (a cleared constraint returns to exactly
// its prior order, present or absent). Does not coalesce (a reorder is a discrete authoring action).
export class ReorderConstraintsCommand implements Command {
  readonly kind = 'constraints.reorder';
  readonly label = 'Reorder Constraints';
  private before: readonly ConstraintOrderMemento[] | undefined;
  private after: readonly ConstraintOrderMemento[] = [];

  // `desiredOrder` null clears; otherwise the combined constraint ids in the desired solve order.
  constructor(private readonly desiredOrder: readonly string[] | null) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const current = captureOrders(ctx.mutate);
      if (current.length === 0) throw new CommandTargetMissingError(this.kind, 'no constraints');
      this.before = current;
      this.after =
        this.desiredOrder === null ? clearOrders(current) : assignOrders(current, this.desiredOrder);
    }
    applyOrders(ctx, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    applyOrders(ctx, this.before);
  }
}

// Build the cleared assignment: every constraint loses its order (undefined), restoring the default order.
function clearOrders(current: readonly ConstraintOrderMemento[]): ConstraintOrderMemento[] {
  return current.map((c) => withOrder(c, undefined));
}

// Validate `desiredOrder` is a dense, unique permutation of the current constraint ids, then assign each id
// its position as the order value. Throws ConstraintError('orderInvalid') on a wrong length, an unknown id,
// a duplicate, or a missing id (the format's CONSTRAINT_ORDER_INVALID mirrored at the command boundary).
function assignOrders(
  current: readonly ConstraintOrderMemento[],
  desiredOrder: readonly string[],
): ConstraintOrderMemento[] {
  if (desiredOrder.length !== current.length) {
    throw new ConstraintError(
      'orderInvalid',
      `expected ${current.length} constraint ids, got ${desiredOrder.length}`,
    );
  }
  const known = new Set<string>(current.map((c) => c.id));
  const seen = new Set<string>();
  const orderById = new Map<string, number>();
  desiredOrder.forEach((id, index) => {
    if (seen.has(id)) throw new ConstraintError('orderInvalid', `duplicate id ${id}`);
    if (!known.has(id)) throw new ConstraintError('orderInvalid', `unknown constraint id ${id}`);
    seen.add(id);
    orderById.set(id, index);
  });
  // Length + uniqueness + all-known => a bijection, so every current id has an assigned index; read it back
  // in the stable current enumeration order for a deterministic after-memento.
  return current.map((c) => withOrder(c, orderById.get(c.id)!));
}

// Re-stamp one memento with a new order value, preserving its discriminated (kind, branded id) identity.
function withOrder(c: ConstraintOrderMemento, order: number | undefined): ConstraintOrderMemento {
  return c.kind === 'ik'
    ? { kind: 'ik', id: c.id, order }
    : { kind: 'transform', id: c.id, order };
}

// Write an order assignment to the model through the dedicated set-order mutator methods (which DELETE the
// key when order is undefined, so a cleared constraint is byte-identical to one that never had an order).
function applyOrders(ctx: CommandContext, orders: readonly ConstraintOrderMemento[]): void {
  for (const c of orders) {
    if (c.kind === 'ik') ctx.mutate.setIkConstraintOrder(c.id, c.order);
    else ctx.mutate.setTransformConstraintOrder(c.id, c.order);
  }
}

export const reorderConstraintsSpec: CommandSpec = {
  kind: 'constraints.reorder',
  // 'rigged' carries one IK ('limb-ik') and one transform ('follow') constraint, both without an explicit
  // order (the migrated default). Reversing them assigns a real, dense permutation that differs from default.
  representativeSeedId: 'rigged',
  fixture: (model) => {
    const ids = [
      ...model.ikConstraints().map((c) => c.id),
      ...model.transformConstraints().map((c) => c.id),
    ];
    if (ids.length < 2) return null;
    return { command: new ReorderConstraintsCommand([...ids].reverse()) };
  },
  assertApplied: (before, after) => {
    const beforeOrders = [
      ...before.ikConstraints.map((c) => c.order),
      ...before.transformConstraints.map((c) => c.order),
    ];
    const afterOrders = [
      ...after.ikConstraints.map((c) => c.order),
      ...after.transformConstraints.map((c) => c.order),
    ];
    if (afterOrders.every((o) => o === undefined)) {
      throw new Error('constraints.reorder assigned no order');
    }
    if (beforeOrders.join(',') === afterOrders.join(',')) {
      throw new Error('constraints.reorder produced no order delta');
    }
  },
};
