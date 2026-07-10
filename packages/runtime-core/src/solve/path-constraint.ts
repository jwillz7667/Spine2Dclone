import type { PathRotateMode } from '@marionette/format/types';
import { composeInto, decompose, invert, MAT2X3_STRIDE } from '../math/affine';
import type { Mat2x3 } from '../math/affine';
import type { Pose, ResolvedPathConstraint } from '../skeleton/pose';
import { worldDirToLocalRotDeg } from './ik';
import { localMat, parentWorldMat, resolveWorld, resolveWorldMat } from './resolve-world';
import { clamp, DEG_TO_RAD, wrapDegrees } from './scalar';

// Path constraint solve (ADR-0013, PP-B6). A path constraint distributes a list of bones ALONG a target
// slot's path attachment (a piecewise cubic Bezier spline) and orients them, blended per channel by
// mixRotate/mixX/mixY. It runs at solve-order step 3 (before the step-4 world pass), so it resolves the
// path's WORLD control points ON DEMAND from current local state (resolveWorld), exactly like IK/transform
// read their target world, never from pose.world (not yet written at step 3). It writes bone LOCAL x/y,
// rotation, and (chainScale only) scaleX; step 4 then reproduces the intended world. NO PixiJS, NO DOM:
// pure solve math that ports unchanged to C#/GDScript.

// Below this a length or curve span is degenerate and skipped, so no division by zero leaves the solver.
const EPSILON = 1e-12;

// The pinned per-curve subdivision for the constant-speed world arc-length LUT (ADR-0013 section 3b). A
// fixed count, applied identically in all three runtimes, is the cross-language contract: the LUT is a
// fixed sum of chord lengths plus one linear interpolation, so no iteration count or convergence test can
// drift across language math libraries.
export const PATH_CURVE_SUBDIVISIONS = 64;

// The prepared, pose-independent geometry of one path attachment (ADR-0013 sections 1 to 3), built ONCE at
// buildPose from the target slot's setup default-skin path attachment. It carries the control-point layout
// (weighted or unweighted, ADR-0002 codec), the derived curve/vertex counts, the committed cumulative
// arc-length table, and the per-frame scratch (world control points, the per-curve arc-length LUT, and, for
// a weighted path, the packed on-demand world buffer). All scratch is allocated here and reused every frame.
export interface PreparedPathGeometry {
  readonly closed: boolean;
  readonly constantSpeed: boolean;
  readonly curveCount: number;
  // The logical control-point count V (3C+1 open, 3C closed). The world scratch is 2V lanes.
  readonly vertexCount: number;
  // The committed cumulative arc length to the END of each curve (ADR-0011); length === curveCount.
  readonly lengths: Float64Array;
  readonly weighted: boolean;
  // Unweighted: the flat setup-space control points [x0, y0, x1, y1, ...]. Weighted: unused (the stream is
  // walked instead), left as an empty array.
  readonly localVertices: readonly number[];
  // Weighted: the ADR-0002 self-delimiting vertex stream (boneCount, (globalBoneIndex, vx, vy, weight) x
  // boneCount per logical control point). Unweighted: an empty array.
  readonly stream: readonly number[];
  // Weighted: the ascending referenced-bone manifest (global bone indices), resolved once per frame into
  // boneWorldScratch. Null for an unweighted path.
  readonly manifestBones: readonly number[] | null;
  // The slot bone index the unweighted control points ride (-1 when unresolved). Unused for a weighted path.
  readonly slotBoneIndex: number;
  // Scratch (allocated once, reused per frame): world control points (2V), the per-curve cumulative-chord
  // LUT (curveCount * (PATH_CURVE_SUBDIVISIONS + 1)), and, weighted only, the packed on-demand world buffer
  // indexed by GLOBAL bone index (boneCount * MAT2X3_STRIDE).
  readonly worldPoints: Float64Array;
  readonly curveLut: Float64Array;
  readonly boneWorldScratch: Float64Array | null;
}

