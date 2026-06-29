// Public barrel for @marionette/math-bridge (phase-4 section 5.2/5.3, WP-4.1). The engine OUTCOME
// boundary: SpinResult and members (validated on receipt), the non-transacting MathEngine interface,
// SpinInput/SpinSeed, validateSpinResult, the SymbolVocabulary, and BOUNDARY_CONTRACT_VERSION.
//
// Boundary discipline (LAW 1, enforced by the WP-0.1 lint): math-bridge MAY import `format` (so cells are
// typed as SymbolId) but `format` never imports math-bridge; `runtime-core` may import these VALUE TYPES
// but NOT `math-bridge/real` (the engine client), which is a separate sub-path NOT re-exported here.
// A SpinResult is engine output: validated on receipt, NEVER serialized into a document, NEVER authored.

export type {
  SpinResult,
  SpinInput,
  SpinSeed,
  WinLine,
  FeatureEvent,
  CascadeStep,
  MathEngine,
} from './types';
export {
  spinResultSchema,
  spinInputSchema,
  spinSeedSchema,
  winLineSchema,
  featureEventSchema,
  cascadeStepSchema,
  cellSchema,
} from './schema';
export { validateSpinResult } from './validate';
export type { GridSize, MathBridgeError, MathBridgeErrorCode, Result } from './validate';
export { makeSymbolVocabulary, vocabularyHas } from './vocabulary';
export type { SymbolVocabulary } from './vocabulary';
export { BOUNDARY_CONTRACT_VERSION } from './version';

// The deterministic mock engine (WP-4.2): canned, committed SpinResults so the slot layer is built and
// tested before the real engine. The scenario is a constructor argument, never part of SpinInput.
export { MockMathEngine } from './mock-engine';
export { MOCK_SCENARIOS, MOCK_SCENARIO_IDS } from './scenarios';
export type { MockScenarioId, MockScenario } from './scenarios';
