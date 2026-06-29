import { describe, expect, it } from 'vitest';
import type { FeatureFlowTransition } from '@marionette/format/slot-types';
import { CreateFeatureFlowStateCommand } from '../src/commands/create-feature-flow-state.command';
import { AddFeatureFlowTransitionCommand } from '../src/commands/add-feature-flow-transition.command';
import { DeleteFeatureFlowStateCommand } from '../src/commands/delete-feature-flow-state.command';
import { RenameFeatureFlowStateCommand } from '../src/commands/rename-feature-flow-state.command';
import { RemoveFeatureFlowTransitionCommand } from '../src/commands/remove-feature-flow-transition.command';
import {
  assertInvariants,
  createDocument,
  newDocState,
  SlotEditError,
  type Document,
} from '../src';
import { makeTestEnv } from './seeds';

// WP-4.9 feature + free-spin flow graph commands (command-history catalog slot.flow.*). Each command's
// do/undo round-trip is bit-exact (the generic harness also covers it via the representative composites);
// these targeted tests pin the duplicate/missing/protected rejections, the delete cascade (node + incident
// transitions, restored on undo), and the rename rewrite of referencing transitions.

function newSceneDoc(): Document {
  return createDocument(newDocState('scene'), makeTestEnv().env);
}

const awarded: FeatureFlowTransition = {
  from: 'base',
  on: { type: 'freeSpinsAwarded' },
  to: 'freeSpins',
};

