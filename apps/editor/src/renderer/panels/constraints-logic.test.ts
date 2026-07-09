import { describe, expect, it } from 'vitest';
import type { ConstraintSelection } from '../editor-state/constraint-selection-store';
import { parseSoftnessInput, reconcileConstraintSelection } from './constraints-logic';

describe('constraints-logic: reconcileConstraintSelection', () => {
  const ik: ConstraintSelection = { kind: 'ik', id: 'ik_1' };
  const tc: ConstraintSelection = { kind: 'transform', id: 'tc_1' };

  it('keeps a selection whose constraint still resolves', () => {
    expect(reconcileConstraintSelection(ik, ['ik_1', 'ik_2'], [])).toEqual(ik);
    expect(reconcileConstraintSelection(tc, [], ['tc_1'])).toEqual(tc);
  });

  it('clears a selection whose constraint was removed (undo the panel did not drive)', () => {
    expect(reconcileConstraintSelection(ik, ['ik_2'], [])).toBeNull();
    expect(reconcileConstraintSelection(tc, [], ['tc_2'])).toBeNull();
  });

  it('does not cross id spaces (an ik id present only in the transform list clears)', () => {
    expect(reconcileConstraintSelection(ik, [], ['ik_1'])).toBeNull();
  });

  it('passes null through', () => {
    expect(reconcileConstraintSelection(null, ['ik_1'], ['tc_1'])).toBeNull();
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