// Module scratch for the unweighted slot-bone world matrix, so computeWorldControlPoints allocates nothing
// on the unweighted path. The solve is single-threaded and never re-entrant, so a module buffer is safe
// (the same pattern resolve-world.ts uses for its ancestor accumulator).
const slotWorldScratch = new Float64Array(MAT2X3_STRIDE);

// Fill geom.worldPoints (2V lanes) with the WORLD positions of the path's control points at solve-order
// step 3, resolving bone worlds on demand (ADR-0013 section 2). Allocation-free.
function computeWorldControlPoints(pose: Pose, geom: PreparedPathGeometry): void {
  const out = geom.worldPoints;
  if (geom.weighted) {
    // Resolve each referenced bone's world once into the packed scratch (indexed by global bone index),
    // then walk the ADR-0002 stream exactly as solveSkin does, accumulating in stored influence order.
    const bones = geom.manifestBones!;
    const world = geom.boneWorldScratch!;
    for (let i = 0; i < bones.length; i += 1) {
      const boneIndex = bones[i]!;
      if (boneIndex >= 0) resolveWorld(pose, boneIndex, world, boneIndex * MAT2X3_STRIDE);
    }
    const stream = geom.stream;
    const length = stream.length;
    let cursor = 0;
    let outIndex = 0;
    while (cursor < length) {
      const influenceCount = stream[cursor]!;
      cursor += 1;
      let px = 0;
      let py = 0;
      for (let k = 0; k < influenceCount; k += 1) {
        const boneOffset = stream[cursor]! * MAT2X3_STRIDE;
        const vx = stream[cursor + 1]!;
        const vy = stream[cursor + 2]!;
        const weight = stream[cursor + 3]!;
        cursor += 4;
        const a = world[boneOffset]!;
        const b = world[boneOffset + 1]!;
        const c = world[boneOffset + 2]!;
        const d = world[boneOffset + 3]!;
        const tx = world[boneOffset + 4]!;
        const ty = world[boneOffset + 5]!;
        px += weight * (a * vx + c * vy + tx);
        py += weight * (b * vx + d * vy + ty);
      }
      out[outIndex] = px;
      out[outIndex + 1] = py;
      outIndex += 2;
    }
    return;
  }
  // Unweighted: every control point rides the slot's bone: worldPoint = slotBoneWorld * (x, y).
  const boneIndex = geom.slotBoneIndex;
  if (boneIndex < 0) return;
  resolveWorld(pose, boneIndex, slotWorldScratch, 0);
  const a = slotWorldScratch[0]!;
  const b = slotWorldScratch[1]!;
  const c = slotWorldScratch[2]!;
  const d = slotWorldScratch[3]!;
  const tx = slotWorldScratch[4]!;
  const ty = slotWorldScratch[5]!;
  const verts = geom.localVertices;
  const count = verts.length;
  for (let i = 0; i < count; i += 2) {
    const x = verts[i]!;
    const y = verts[i + 1]!;
    out[i] = a * x + c * y + tx;
    out[i + 1] = b * x + d * y + ty;
  }
}

// Evaluate the world cubic Bezier of curve `i` at parameter t into (out[0], out[1]) and its tangent ANGLE
// (radians) into out[2] (ADR-0013 section 1). The four control points are cp[3i .. 3i+3]; the end anchor
// wraps modulo V, which for a closed spline returns curve C-1's end to control point 0 and for an open
// spline is a no-op (3(C-1)+3 = V-1 < V). Reads geom.worldPoints directly (no allocation).
function evalCurve(geom: PreparedPathGeometry, i: number, t: number, out: Float64Array): void {
  const wp = geom.worldPoints;
  const V = geom.vertexCount;
  const b0 = i * 3;
  const p0 = b0 % V;
  const p1 = (b0 + 1) % V;
  const p2 = (b0 + 2) % V;
  const p3 = (b0 + 3) % V;
  const x0 = wp[p0 * 2]!;
  const y0 = wp[p0 * 2 + 1]!;
  const x1 = wp[p1 * 2]!;
  const y1 = wp[p1 * 2 + 1]!;
  const x2 = wp[p2 * 2]!;
  const y2 = wp[p2 * 2 + 1]!;
  const x3 = wp[p3 * 2]!;
  const y3 = wp[p3 * 2 + 1]!;
  const u = 1 - t;
  const c0 = u * u * u;
  const c1 = 3 * u * u * t;
  const c2 = 3 * u * t * t;
  const c3 = t * t * t;
  out[0] = c0 * x0 + c1 * x1 + c2 * x2 + c3 * x3;
  out[1] = c0 * y0 + c1 * y1 + c2 * y2 + c3 * y3;
  const d0 = 3 * u * u;
  const d1 = 6 * u * t;
  const d2 = 3 * t * t;
  const dx = d0 * (x1 - x0) + d1 * (x2 - x1) + d2 * (x3 - x2);
  const dy = d0 * (y1 - y0) + d1 * (y2 - y1) + d2 * (y3 - y2);
  out[2] = Math.atan2(dy, dx);
}

