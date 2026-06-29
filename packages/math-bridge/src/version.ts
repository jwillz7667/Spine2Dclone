// The semver of the engine BOUNDARY contract (phase-4 section 5.5, WP-4.1 TASK-4.1.1). This is OUR
// contract as the mapping target the RealEngineAdapter and MockMathEngine both produce; it is NOT the
// certified engine's internal version. It is bumped on a boundary shape change. The `initialGrid` +
// `CascadeStep.cumulativeWin` refinements (phase-4 section 5.5) are introduced at this version. It is a
// runtime boundary constant, never serialized into any document (a `SpinResult` is engine output, never
// authored content, LAW 1).
export const BOUNDARY_CONTRACT_VERSION = '1.0.0';
