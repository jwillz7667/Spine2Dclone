import { describe, expect, it } from 'vitest';
import { effectsCommandRegistry, exportEffects, loadDocumentWithEffects } from '../src';
import { effectsSeedList, makeEffectsTestEnv, minimalSkeletonJson } from './effects-seeds';

// The mandatory do/undo round-trip harness for effect commands (the effects mirror of
// round-trip.harness.test.ts; command-history Section 10.3, LAW 2). Every registered effect command is run
// against every effect seed it applies to: do then undo must return a bit-exact prior effects snapshot
// (mementos, no epsilon), do then undo then redo must return the post-do snapshot, and the command must
// produce its representative delta. A command cannot merge without passing this.
describe.each(effectsCommandRegistry.map((spec) => [spec.kind, spec] as const))(
  'effects round-trip: %s',
  (_kind, spec) => {
    it.each(effectsSeedList.map((seed) => [seed.id, seed] as const))(
      'do/undo and do/undo/redo are exact on %s',
      (_seedId, seed) => {
        const { env } = makeEffectsTestEnv();
        const doc = loadDocumentWithEffects(minimalSkeletonJson, seed.json, env);
        const made = spec.fixture(doc.effects, doc.ids);
        if (!made) return; // not applicable to this seed; the discovery guard proves applicability elsewhere

        const pre = doc.effects.snapshot();
        doc.history.execute(made.command);
        const postDo = doc.effects.snapshot();
        spec.assertApplied(pre, postDo);
        // The library still exports validly after the edit (LAW 3: the format is the contract).
        expect(() => exportEffects(doc.effects)).not.toThrow();

        doc.history.undo();
        expect(doc.effects.snapshot()).toEqual(pre);

        doc.history.redo();
        expect(doc.effects.snapshot()).toEqual(postDo);
      },
    );
  },
);

// Applicability + non-trivial delta on each spec's designated representative seed (command-history Section
// 10.2): a spec inapplicable on its own seed, or that produces no delta there, is a CI failure. This closes
// the gap where fixture() returning null on every seed could pass with zero coverage.
describe('effects representative-seed applicability', () => {
  it.each(effectsCommandRegistry.map((spec) => [spec.kind, spec] as const))(
    '%s applies and produces a delta on its representativeSeedId',
    (_kind, spec) => {
      const seed = effectsSeedList.find((s) => s.id === spec.representativeSeedId);
      expect(seed, `effect seed "${spec.representativeSeedId}" must exist`).toBeDefined();
      if (!seed) return;

      const { env } = makeEffectsTestEnv();
      const doc = loadDocumentWithEffects(minimalSkeletonJson, seed.json, env);
      const made = spec.fixture(doc.effects, doc.ids);
      expect(
        made,
        `${spec.kind} must be applicable on ${spec.representativeSeedId}`,
      ).not.toBeNull();
      if (!made) return;

      const pre = doc.effects.snapshot();
      doc.history.execute(made.command);
      const postDo = doc.effects.snapshot();
      expect(() => spec.assertApplied(pre, postDo)).not.toThrow();
    },
  );
});