describe('CreateFeatureFlowState (slot.flow.state.create)', () => {
  it('default document carries one "base" node entered at "base"', () => {
    const doc = newSceneDoc();
    const flow = doc.model.slotScene().featureFlows;
    expect(Object.keys(flow.states)).toEqual(['base']);
    expect(flow.entry).toBe('base');
    expect(flow.transitions).toEqual([]);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('adds a named node; undo removes it (deep-equal prior state)', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    doc.history.execute(new CreateFeatureFlowStateCommand('freeSpins'));
    expect(Object.keys(doc.model.slotScene().featureFlows.states).sort()).toEqual([
      'base',
      'freeSpins',
    ]);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('captures an optional cinematic on the node', () => {
    const doc = newSceneDoc();
    doc.history.execute(
      new CreateFeatureFlowStateCommand('freeSpinIntro', {
        cinematic: { vfxPreset: 'introBurst', animation: 'intro' },
      }),
    );
    expect(doc.model.slotScene().featureFlows.states['freeSpinIntro']?.cinematic).toEqual({
      vfxPreset: 'introBurst',
      animation: 'intro',
    });
  });

  it('rejects a duplicate state with no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new CreateFeatureFlowStateCommand('base'))).toThrow(
      SlotEditError,
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('rejects an empty name', () => {
    const doc = newSceneDoc();
    expect(() => doc.history.execute(new CreateFeatureFlowStateCommand(''))).toThrow(SlotEditError);
  });
});

describe('AddFeatureFlowTransition (slot.flow.transition.add)', () => {
  it('appends a transition; undo removes it', () => {
    const doc = newSceneDoc();
    doc.history.execute(new CreateFeatureFlowStateCommand('freeSpins'));
    const before = doc.model.snapshot();
    doc.history.execute(new AddFeatureFlowTransitionCommand(awarded));
    expect(doc.model.slotScene().featureFlows.transitions).toEqual([awarded]);
    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a malformed transition (empty match type) with no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() =>
      doc.history.execute(
        new AddFeatureFlowTransitionCommand({
          from: 'base',
          on: { type: '' },
          to: 'base',
        }),
      ),
    ).toThrow(SlotEditError);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('accepts a transition with a dataEquals predicate (field name + constant only)', () => {
    const doc = newSceneDoc();
    doc.history.execute(new CreateFeatureFlowStateCommand('bonus'));
    const tx: FeatureFlowTransition = {
      from: 'base',
      on: { type: 'featureLanded', dataEquals: { field: 'tier', equals: 'super' } },
      to: 'bonus',
    };
    doc.history.execute(new AddFeatureFlowTransitionCommand(tx));
    expect(doc.model.slotScene().featureFlows.transitions[0]).toEqual(tx);
  });
});

describe('DeleteFeatureFlowState (slot.flow.state.delete)', () => {
  it('removes the node AND its incident transitions; undo restores BOTH (deep-equal)', () => {
    const doc = newSceneDoc();
    doc.history.execute(new CreateFeatureFlowStateCommand('freeSpins'));
    doc.history.execute(new CreateFeatureFlowStateCommand('survivor'));
    // base->freeSpins (incident, will drop), freeSpins->survivor (incident, will drop),
    // base->survivor (NOT incident, survives).
    doc.history.execute(new AddFeatureFlowTransitionCommand(awarded));
    doc.history.execute(
      new AddFeatureFlowTransitionCommand({ from: 'freeSpins', on: { type: 'x' }, to: 'survivor' }),
    );
    doc.history.execute(
      new AddFeatureFlowTransitionCommand({ from: 'base', on: { type: 'y' }, to: 'survivor' }),
    );
    const before = doc.model.snapshot();

    doc.history.execute(new DeleteFeatureFlowStateCommand('freeSpins'));
    const flow = doc.model.slotScene().featureFlows;
    expect(Object.keys(flow.states).sort()).toEqual(['base', 'survivor']);
    // Only the base->survivor transition survives (both freeSpins-incident edges dropped).
    expect(flow.transitions).toEqual([{ from: 'base', on: { type: 'y' }, to: 'survivor' }]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('rejects deleting the sole "base" node with no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new DeleteFeatureFlowStateCommand('base'))).toThrow(
      SlotEditError,
    );
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });

  it('rejects deleting a missing state', () => {
    const doc = newSceneDoc();
    expect(() => doc.history.execute(new DeleteFeatureFlowStateCommand('ghost'))).toThrow(
      SlotEditError,
    );
  });
});

describe('RenameFeatureFlowState (slot.flow.state.rename)', () => {
  it('renames the node key and REWRITES referencing transitions; undo restores', () => {
    const doc = newSceneDoc();
    doc.history.execute(new CreateFeatureFlowStateCommand('freeSpins'));
    doc.history.execute(new AddFeatureFlowTransitionCommand(awarded)); // base->freeSpins
    doc.history.execute(
      new AddFeatureFlowTransitionCommand({ from: 'freeSpins', on: { type: 'z' }, to: 'base' }),
    );
    const before = doc.model.snapshot();

    doc.history.execute(new RenameFeatureFlowStateCommand('freeSpins', 'bonusRound'));
    const flow = doc.model.slotScene().featureFlows;
    expect(Object.keys(flow.states).sort()).toEqual(['base', 'bonusRound']);
    // Both referencing transitions point at the new name.
    expect(flow.transitions).toEqual([
      { from: 'base', on: { type: 'freeSpinsAwarded' }, to: 'bonusRound' },
      { from: 'bonusRound', on: { type: 'z' }, to: 'base' },
    ]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects renaming to an existing name', () => {
    const doc = newSceneDoc();
    doc.history.execute(new CreateFeatureFlowStateCommand('a'));
    doc.history.execute(new CreateFeatureFlowStateCommand('b'));
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new RenameFeatureFlowStateCommand('a', 'b'))).toThrow(
      SlotEditError,
    );
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects renaming a missing state and renaming the protected "base" node', () => {
    const doc = newSceneDoc();
    expect(() => doc.history.execute(new RenameFeatureFlowStateCommand('ghost', 'x'))).toThrow(
      SlotEditError,
    );
    expect(() => doc.history.execute(new RenameFeatureFlowStateCommand('base', 'root'))).toThrow(
      SlotEditError,
    );
  });
});

describe('RemoveFeatureFlowTransition (slot.flow.transition.remove)', () => {
  it('removes one transition by index; undo restores it at its position', () => {
    const doc = newSceneDoc();
    doc.history.execute(
      new AddFeatureFlowTransitionCommand({ from: 'base', on: { type: 'a' }, to: 'base' }),
    );
    doc.history.execute(
      new AddFeatureFlowTransitionCommand({ from: 'base', on: { type: 'b' }, to: 'base' }),
    );
    const before = doc.model.snapshot();

    doc.history.execute(new RemoveFeatureFlowTransitionCommand(0));
    expect(doc.model.slotScene().featureFlows.transitions).toEqual([
      { from: 'base', on: { type: 'b' }, to: 'base' },
    ]);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an out-of-range index with no mutation', () => {
    const doc = newSceneDoc();
    const before = doc.model.snapshot();
    expect(() => doc.history.execute(new RemoveFeatureFlowTransitionCommand(0))).toThrow(
      SlotEditError,
    );
    expect(doc.model.snapshot()).toEqual(before);
  });
});
