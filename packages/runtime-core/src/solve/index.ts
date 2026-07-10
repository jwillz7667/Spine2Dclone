// Barrel for the pure solve primitives (ADR-0003 sections 2, 4, 5, 6, 9). These sit at the exact
// solve-order slots they implement, are PixiJS-free and math-bridge-free, and allocate nothing in the
// per-frame skin/deform path. Reimplemented verbatim by the Unity/Godot runtimes and locked by the
// conformance fixtures FIX-2.IK1, FIX-2.IK2, FIX-2.TC, FIX-2.DF.

export type { WorldChannels } from './affine-channels';
export { decomposeWorld, composeWorld } from './affine-channels';

export { resolveWorld, resolveWorldMat } from './resolve-world';

export { solveIkOneBone, solveIkTwoBone } from './ik';

export type { TransformMix, TransformOffset } from './transform-constraint';
export { solveTransformConstraint } from './transform-constraint';

export { solveSkin, solveSkinUnweighted } from './skin';

export { applyDeform } from './deform';

// Path constraint solve (ADR-0013, PP-B6): distribute and orient bones along a target slot's path
// attachment. The PreparedPathGeometry is built once at buildPose; solvePathConstraint runs at step 3.
export type { PreparedPathGeometry } from './path-constraint';
export { solvePathConstraint, PATH_CURVE_SUBDIVISIONS } from './path-constraint';

// Physics constraint solve (ADR-0014, PP-B7): per-bone damped-driven spring over selected local channels,
// fixed-timestep semi-implicit Euler on an integer step clock. solvePhysicsConstraint runs at step 3, LAST
// by default. physicsStepsFixed is the cross-language integer step-clock primitive; the channel codes and
// the pinned model constants (STEP_FIXED_ONE, RESET_DISTANCE) are shared verbatim by the native runtimes.
export {
  solvePhysicsConstraint,
  physicsStepsFixed,
  PHYSICS_STEP_FIXED_ONE,
  PHYSICS_RESET_DISTANCE,
  PHYSICS_CHANNEL_X,
  PHYSICS_CHANNEL_Y,
  PHYSICS_CHANNEL_ROTATION,
  PHYSICS_CHANNEL_SCALEX,
  PHYSICS_CHANNEL_SHEARX,
} from './physics-constraint';