// Build the per-curve cumulative-chord LUT in WORLD space (ADR-0013 section 3b), used only for constant
// speed. For each curve, PATH_CURVE_SUBDIVISIONS+1 samples of the world Bezier are chorded and accumulated;
// curveLut[curve * stride + k] is the cumulative chord length to sub-sample k (entry 0 is always 0).
// Allocation-free (writes into geom.curveLut, evaluates through the module point scratch).
const pointScratch = new Float64Array(3);
function buildCurveLut(geom: PreparedPathGeometry): void {
  const stride = PATH_CURVE_SUBDIVISIONS + 1;
  const lut = geom.curveLut;
  for (let i = 0; i < geom.curveCount; i += 1) {
    const base = i * stride;
    lut[base] = 0;
    evalCurve(geom, i, 0, pointScratch);
    let prevX = pointScratch[0]!;
    let prevY = pointScratch[1]!;
    let acc = 0;
    for (let k = 1; k <= PATH_CURVE_SUBDIVISIONS; k += 1) {
      evalCurve(geom, i, k / PATH_CURVE_SUBDIVISIONS, pointScratch);
      const x = pointScratch[0]!;
      const y = pointScratch[1]!;
      acc += Math.hypot(x - prevX, y - prevY);
      lut[base + k] = acc;
      prevX = x;
      prevY = y;
    }
  }
}

// Map an already-normalized arc-length position `s` in [0, L] to a curve index and Bezier parameter t
// (ADR-0013 section 3). Cross-curve selection reads the committed cumulative `lengths`; the within-curve
// fraction becomes t directly (naive per-curve t) or, for constant speed, inverts the world LUT.
function mapPosition(
  geom: PreparedPathGeometry,
  s: number,
  out: { curve: number; t: number },
): void {
  const lengths = geom.lengths;
  const curveCount = geom.curveCount;
  // Smallest curve whose cumulative end length reaches s (linear scan; curve counts are small and this
  // ports trivially, but it is a monotone search over the committed table, ADR-0013 section 3a).
  let curve = 0;
  while (curve < curveCount - 1 && lengths[curve]! < s) curve += 1;
  const curveStart = curve === 0 ? 0 : lengths[curve - 1]!;
  const curveLen = lengths[curve]! - curveStart;
  const curveFraction = curveLen > EPSILON ? clamp((s - curveStart) / curveLen, 0, 1) : 0;
  out.curve = curve;
  if (!geom.constantSpeed) {
    out.t = curveFraction;
    return;
  }
  out.t = invertCurveLut(geom, curve, curveFraction);
}

// Invert the world arc-length LUT of `curve` for a target fraction-of-curve in [0, 1], returning the Bezier
// parameter t (ADR-0013 section 3b). Linear interpolation inside the bracketing sub-segment; a zero-length
// curve or sub-segment resolves to the segment start (no division by zero).
function invertCurveLut(geom: PreparedPathGeometry, curve: number, fraction: number): number {
  const stride = PATH_CURVE_SUBDIVISIONS + 1;
  const base = curve * stride;
  const lut = geom.curveLut;
  const total = lut[base + PATH_CURVE_SUBDIVISIONS]!;
  if (total <= EPSILON) return fraction;
  const targetLen = fraction * total;
  let k = 0;
  while (k < PATH_CURVE_SUBDIVISIONS - 1 && lut[base + k + 1]! < targetLen) k += 1;
  const segStart = lut[base + k]!;
  const segLen = lut[base + k + 1]! - segStart;
  const segFraction = segLen > EPSILON ? (targetLen - segStart) / segLen : 0;
  return (k + segFraction) / PATH_CURVE_SUBDIVISIONS;
}

