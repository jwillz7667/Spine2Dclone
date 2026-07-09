import { describe, expect, it } from 'vitest';
import { assertInvariants, commandRegistry, loadDocument } from '../src';
import { makeTestEnv, seeds } from './seeds';

// Deterministic linear congruential generator so a failure reproduces (no Math.random; the suite is
// reproducible). Returns a float in [0, 1).
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// RANDOM WALK property test (command-history Section 10.4, WP-C.7 TASK-C7.4): a bounded random
// sequence of execute/undo/redo across the whole registry must keep the model invariant after every
// step, with no unexpected error escaping. This is where stack/order/memento corruption would surface.
describe('random walk', () => {
  it('keeps the model invariant across a bounded execute/undo/redo sequence', () => {
    const rand = lcg(0xc0ffee);
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rig, env);

    for (let step = 0; step < 200; step += 1) {
      const roll = rand();
      if (roll < 0.6) {
        const spec = commandRegistry[Math.floor(rand() * commandRegistry.length)];
        const made = spec?.fixture(doc.model, doc.ids) ?? null;
        if (made) {
          try {
            doc.history.execute(made.command);
          } catch (error) {
            // A typed authoring rejection (a fixture built against a state a prior random step changed,
            // e.g. a duplicate name) is EXPECTED during the walk and is fail-before-mutate by contract, so
            // it leaves no history entry. The post-step assertInvariants below is the safety net that still
            // catches any partial-mutation corruption. Anything without a stable typed `code`, or a
            // DOCUMENT_INVARIANT, is a real bug and rethrows.
            if (!(error instanceof Error)) throw error;
            const code = (error as Error & { code?: unknown }).code;
            if (typeof code !== 'string' || code === 'DOCUMENT_INVARIANT') throw error;
          }
        }
      } else if (roll < 0.8) {
        doc.history.undo();
      } else {
        doc.history.redo();
      }
      // The invariant guard must hold after every step (throws DocumentInvariantError otherwise).
      expect(() => assertInvariants(doc.model)).not.toThrow();
    }
  });
});
