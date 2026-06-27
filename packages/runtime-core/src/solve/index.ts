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
