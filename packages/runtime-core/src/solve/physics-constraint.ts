import { composeInto, MAT2X3_STRIDE } from '../math/affine';
import { RAD_TO_DEG } from './scalar';
import { resolveWorld } from './resolve-world';
import { SETUP_STRIDE } from '../skeleton/pose';
import type { Pose, ResolvedPhysicsConstraint } from '../skeleton/pose';

// Physics constraint SOLVE (ADR-0014, PP-B7). A physics constraint drives ONE bone with a per-channel
// damped-driven harmonic oscillator so secondary motion (tails, ropes, jiggle) emerges deterministically
// from the animated pose plus world forces. It solves in step 3 alongside the other constraints, LAST by
// default (IK, then transform, then path, then physics), writing LOCAL only (ADR-0003), so the step-4
// world pass reproduces the intended world. It is the ONE constraint kind that steps over time, so it uses
// the fixed-timestep integer step clock and semi-implicit (symplectic) Euler EXACTLY as the emitter solve
// (effects/emitter-solve.ts) pins them: bit-reproducible within a runtime, tolerance-parity across TS/C#/
// GDScript. Seedless (no PRNG, no clock, no allocation per frame; all state is the pre-allocated per-
// constraint arrays created at skeleton build).

// Fixed-point one (2^16) for the integer step accumulator, IDENTICAL to the emitter (SPAWN_FIXED_ONE).
// The step count is an integer-exact function of accumulated time, so two runtimes stepping the same
// frameDt sequence run the identical number of steps and cannot drift by a fractional step (ADR section 2.2).
export const PHYSICS_STEP_FIXED_ONE = 65536;

// The teleport reset threshold (ADR-0014 section 6), in the bone's LOCAL translation units. Owned by
// PP-B7 (a solve constant, deliberately NOT a 0.6.0 format field). A per-frame setpoint TRANSLATION jump
// larger than this is treated as a cut / skin swap, not motion: the bone snaps to the new pose at rest
// rather than whipping across the gap. Chosen far above any hand-animated per-frame motion (a bone lives
// within a few hundred local units of its parent; 1000 units in a single frame is ~60000 units/second at
// 60fps, unreachable by keyframed motion, reached only by a scene cut or a skin swap that repositions the
// bone). Promoting it to a per-constraint/per-skeleton field is a later additive stage if authoring asks.
export const PHYSICS_RESET_DISTANCE = 1000;

// Round-half-away-from-zero, the SAME single rounding rule the emitter uses (effects/emitter-solve.ts).
// frameDt and step are non-negative here (validated), so the tie case never bends, but the explicit rule
// is pinned so a native runtime matches bit-for-bit.
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

// The integer number of fixed steps a frame of `frameDt` seconds schedules against a `step`-second clock,
// in fixed-point (>> 16 to recover the integer step count, the remainder carried in the accumulator). One
// divide, one multiply, one round (ADR section 2.2). Exported as the cross-language integer primitive
// (seed-prng-crc-vectors.json physicsStepFixed): a native runtime asserts its own value equals this.
export function physicsStepsFixed(frameDt: number, step: number): number {
  return roundHalfAwayFromZero((frameDt / step) * PHYSICS_STEP_FIXED_ONE);
}

// Channel codes (ADR-0014 section 1), the simulated subset of a bone's LOCAL pose channels. The value is
// the code stored per simulated channel in ResolvedPhysicsConstraint.channelCodes.
export const PHYSICS_CHANNEL_X = 0;
export const PHYSICS_CHANNEL_Y = 1;
export const PHYSICS_CHANNEL_ROTATION = 2;
export const PHYSICS_CHANNEL_SCALEX = 3;
export const PHYSICS_CHANNEL_SHEARX = 4;

// Map a channel code to its lane in the decomposed local-transform scratch [x, y, rotationDeg, scaleX,
// scaleY, shearXDeg, shearYDeg] (SETUP_STRIDE layout). rotation/scaleX/shearX are DEGREES/linear scalars,
// exactly the format's stored fields, so the write-back is a local delta on that bone property. shearX is
// lane 5 (lane 4 is the held scaleY), which is why this indirection exists.
const CHANNEL_SCRATCH_LANE = [0, 1, 2, 3, 5];

// Solver-owned scratch, reused across calls so the solve allocates nothing. The solve is single-threaded
// and never re-entrant (no physics constraint nests inside another), so module-level scratch is safe,
// matching resolve-world.ts's convention.
const localScratch = new Float64Array(SETUP_STRIDE); // decomposed local channels of the bone this frame
const targetScratch = new Float64Array(5); // the sampled setpoint per simulated channel this frame
const worldScratch = new Float64Array(MAT2X3_STRIDE); // the bone's current world matrix (force projection)