// Normalize a target arc-length position for an open (clamp to [0, L]) or closed (floored-modulo wrap into
// [0, L)) path (ADR-0013 section 4.1).
function normalizePosition(s: number, totalLength: number, closed: boolean): number {
  if (closed) {
    const wrapped = ((s % totalLength) + totalLength) % totalLength;
    return wrapped;
  }
  return clamp(s, 0, totalLength);
}

// The setup natural length of a constrained bone (ADR-0013 section 4). pose.boneLength holds each bone's
// setup length; an unresolved bone index contributes 0.
function naturalLength(pose: Pose, boneIndex: number): number {
  return boneIndex >= 0 ? pose.boneLength[boneIndex]! : 0;
}

// Compute the cumulative arc-length offset from bone 0 to bone b for spacingMode (ADR-0013 section 4). gap[b]
// is the increment from bone b-1 to bone b. Returns the offset array filled into `offsets` (N entries).
function computeSpacingOffsets(
  pose: Pose,
  constraint: ResolvedPathConstraint,
  totalLength: number,
  spacing: number,
  offsets: Float64Array,
): void {
  const bones = constraint.boneIndices;
  const n = bones.length;
  const mode = constraint.spacingMode;
  // proportional needs the natural total of the N-1 gap-contributing bones (bones 0 .. N-2).
  let scale = 0;
  if (mode === 'proportional') {
    let naturalTotal = 0;
    for (let b = 0; b < n - 1; b += 1) naturalTotal += naturalLength(pose, bones[b]!);
    scale = naturalTotal > EPSILON ? spacing / naturalTotal : 0;
  }
  offsets[0] = 0;
  for (let b = 1; b < n; b += 1) {
    let gap: number;
    if (mode === 'fixed') gap = spacing;
    else if (mode === 'percent') gap = spacing * totalLength;
    else if (mode === 'length') gap = naturalLength(pose, bones[b - 1]!);
    else gap = naturalLength(pose, bones[b - 1]!) * scale; // proportional
    offsets[b] = offsets[b - 1]! + gap;
  }
}

// Write a bone's blended local from a target world position and world rotation, expressed in the bone's
// parent world frame and mix-blended per channel (ADR-0013 section 5). mix* = 0 leaves the bone's current
// local exactly; mix* = 1 lands on the target. scaleXMul = 1 (every mode but chainScale) leaves scaleX.
function writeBoneLocal(
  pose: Pose,
  boneIndex: number,
  worldX: number,
  worldY: number,
  worldAngleRad: number,
  scaleXMul: number,
  mixRotate: number,
  mixX: number,
  mixY: number,
): void {
  const parentWorld: Mat2x3 = parentWorldMat(pose, boneIndex);
  const inv = invert(parentWorld);
  const localX = inv[0] * worldX + inv[2] * worldY + inv[4];
  const localY = inv[1] * worldX + inv[3] * worldY + inv[5];
  const solvedRotDeg = worldDirToLocalRotDeg(parentWorld, worldAngleRad);
  const current = decompose(localMat(pose, boneIndex));
  const x = current.x + mixX * (localX - current.x);
  const y = current.y + mixY * (localY - current.y);
  const rot = current.rotationDeg + mixRotate * wrapDegrees(solvedRotDeg - current.rotationDeg);
  const scaleX = current.scaleX * (1 + mixRotate * (scaleXMul - 1));
  composeInto(
    pose.local,
    boneIndex * MAT2X3_STRIDE,
    x,
    y,
    rot,
    scaleX,
    current.scaleY,
    current.shearXDeg,
    0,
  );
}

// The current world X-axis magnitude of a bone (its world segment scale), for chainScale length preservation.
function worldXScale(pose: Pose, boneIndex: number): number {
  const world = resolveWorldMat(pose, boneIndex);
  return Math.hypot(world[0], world[1]);
}

