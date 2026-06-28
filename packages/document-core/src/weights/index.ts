// Public barrel for the pure weight-math helpers (WP-2.3 / WP-2.4). Binding and weight-paint commands
// import from here; the unit tests import the same surface. No I/O, no solve, no document access.
export {
  distanceToSegment,
  normalizeInfluences,
  capInfluences,
  finalizeVertexWeights,
} from './weight-math';
export type { BoneInfluence } from './weight-math';
