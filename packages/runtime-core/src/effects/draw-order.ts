import type { EmitterShape, ParticleTexture, RangeF } from '@marionette/format/types';
import { drawRange, nextUnit } from './prng';
import type { PrngState } from './prng';

// The NORMATIVE per-particle draw order (phase-3-vfx-particles.md section 8.3, WP-3.1). When a
// particle is spawned, PRNG draws happen in EXACTLY this order, and a RangeF with min === max consumes
// ZERO draws. Every runtime (TS, C#, GDScript) MUST draw in this order so the per-particle initial
// state and the stream position match exactly. This module is the single documented, tested helper
// that encodes the order; the emitter solve (WP-3.2) calls it so the order lives in one place.
//
// Draw order:
//   1. Spawn position from `shape`:
//        point: 0 draws (origin).
//        line: 1 draw (parameter along the segment).
//        circle edgeOnly: 1 draw (angle); not edgeOnly: 2 draws (angle, then radius via
//          sqrt(unit) for area-uniform).
//        rect: 2 draws (u then v).
//   2. lifetime (1 draw if non-constant).
//   3. emissionAngle (1 draw if non-constant).
//   4. startSpeed (1 draw if non-constant).
//   5. startRotation (1 draw if non-constant).
//   6. angularVelocity (1 draw if non-constant).
//   7. startScale (1 draw if non-constant).
//   8. If texture.kind === 'animated' and mode === 'loop': 1 draw for the starting frame offset;
//      otherwise 0.
//
// Velocity decomposition (the one place direction is set; documented so all runtimes agree):
//   vx = startSpeed * cos(emissionAngle); vy = startSpeed * sin(emissionAngle), with the angle in
//   degrees converted to radians as deg * PI / 180. Convention: 0 degrees = +x, counter-clockwise
//   positive.

// Degrees-to-radians factor, written as a constant so the operation order is fixed (no inline
// reassociation) and matches a native reimplementation.
const DEG_TO_RAD = Math.PI / 180;

// The fields of an EmitterLayer the spawn draw consumes, in the order the draws occur. Passed as a
// narrow view rather than the whole layer so this helper stays decoupled from the layer schema shape.
export interface SpawnDrawInputs {
  readonly shape: EmitterShape;
  readonly lifetime: RangeF;
  readonly emissionAngle: RangeF;
  readonly startSpeed: RangeF;
  readonly startRotation: RangeF;
  readonly angularVelocity: RangeF;
  readonly startScale: RangeF;
  readonly texture: ParticleTexture;
}

// The per-particle initial state produced by consuming the draws above. `lifeSeconds` is the float
// lifetime draw (the integer lifeSteps quantization is the integrator's job, section 8.4). `px`/`py`
// are local spawn offsets relative to the emitter origin (the anchor transform is applied by the
// system). Reused across spawns by the caller to avoid per-particle allocation in the hot path.
export interface SpawnState {
  px: number;
  py: number;
  vx: number;
  vy: number;
  lifeSeconds: number;
  emissionAngleDeg: number;
  startSpeed: number;
  rot: number;
  angVel: number;
  baseScale: number;
  startFrameOffset: number;
}

// Allocate a zeroed SpawnState. The solve allocates one per pool slot at warmup and reuses it; tests
// can allocate ad hoc.
export function makeSpawnState(): SpawnState {
  return {
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    lifeSeconds: 0,
    emissionAngleDeg: 0,
    startSpeed: 0,
    rot: 0,
    angVel: 0,
    baseScale: 0,
    startFrameOffset: 0,
  };
}

// Sample the local spawn position from the shape, consuming the shape-specific number of draws
// (step 1). Writes px/py into `out`. The circle radius uses sqrt(unit) so samples are area-uniform.
function drawSpawnPosition(state: PrngState, shape: EmitterShape, out: SpawnState): void {
  switch (shape.kind) {
    case 'point':
      out.px = 0;
      out.py = 0;
      return;
    case 'line': {
      const u = nextUnit(state);
      out.px = shape.x1 + (shape.x2 - shape.x1) * u;
      out.py = shape.y1 + (shape.y2 - shape.y1) * u;
      return;
    }
    case 'circle': {
      const angle = nextUnit(state) * (Math.PI * 2);
      const radius = shape.edgeOnly ? shape.radius : Math.sqrt(nextUnit(state)) * shape.radius;
      out.px = Math.cos(angle) * radius;
      out.py = Math.sin(angle) * radius;
      return;
    }
    case 'rect': {
      const u = nextUnit(state);
      const v = nextUnit(state);
      out.px = (u - 0.5) * shape.width;
      out.py = (v - 0.5) * shape.height;
      return;
    }
  }
}

// Consume the per-particle draws in the NORMATIVE order and write the initial state into `out`,
// returning it. Mutates `state` (advances the stream) and `out` only; allocates nothing. The caller
// owns `out` (one per pool slot) to keep the hot draw path allocation-free.
export function drawParticleInitialState(
  state: PrngState,
  inputs: SpawnDrawInputs,
  out: SpawnState,
): SpawnState {
  // 1. Spawn position.
  drawSpawnPosition(state, inputs.shape, out);
  // 2. lifetime.
  out.lifeSeconds = drawRange(state, inputs.lifetime);
  // 3. emissionAngle.
  out.emissionAngleDeg = drawRange(state, inputs.emissionAngle);
  // 4. startSpeed.
  out.startSpeed = drawRange(state, inputs.startSpeed);
  // 5. startRotation.
  out.rot = drawRange(state, inputs.startRotation);
  // 6. angularVelocity.
  out.angVel = drawRange(state, inputs.angularVelocity);
  // 7. startScale.
  out.baseScale = drawRange(state, inputs.startScale);
  // 8. Animated starting frame offset (loop mode only).
  if (inputs.texture.kind === 'animated' && inputs.texture.mode === 'loop') {
    // The integer starting frame within [0, regions.length); one draw, floored. nextUnit is in
    // [0, 1) so the index never reaches regions.length.
    out.startFrameOffset = Math.floor(nextUnit(state) * inputs.texture.regions.length);
  } else {
    out.startFrameOffset = 0;
  }
  // Velocity decomposition (the one place direction is set).
  const rad = out.emissionAngleDeg * DEG_TO_RAD;
  out.vx = out.startSpeed * Math.cos(rad);
  out.vy = out.startSpeed * Math.sin(rad);
  return out;
}

// The exact number of PRNG draws one particle consumes for `inputs`, used by the draw-count probe
// test and by any runtime that needs to predict the stream offset without sampling. A constant RangeF
// (min === max) contributes ZERO; everything follows the section 8.3 order.
export function spawnDrawCount(inputs: SpawnDrawInputs): number {
  let count = 0;
  switch (inputs.shape.kind) {
    case 'point':
      break;
    case 'line':
      count += 1;
      break;
    case 'circle':
      count += inputs.shape.edgeOnly ? 1 : 2;
      break;
    case 'rect':
      count += 2;
      break;
  }
  for (const range of [
    inputs.lifetime,
    inputs.emissionAngle,
    inputs.startSpeed,
    inputs.startRotation,
    inputs.angularVelocity,
    inputs.startScale,
  ]) {
    if (range.min !== range.max) count += 1;
  }
  if (inputs.texture.kind === 'animated' && inputs.texture.mode === 'loop') count += 1;
  return count;
}