// Module scratch reused across all path constraints (single-threaded solve): per-bone world positions
// (2N), per-bone tangent angles (N), per-bone spacing offsets (N), and the (curve, t) mapping. Sized to the
// largest bone count seen; grows once per larger constraint, so steady-state solving of same-or-smaller
// constraints allocates nothing.
let positionScratch = new Float64Array(0);
let tangentScratch = new Float64Array(0);
let offsetScratch = new Float64Array(0);
const mapOut = { curve: 0, t: 0 };

function ensureBoneScratch(n: number): void {
  if (positionScratch.length < n * 2) positionScratch = new Float64Array(n * 2);
  if (tangentScratch.length < n) tangentScratch = new Float64Array(n);
  if (offsetScratch.length < n) offsetScratch = new Float64Array(n);
}

// Solve one path constraint against the pose (ADR-0013). Resolves world control points, distributes the
// bones along the arc, orients them per rotateMode, and writes each bone's local, all blended by the
// per-frame sampled mix channels. A constraint with no prepared path (no resolvable setup path attachment),
// a non-positive-length path, or all-zero mix is a no-op.
export function solvePathConstraint(pose: Pose, constraint: ResolvedPathConstraint): void {
  const geom = constraint.path;
  if (geom === null) return;
  const bones = constraint.boneIndices;
  const n = bones.length;
  if (n === 0) return;

  const sampled = constraint.sampled;
  const mixRotate = sampled.mixRotate;
  const mixX = sampled.mixX;
  const mixY = sampled.mixY;
  if (mixRotate <= 0 && mixX <= 0 && mixY <= 0) return;

  const totalLength = geom.lengths[geom.curveCount - 1]!;
  if (totalLength <= EPSILON) return;

  computeWorldControlPoints(pose, geom);
  if (geom.constantSpeed) buildCurveLut(geom);

  ensureBoneScratch(n);
  const positions = positionScratch;
  const tangents = tangentScratch;
  const offsets = offsetScratch;

  const basePosition =
    constraint.positionMode === 'percent' ? sampled.position * totalLength : sampled.position;
  computeSpacingOffsets(pose, constraint, totalLength, sampled.spacing, offsets);

  // Pass 1: sample the world path position and tangent angle for every bone (pure path samples,
  // independent of the local writes, so chain rotation can read a neighbour's position safely).
  for (let b = 0; b < n; b += 1) {
    const s = normalizePosition(basePosition + offsets[b]!, totalLength, geom.closed);
    mapPosition(geom, s, mapOut);
    evalCurve(geom, mapOut.curve, mapOut.t, pointScratch);
    positions[b * 2] = pointScratch[0]!;
    positions[b * 2 + 1] = pointScratch[1]!;
    tangents[b] = pointScratch[2]!;
  }

  // Pass 2: orient and write each bone.
  const rotateMode: PathRotateMode = constraint.rotateMode;
  const offsetRad = constraint.offsetRotation * DEG_TO_RAD;
  for (let b = 0; b < n; b += 1) {
    const boneIndex = bones[b]!;
    if (boneIndex < 0) continue;
    const px = positions[b * 2]!;
    const py = positions[b * 2 + 1]!;

    let angle = tangents[b]!;
    let scaleXMul = 1;
    if (rotateMode !== 'tangent' && b < n - 1) {
      const nx = positions[(b + 1) * 2]!;
      const ny = positions[(b + 1) * 2 + 1]!;
      const dx = nx - px;
      const dy = ny - py;
      if (dx * dx + dy * dy > EPSILON) {
        angle = Math.atan2(dy, dx);
        if (rotateMode === 'chainScale') {
          const desired = Math.hypot(dx, dy);
          const natural = naturalLength(pose, boneIndex) * worldXScale(pose, boneIndex);
          scaleXMul = natural > EPSILON ? desired / natural : 1;
        }
      }
    }
    writeBoneLocal(pose, boneIndex, px, py, angle + offsetRad, scaleXMul, mixRotate, mixX, mixY);
  }
}
