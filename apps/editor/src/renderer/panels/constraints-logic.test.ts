import { describe, expect, it } from 'vitest';
import type { ConstraintSelection } from '../editor-state/constraint-selection-store';
import {
  moveInOrder,
  parseSoftnessInput,
  reconcileConstraintSelection,
  solveOrderView,
  uniquePhysicsName,
  type OrderedConstraint,
} from './constraints-logic';

const ikA: OrderedConstraint = { kind: 'ik', id: 'ik_a', name: 'A', order: undefined };
const tcB: OrderedConstraint = { kind: 'transform', id: 'tc_b', name: 'B', order: undefined };

describe('constraints-logic: reconcileConstraintSelection', () => {
  const ik: ConstraintSelection = { kind: 'ik', id: 'ik_1' };
  const tc: ConstraintSelection = { kind: 'transform', id: 'tc_1' };
  const pc: ConstraintSelection = { kind: 'path', id: 'pc_1' };
  const ph: ConstraintSelection = { kind: 'physics', id: 'ph_1' };

  it('keeps a selection whose constraint still resolves', () => {
    expect(reconcileConstraintSelection(ik, ['ik_1', 'ik_2'], [], [], [])).toEqual(ik);
    expect(reconcileConstraintSelection(tc, [], ['tc_1'], [], [])).toEqual(tc);
    expect(reconcileConstraintSelection(pc, [], [], ['pc_1'], [])).toEqual(pc);
    expect(reconcileConstraintSelection(ph, [], [], [], ['ph_1'])).toEqual(ph);
  });

  it('clears a selection whose constraint was removed (undo the panel did not drive)', () => {
    expect(reconcileConstraintSelection(ik, ['ik_2'], [], [], [])).toBeNull();
    expect(reconcileConstraintSelection(tc, [], ['tc_2'], [], [])).toBeNull();
    expect(reconcileConstraintSelection(pc, [], [], ['pc_2'], [])).toBeNull();
    expect(reconcileConstraintSelection(ph, [], [], [], ['ph_2'])).toBeNull();
  });

  it('does not cross id spaces (an ik id present only in the transform list clears)', () => {
    expect(reconcileConstraintSelection(ik, [], ['ik_1'], [], [])).toBeNull();
    expect(reconcileConstraintSelection(ph, ['ph_1'], [], [], [])).toBeNull();
  });

  it('passes null through', () => {
    expect(reconcileConstraintSelection(null, ['ik_1'], ['tc_1'], ['pc_1'], ['ph_1'])).toBeNull();
  });
});

describe('constraints-logic: solveOrderView', () => {
  const pcC = { kind: 'path' as const, id: 'pc_c', name: 'pc_c', order: undefined };
  const phD = { kind: 'physics' as const, id: 'ph_d', name: 'ph_d', order: undefined };

  it('uses the default order (IK, transform, path, then physics) when no explicit order is set', () => {
    expect(solveOrderView([ikA], [tcB], [pcC], [phD]).map((c) => c.id)).toEqual([
      'ik_a',
      'tc_b',
      'pc_c',
      'ph_d',
    ]);
  });

  it('sorts by explicit order when any constraint carries one', () => {
    const ik = { ...ikA, order: 3 };
    const tc = { ...tcB, order: 2 };
    const pc = { ...pcC, order: 1 };
    const ph = { ...phD, order: 0 };
    expect(solveOrderView([ik], [tc], [pc], [ph]).map((c) => c.id)).toEqual([
      'ph_d',
      'pc_c',
      'tc_b',
      'ik_a',
    ]);
  });
});

describe('constraints-logic: uniquePhysicsName', () => {
  it('returns the base name when it is free', () => {
    expect(uniquePhysicsName([])).toBe('physics');
    expect(uniquePhysicsName(['tail', 'chain'])).toBe('physics');
  });

  it('suffixes against the shared constraint name namespace', () => {
    expect(uniquePhysicsName(['physics'])).toBe('physics 2');
    expect(uniquePhysicsName(['physics', 'physics 2'])).toBe('physics 3');
    expect(uniquePhysicsName(['physics', 'physics 3'])).toBe('physics 2');
  });
});

describe('constraints-logic: moveInOrder', () => {
  const ids = ['a', 'b', 'c'];

  it('moves an item up and down', () => {
    expect(moveInOrder(ids, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveInOrder(ids, 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('returns the same reference for an out-of-bounds move', () => {
    expect(moveInOrder(ids, 0, -1)).toBe(ids);
    expect(moveInOrder(ids, 2, 1)).toBe(ids);
  });
});

describe('constraints-logic: parseSoftnessInput', () => {
  it('parses a non-negative number', () => {
    expect(parseSoftnessInput('0')).toBe(0);
    expect(parseSoftnessInput('12.5')).toBe(12.5);
    expect(parseSoftnessInput('  8 ')).toBe(8);
  });

  it('rejects empty, non-numeric, and negative input', () => {
    expect(parseSoftnessInput('')).toBeNull();
    expect(parseSoftnessInput('   ')).toBeNull();
    expect(parseSoftnessInput('abc')).toBeNull();
    expect(parseSoftnessInput('-3')).toBeNull();
    expect(parseSoftnessInput('NaN')).toBeNull();
  });
});
