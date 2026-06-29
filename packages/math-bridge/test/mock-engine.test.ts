import { describe, expect, it } from 'vitest';
import { MockMathEngine } from '../src/mock-engine';
import { MOCK_SCENARIOS, MOCK_SCENARIO_IDS } from '../src/scenarios';
import { validateSpinResult } from '../src/validate';
import type { SpinInput } from '../src/types';

// WP-4.2 acceptance (phase-4 section 9.2): the five canned scenarios each validate against the WP-4.1
// schema (including the forward-consistency + cumulative checks), spin is idempotent and clones the
// fixture, the SpinInput shape is identical to the real engine (no scenario field), and the five
// collectively cover a base win, a free-spin feature, a cascade, an escalation crossing, and a retrigger.

const INPUT: SpinInput = {
  bet: 100,
  seed: { serverSeedHash: 'abc', clientSeed: 'def', nonce: 1 },
};

describe('MockMathEngine (WP-4.2)', () => {
  it('every scenario validates against the WP-4.1 schema at its grid size', () => {
    for (const id of MOCK_SCENARIO_IDS) {
      const { result, gridSize } = MOCK_SCENARIOS[id];
      const out = validateSpinResult(result, gridSize);
      expect(out.ok, `${id} should validate: ${out.ok ? '' : JSON.stringify(out.error)}`).toBe(
        true,
      );
    }
  });

  it('spin(sameInput) twice yields deep-equal results (idempotency, no RNG/clock)', async () => {
    const engine = new MockMathEngine('base-win');
    const a = await engine.spin(INPUT);
    const b = await engine.spin(INPUT);
    expect(a).toEqual(b);
  });

  it('returns a fresh clone: mutating the result does not change the next spin', async () => {
    const engine = new MockMathEngine('base-win');
    const a = await engine.spin(INPUT);
    a.totalWin = 999999;
    a.grid[0]![0] = a.grid[0]![1]!;
    const b = await engine.spin(INPUT);
    expect(b.totalWin).toBe(200);
    expect(b).not.toEqual(a);
  });

  it('the scenario is a constructor argument, not part of SpinInput (identical input shape)', async () => {
    // The same INPUT drives two different engines to two different scenarios: the scenario is NOT in the
    // input, so the real engine and the mock share an identical SpinInput shape.
    const base = await new MockMathEngine('base-win').spin(INPUT);
    const mega = await new MockMathEngine('mega-escalation').spin(INPUT);
    expect(base.spinId).toBe('mock-base-win');
    expect(mega.spinId).toBe('mock-mega-escalation');
  });

  it('the five scenarios collectively exercise win / freespin / cascade / escalation / retrigger', () => {
    const base = MOCK_SCENARIOS['base-win'].result;
    expect(base.totalWin).toBeGreaterThan(0);
    expect(base.cascades).toBeUndefined();

    const free = MOCK_SCENARIOS['freespin-trigger'].result;
    expect(free.features.some((f) => f.type === 'freeSpinsAwarded')).toBe(true);

    const tumble = MOCK_SCENARIOS['tumble-cascade'].result;
    expect((tumble.cascades ?? []).length).toBeGreaterThanOrEqual(3);
    // initialGrid differs from grid for a genuine cascade.
    expect(tumble.initialGrid).not.toEqual(tumble.grid);

    const mega = MOCK_SCENARIOS['mega-escalation'].result;
    expect(mega.totalWin / mega.bet).toBeGreaterThanOrEqual(50); // crosses a mega-class multiple

    const retrig = MOCK_SCENARIOS['retrigger'].result;
    expect(retrig.features.some((f) => f.type === 'retrigger')).toBe(true);
  });

  it('exposes the scenario grid size for validation', () => {
    expect(new MockMathEngine('tumble-cascade').gridSize()).toEqual({ rows: 5, cols: 6 });
  });
});
