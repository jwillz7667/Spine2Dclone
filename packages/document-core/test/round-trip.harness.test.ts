import { describe, expect, it } from 'vitest';
import { assertInvariants, commandRegistry, loadDocument } from '../src';
import { makeTestEnv, seedList } from './seeds';

// The mandatory do/undo round-trip harness (command-history Section 10.3). Every registered command is
// run against every seed it applies to: do then undo must return a bit-exact prior snapshot (mementos,
// no epsilon), do then undo then redo must return the post-do snapshot, the model stays invariant
// after every step, and the command must produce its representative delta. This is the automated form
// of LAW 2's mandatory round-trip; a command cannot merge without passing it.
describe.each(commandRegistry.map((spec) => [spec.kind, spec] as const))(
  'round-trip: %s',
  (_kind, spec) => {
    it.each(seedList.map((seed) => [seed.id, seed] as const))(
      'do/undo and do/undo/redo are exact on %s',
      (_seedId, seed) => {
        const { env } = makeTestEnv();
        const doc = loadDocument(seed.json, env);
        const made = spec.fixture(doc.model, doc.ids);
        if (!made) return; // not applicable to this seed; the discovery guard proves applicability elsewhere

        const pre = doc.model.snapshot();
        doc.history.execute(made.command);
        const postDo = doc.model.snapshot();
        assertInvariants(doc.model);
        spec.assertApplied(pre, postDo);

        doc.history.undo();
        expect(doc.model.snapshot()).toEqual(pre);
        assertInvariants(doc.model);

        doc.history.redo();
        expect(doc.model.snapshot()).toEqual(postDo);
        assertInvariants(doc.model);
      },
    );
  },
);

// Applicability + non-trivial delta on each spec's designated representative seed (command-history
// Section 10.2, TASK-C7.7): a spec inapplicable on its own seed, or that produces no delta there, is a
// CI failure. This closes the gap where fixture() returning null on every seed could pass with zero
// coverage.
describe('representative-seed applicability', () => {
  it.each(commandRegistry.map((spec) => [spec.kind, spec] as const))(
    '%s applies and produces a delta on its representativeSeedId',
    (_kind, spec) => {
      const seed = seedList.find((s) => s.id === spec.representativeSeedId);
      expect(seed, `seed "${spec.representativeSeedId}" must exist`).toBeDefined();
      if (!seed) return;

      const { env } = makeTestEnv();
      const doc = loadDocument(seed.json, env);
      const made = spec.fixture(doc.model, doc.ids);
      expect(
        made,
        `${spec.kind} must be applicable on ${spec.representativeSeedId}`,
      ).not.toBeNull();
      if (!made) return;

      const pre = doc.model.snapshot();
      doc.history.execute(made.command);
      const postDo = doc.model.snapshot();
      // assertApplied throws on a missing/wrong delta.
      expect(() => spec.assertApplied(pre, postDo)).not.toThrow();
    },
  );
});
