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