// Decompose a bone's LOCAL matrix into the seven format channels [x, y, rotationDeg, scaleX, scaleY,
// shearXDeg, shearYDeg], written into localScratch. This is affine.decompose's TRS+shear parameterization
// (shearY fixed to 0), but computed allocation-free and with sqrt(a*a+b*b) rather than hypot so the C#/
// GDScript mirrors use the identical formula (decomposeWorld already uses sqrt, not hypot). composeInto of
// the result reproduces the matrix to f64 round-off, so an unsimulated / zero-effect channel is an identity
// to round-off (the mix=0 and zero-strength oracles assert exactly this tolerance).
function decomposeLocalInto(local: Float64Array, offset: number): void {
  const a = local[offset]!;
  const b = local[offset + 1]!;
  const c = local[offset + 2]!;
  const d = local[offset + 3]!;
  const scaleX = Math.sqrt(a * a + b * b);
  const xAxisAngle = Math.atan2(b, a); // == rotation (shearY fixed to 0)
  const yAxisAngle = Math.atan2(d, c);
  const shearX = xAxisAngle + Math.PI / 2 - yAxisAngle;
  const scaleY = Math.sqrt(c * c + d * d) * Math.cos(shearX);
  localScratch[0] = local[offset + 4]!; // x
  localScratch[1] = local[offset + 5]!; // y
  localScratch[2] = xAxisAngle * RAD_TO_DEG; // rotation, degrees
  localScratch[3] = scaleX;
  localScratch[4] = scaleY;
  localScratch[5] = shearX * RAD_TO_DEG; // shearX, degrees
  localScratch[6] = 0; // shearY (held at the decomposition convention)
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Initialize (or re-initialize) a constraint's simulation state to REST on the current animated pose
// (ADR section 2.1): p_c = target_c, v_c = 0, targetPrev_c = target_c, accFixed = 0. Called on the first
// evaluation and on any activation edge (skin change / re-activation, ADR section 6).
function initToRest(constraint: ResolvedPhysicsConstraint, channelCount: number): void {
  for (let ci = 0; ci < channelCount; ci += 1) {
    const target = targetScratch[ci]!;
    constraint.p[ci] = target;
    constraint.v[ci] = 0;
    constraint.targetPrev[ci] = target;
  }
  constraint.accFixed = 0;
  constraint.initialized = true;
}

// Solve one physics constraint against the pose for a frame of `frameDt` seconds (ADR-0014 section 2).
// Reads the bone's current LOCAL channels (the setpoint the earlier constraints produced), steps the
// per-channel damped spring on the integer step clock, and writes the mixed result back to LOCAL. The
// per-frame sampled scratch (mix/inertia/strength/damping/wind/gravity) was written by step 2; step/mass
// are static. Allocation-free: decompose/target/world go into module scratch, the (p, v, targetPrev)
// state and accumulator live on the pre-allocated constraint.
export function solvePhysicsConstraint(
  pose: Pose,
  constraint: ResolvedPhysicsConstraint,
  frameDt: number,
): void {
  const boneIndex = constraint.boneIndex;
  if (boneIndex < 0) return;
  const channelCodes = constraint.channelCodes;
  const channelCount = channelCodes.length;

  const localOffset = boneIndex * MAT2X3_STRIDE;
  decomposeLocalInto(pose.local, localOffset);

  // The setpoint per simulated channel (the current animated + earlier-constraint local value).
  let nonFinite = false;
  for (let ci = 0; ci < channelCount; ci += 1) {
    const target = localScratch[CHANNEL_SCRATCH_LANE[channelCodes[ci]!]!]!;
    targetScratch[ci] = target;
    if (!Number.isFinite(target)) nonFinite = true;
  }

  // Combine the sampled per-constraint knobs with the skeleton globals (ADR section 2.3 / section 5).
  const sampled = constraint.sampled;
  const settings = pose.physicsSettings;
  const strength = sampled.strength;
  const damping = sampled.damping;
  const inertia = sampled.inertia;
  const mass = constraint.baseMass;
  const step = constraint.baseStep;
  const windEff = settings.wind + sampled.wind;
  const gravityEff = settings.gravity + sampled.gravity;
  const mixEff = clamp01(settings.mix * sampled.mix);

  // Activation / (re)start: initialize to rest on the pose, then this frame runs its steps from rest (ADR
  // section 6). Under conformance frame 0 has frameDt 0, so the bone sits exactly on its pose.
  let justInit = false;
  if (!constraint.initialized) {
    initToRest(constraint, channelCount);
    justInit = true;
  }

  // Teleport reset (ADR section 6): a setpoint TRANSLATION jump larger than PHYSICS_RESET_DISTANCE (or a
  // non-finite setpoint) is a cut / skin swap, not motion. Snap to the new pose at rest and skip the
  // inertia carry this frame. Measured BEFORE the inertia carry, only on an already-initialized frame.
  let teleport = false;
  if (!justInit) {
    let d: number;
    if (constraint.simulatesX && constraint.simulatesY) {
      const dx = targetScratch[constraint.channelX]! - constraint.targetPrev[constraint.channelX]!;
      const dy = targetScratch[constraint.channelY]! - constraint.targetPrev[constraint.channelY]!;
      d = Math.sqrt(dx * dx + dy * dy);
    } else if (constraint.simulatesX) {
      d = Math.abs(
        targetScratch[constraint.channelX]! - constraint.targetPrev[constraint.channelX]!,
      );
    } else if (constraint.simulatesY) {
      d = Math.abs(
        targetScratch[constraint.channelY]! - constraint.targetPrev[constraint.channelY]!,
      );
    } else {
      // No translation channel simulated: the proxy jump is the bone's local setup-to-pose (x, y) delta.
      const setupBase = boneIndex * SETUP_STRIDE;
      const dx = localScratch[0]! - pose.setup[setupBase]!;
      const dy = localScratch[1]! - pose.setup[setupBase + 1]!;
      d = Math.sqrt(dx * dx + dy * dy);
    }
    if (nonFinite || d > PHYSICS_RESET_DISTANCE) {
      for (let ci = 0; ci < channelCount; ci += 1) {
        const target = targetScratch[ci]!;
        constraint.p[ci] = target;
        constraint.v[ci] = 0;
        constraint.targetPrev[ci] = target;
      }
      teleport = true;
    }
  }

  // Per-frame inertia carry (ADR section 2.4): the bone lags its own animated motion by (1 - inertia) of
  // the pose delta. Skipped on the init frame (targetPrev == target, a no-op anyway) and on a teleport.
  if (!justInit && !teleport) {
    for (let ci = 0; ci < channelCount; ci += 1) {
      const target = targetScratch[ci]!;
      const delta = target - constraint.targetPrev[ci]!;
      constraint.p[ci] = constraint.p[ci]! + delta * (1 - inertia);
      constraint.targetPrev[ci] = target;
    }
  }

  // Per-frame external-force precompute (ADR section 2.3): project world wind (+x) and gravity (-y) into
  // the bone's local frame using its CURRENT world rotation (post-animation, pre-physics), ONCE per frame.
  // External forces feed the x and y channels only; rotation/scaleX/shearX are pure spring+inertia
  // oscillators (aExt 0). Skipped entirely when no translation channel is simulated, so a rotation-only
  // constraint touches no transcendental (fully cross-language exact) and pays nothing.
  let aExtX = 0;
  let aExtY = 0;
  if (constraint.simulatesX || constraint.simulatesY) {
    resolveWorld(pose, boneIndex, worldScratch, 0);
    // theta is the bone's world X-axis angle, decomposeWorld's rotation = atan2(c, a) with a = m0, c = m1.
    const theta = Math.atan2(worldScratch[1]!, worldScratch[0]!);
    const cs = Math.cos(theta);
    const sn = Math.sin(theta);
    const fx = windEff; // world +x
    const fy = -gravityEff; // world -y (positive gravity pulls down)
    const fLocalX = fx * cs + fy * sn;
    const fLocalY = -fx * sn + fy * cs;
    aExtX = fLocalX / mass;
    aExtY = fLocalY / mass;
  }

  // The integer step clock (ADR section 2.2): schedule an integer number of fixed steps, carry the exact
  // fractional remainder. n is an integer-exact function of accumulated time, so no fractional-step drift.
  const stepsFixed = physicsStepsFixed(frameDt, step);
  const accFixed = constraint.accFixed + stepsFixed;
  const n = accFixed >> 16;
  constraint.accFixed = accFixed - (n << 16);

  // Integrate and write back per channel. Each numbered op is a single f64 op (NO fused multiply-add: a
  // native runtime MUST NOT contract a*b+c into an FMA, which changes rounding and would desync). This is
  // the identical semi-implicit (symplectic) Euler order as the emitter's per-particle step.
  for (let ci = 0; ci < channelCount; ci += 1) {
    const code = channelCodes[ci]!;
    const target = targetScratch[ci]!;
    const aExt = code === PHYSICS_CHANNEL_X ? aExtX : code === PHYSICS_CHANNEL_Y ? aExtY : 0;
    let p = constraint.p[ci]!;
    let v = constraint.v[ci]!;
    for (let s = 0; s < n; s += 1) {
      const disp = target - p; // 1. displacement from the setpoint
      let acc = disp * strength; // 2. spring acceleration
      acc = acc + aExt; // 3. add the external acceleration (0 for rotation/scaleX/shearX)
      v = v + acc * step; // 4. symplectic velocity integrate (uses the NEW acceleration)
      v = v * damping; // 5. per-step velocity retention
      p = p + v * step; // 6. symplectic position integrate (uses the NEW velocity)
    }
    constraint.p[ci] = p;
    constraint.v[ci] = v;
    // Output write-back (ADR section 2.6): lerp(target, p, mixEff), pinned as target + (p - target) * mix.
    localScratch[CHANNEL_SCRATCH_LANE[code]!] = target + (p - target) * mixEff;
  }

  // Recompose the LOCAL matrix from the (physics-adjusted) channels (ADR section 2.6): step 4 recomputes
  // the world from this local, so physics stays a pure local write consistent with IK/transform/path.
  composeInto(
    pose.local,
    localOffset,
    localScratch[0]!,
    localScratch[1]!,
    localScratch[2]!,
    localScratch[3]!,
    localScratch[4]!,
    localScratch[5]!,
    localScratch[6]!,
  );
}
