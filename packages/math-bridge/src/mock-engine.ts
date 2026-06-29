import type { MathEngine, SpinInput, SpinResult } from './types';
import { MOCK_SCENARIOS } from './scenarios';
import type { MockScenarioId } from './scenarios';

// MockMathEngine (phase-4 WP-4.2): a MathEngine that emits committed, deterministic SpinResults so the
// whole slot layer (including the tumble engineering) is built and tested before the real engine is
// wired. The scenario is a CONSTRUCTOR argument, NOT smuggled through SpinInput, so the SpinInput shape
// is identical to the real engine (phase-4 section 6: scenario lives in editor-state, never in the seed).
// The mock is inherently non-transacting (it touches no wallet/ledger). It carries no RNG and no clock,
// so spin(sameInput) is idempotent.

// A deep, JSON-equivalent clone so a caller cannot mutate the shared committed fixture (the SpinResult is
// JSON-serializable: strings, numbers, arrays). Returning a fresh object each spin is the WP-4.2 clone
// guarantee. JSON round-trip keeps math-bridge dependency-light and portable (no structuredClone reliance).
function cloneResult(result: SpinResult): SpinResult {
  // JSON.parse returns any; the input is a validated SpinResult and a JSON round-trip preserves its
  // shape exactly, so the cast back is sound (the documented justification for this assertion).
  // eslint-disable-next-line no-restricted-syntax -- validated-SpinResult JSON round-trip clone
  return JSON.parse(JSON.stringify(result)) as SpinResult;
}

export class MockMathEngine implements MathEngine {
  private readonly scenarioId: MockScenarioId;
  private inFlight = false;

  constructor(scenarioId: MockScenarioId) {
    this.scenarioId = scenarioId;
  }

  // The grid size the constructed scenario plays on (so a caller can validate against the right
  // dimensions without reaching into the scenario table).
  gridSize(): { readonly rows: number; readonly cols: number } {
    return MOCK_SCENARIOS[this.scenarioId].gridSize;
  }

  // Resolve the constructed scenario. `input` is accepted for interface parity (and so a host can log the
  // seed) but does not select the scenario; the same input therefore yields a deep-equal result every
  // call (idempotency). Returns a fresh clone so the committed fixture cannot be mutated by the caller.
  async spin(_input: SpinInput): Promise<SpinResult> {
    // Dev-mode single-in-flight guard (INV bounded concurrency): the transport must serialize spins. The
    // mock resolves synchronously, so this catches a re-entrant call within one spin's synchronous window.
    if (this.inFlight) {
      throw new Error(
        'MockMathEngine: a spin is already in flight; the transport must serialize spins.',
      );
    }
    this.inFlight = true;
    try {
      return cloneResult(MOCK_SCENARIOS[this.scenarioId].result);
    } finally {
      this.inFlight = false;
    }
  }
}
