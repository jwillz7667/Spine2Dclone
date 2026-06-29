import type {
  EffectsFixture,
  EffectsSample,
  EmitterState,
  ParticleRow,
  RibbonState,
  SpriteState,
} from '../schema/effects-fixture';
import { PARTICLE, PARTICLE_COLOR, withinTolerance } from './tolerance';
import type { Tolerance } from './tolerance';

// The particle parity comparison engine (phase-3-vfx-particles.md section 8.9, WP-3.10, TASK-3.10.3).
// It compares two effects fixtures (an expected committed fixture and an actual one produced by a
// runtime) and returns a structured EffectsDriftReport, mirroring the skeletal compare engine. The
// split is the load-bearing design (section 8.9): integer quantities (liveCount, per-particle
// spawnOrder, frame, alive; sprite stepIndex; ribbon vertexCount) are compared EXACT (no epsilon,
// structural), because the integer step schedule (section 8.4) makes them portable across TS/C#/GDScript
// by construction; float quantities (px, py, rot, outScale, color/alpha; sprite transform; ribbon
// geometry) are compared within the single tolerance table (A.5, the PARTICLE / PARTICLE_COLOR classes).
// There is no per-runtime tolerance and no off-by-one-step reconciliation, because no EXACT quantity is
// a float-threshold crossing (section 8.4).

export type EffectsQuantityClass =
  | 'particle'
  | 'particleColor'
  | 'sprite'
  | 'ribbon'
  | 'structural';

// One localized particle parity failure. Numeric fields are populated for a float (per-lane) drift; for
// a structural (integer / count / identity) mismatch they are null and `message` carries the discrete
// mismatch. `step` is the 1-based sample step; `layer` and `index` localize within the step.
export interface EffectsDriftFailure {
  readonly effectId: string;
  readonly step: number | null;
  readonly layer: string | null;
  readonly index: number | null; // particle spawnOrder / ribbon vertex index, or null
  readonly quantity: EffectsQuantityClass;
  readonly lane: string | null; // e.g. 'px', 'outAlpha', 'vx'
  readonly expected: number | null;
  readonly actual: number | null;
  readonly absDelta: number | null;
  readonly atol: number | null;
  readonly rtol: number | null;
  readonly message: string;
}

export interface EffectsDriftReport {
  readonly ok: boolean;
  readonly failures: readonly EffectsDriftFailure[];
}

function structuralFailure(
  effectId: string,
  message: string,
  step: number | null,
  layer: string | null,
): EffectsDriftFailure {
  return {
    effectId,
    step,
    layer,
    index: null,
    quantity: 'structural',
    lane: null,
    expected: null,
    actual: null,
    absDelta: null,
    atol: null,
    rtol: null,
    message,
  };
}

// Compare one float lane within the given tolerance, appending one failure on drift. The (step, layer,
// index) triple localizes the failure for triage without re-running anything.
function compareLane(
  effectId: string,
  step: number,
  layer: string,
  index: number | null,
  quantity: EffectsQuantityClass,
  lane: string,
  expected: number,
  actual: number,
  tol: Tolerance,
  failures: EffectsDriftFailure[],
): void {
  if (withinTolerance(actual, expected, tol)) return;
  failures.push({
    effectId,
    step,
    layer,
    index,
    quantity,
    lane,
    expected,
    actual,
    absDelta: Math.abs(actual - expected),
    atol: tol.atol,
    rtol: tol.rtol,
    message: `${quantity} lane "${lane}"${index === null ? '' : ` (index ${index})`} of layer "${layer}" at step ${step} drifts beyond tolerance`,
  });
}

// Compare one particle row. The integer lanes (frame, alive) are EXACT; spawnOrder is the match key
// (a structural mismatch is detected by the caller's by-spawnOrder pairing). px..outAlpha are float.
function compareParticleRow(
  effectId: string,
  step: number,
  layer: string,
  e: ParticleRow,
  a: ParticleRow,
  failures: EffectsDriftFailure[],
): void {
  const order = e.spawnOrder;
  if (e.frame !== a.frame) {
    failures.push(
      structuralFailure(
        effectId,
        `particle spawnOrder ${order} of layer "${layer}" at step ${step}: frame mismatch (expected ${e.frame}, actual ${a.frame})`,
        step,
        layer,
      ),
    );
  }
  if (e.alive !== a.alive) {
    failures.push(
      structuralFailure(
        effectId,
        `particle spawnOrder ${order} of layer "${layer}" at step ${step}: alive mismatch (expected ${e.alive}, actual ${a.alive})`,
        step,
        layer,
      ),
    );
  }
  compareLane(effectId, step, layer, order, 'particle', 'px', e.px, a.px, PARTICLE, failures);
  compareLane(effectId, step, layer, order, 'particle', 'py', e.py, a.py, PARTICLE, failures);
  compareLane(effectId, step, layer, order, 'particle', 'rot', e.rot, a.rot, PARTICLE, failures);
  compareLane(
    effectId,
    step,
    layer,
    order,
    'particle',
    'outScale',
    e.outScale,
    a.outScale,
    PARTICLE,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    order,
    'particleColor',
    'outR',
    e.outR,
    a.outR,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    order,
    'particleColor',
    'outG',
    e.outG,
    a.outG,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    order,
    'particleColor',
    'outB',
    e.outB,
    a.outB,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    order,
    'particleColor',
    'outAlpha',
    e.outAlpha,
    a.outAlpha,
    PARTICLE_COLOR,
    failures,
  );
}

// Compare one emitter layer's state. liveCount is EXACT (integer step schedule). Particle rows are
// paired by spawnOrder (the exact conformance key); the row SET (by spawnOrder) is structural.
function compareEmitter(
  effectId: string,
  step: number,
  e: EmitterState,
  a: EmitterState,
  failures: EffectsDriftFailure[],
): void {
  const layer = e.layerName;
  if (e.liveCount !== a.liveCount) {
    failures.push(
      structuralFailure(
        effectId,
        `emitter "${layer}" at step ${step}: liveCount mismatch (expected ${e.liveCount}, actual ${a.liveCount})`,
        step,
        layer,
      ),
    );
  }
  const expectedOrders = e.particles.map((p) => p.spawnOrder).sort((x, y) => x - y);
  const actualOrders = a.particles.map((p) => p.spawnOrder).sort((x, y) => x - y);
  if (
    expectedOrders.length !== actualOrders.length ||
    expectedOrders.some((o, i) => o !== actualOrders[i])
  ) {
    failures.push(
      structuralFailure(
        effectId,
        `emitter "${layer}" at step ${step}: spawnOrder set mismatch (expected [${expectedOrders.join(', ')}], actual [${actualOrders.join(', ')}])`,
        step,
        layer,
      ),
    );
    return;
  }
  const actualByOrder = new Map(a.particles.map((p) => [p.spawnOrder, p]));
  for (const er of e.particles) {
    const ar = actualByOrder.get(er.spawnOrder);
    if (ar === undefined) continue; // unreachable: the spawnOrder set already matched above
    compareParticleRow(effectId, step, layer, er, ar, failures);
  }
}

// Compare one sprite-animator layer's state. stepIndex is EXACT (the integer local clock); the transform
// (rotationDeg, scale) and color/alpha are float (epsilon path).
function compareSprite(
  effectId: string,
  step: number,
  e: SpriteState,
  a: SpriteState,
  failures: EffectsDriftFailure[],
): void {
  const layer = e.layerName;
  if (e.stepIndex !== a.stepIndex) {
    failures.push(
      structuralFailure(
        effectId,
        `sprite "${layer}" at step ${step}: stepIndex mismatch (expected ${e.stepIndex}, actual ${a.stepIndex})`,
        step,
        layer,
      ),
    );
  }
  compareLane(
    effectId,
    step,
    layer,
    null,
    'sprite',
    'rotationDeg',
    e.rotationDeg,
    a.rotationDeg,
    PARTICLE,
    failures,
  );
  compareLane(effectId, step, layer, null, 'sprite', 'scale', e.scale, a.scale, PARTICLE, failures);
  compareLane(
    effectId,
    step,
    layer,
    null,
    'particleColor',
    'alpha',
    e.alpha,
    a.alpha,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    null,
    'particleColor',
    'r',
    e.r,
    a.r,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    null,
    'particleColor',
    'g',
    e.g,
    a.g,
    PARTICLE_COLOR,
    failures,
  );
  compareLane(
    effectId,
    step,
    layer,
    null,
    'particleColor',
    'b',
    e.b,
    a.b,
    PARTICLE_COLOR,
    failures,
  );
}

// Compare one ribbon-trail layer's state. vertexCount is EXACT (integer ring fill); the per-vertex
// geometry (vx, vy) and per-vertex alpha/color are float (epsilon path).
function compareRibbon(
  effectId: string,
  step: number,
  e: RibbonState,
  a: RibbonState,
  failures: EffectsDriftFailure[],
): void {
  const layer = e.layerName;
  if (e.vertexCount !== a.vertexCount) {
    failures.push(
      structuralFailure(
        effectId,
        `ribbon "${layer}" at step ${step}: vertexCount mismatch (expected ${e.vertexCount}, actual ${a.vertexCount})`,
        step,
        layer,
      ),
    );
  }
  if (e.vertices.length !== a.vertices.length) {
    failures.push(
      structuralFailure(
        effectId,
        `ribbon "${layer}" at step ${step}: vertex-array length mismatch (expected ${e.vertices.length}, actual ${a.vertices.length})`,
        step,
        layer,
      ),
    );
    return;
  }
  for (let i = 0; i < e.vertices.length; i += 1) {
    const ev = e.vertices[i]!;
    const av = a.vertices[i]!;
    compareLane(effectId, step, layer, i, 'ribbon', 'vx', ev.vx, av.vx, PARTICLE, failures);
    compareLane(effectId, step, layer, i, 'ribbon', 'vy', ev.vy, av.vy, PARTICLE, failures);
    compareLane(
      effectId,
      step,
      layer,
      i,
      'particleColor',
      'vAlpha',
      ev.vAlpha,
      av.vAlpha,
      PARTICLE_COLOR,
      failures,
    );
    compareLane(
      effectId,
      step,
      layer,
      i,
      'particleColor',
      'vR',
      ev.vR,
      av.vR,
      PARTICLE_COLOR,
      failures,
    );
    compareLane(
      effectId,
      step,
      layer,
      i,
      'particleColor',
      'vG',
      ev.vG,
      av.vG,
      PARTICLE_COLOR,
      failures,
    );
    compareLane(
      effectId,
      step,
      layer,
      i,
      'particleColor',
      'vB',
      ev.vB,
      av.vB,
      PARTICLE_COLOR,
      failures,
    );
  }
}

// Compare two effects fixtures. Structural identity (effectId, effectName, seed, sample count,
// per-index step number, the PRNG stream head, and the per-layer set) is EXACT (the discrete path, no
// epsilon); float quantities use the A.5 tolerance table via the PARTICLE / PARTICLE_COLOR classes. A
// non-empty failure list means a real bug, not float noise.
export function compareEffectsFixtures(
  expected: EffectsFixture,
  actual: EffectsFixture,
): EffectsDriftReport {
  const failures: EffectsDriftFailure[] = [];
  const effectId = expected.effectId;

  if (expected.effectId !== actual.effectId) {
    failures.push(
      structuralFailure(
        effectId,
        `effectId mismatch: expected "${expected.effectId}", actual "${actual.effectId}"`,
        null,
        null,
      ),
    );
    return { ok: false, failures };
  }
  if (expected.effectName !== actual.effectName) {
    failures.push(
      structuralFailure(
        effectId,
        `effectName mismatch: expected "${expected.effectName}", actual "${actual.effectName}"`,
        null,
        null,
      ),
    );
  }
  if (expected.seed !== actual.seed) {
    failures.push(
      structuralFailure(
        effectId,
        `seed mismatch: expected ${expected.seed}, actual ${actual.seed}`,
        null,
        null,
      ),
    );
  }
  // The PRNG golden-vector reference (section 8.3): the integer stream head must match EXACTLY, locking
  // the per-layer PRNG stream alongside the solved dump (WP-3.10 acceptance).
  if (
    expected.prngStreamHead.length !== actual.prngStreamHead.length ||
    expected.prngStreamHead.some((v, i) => v !== actual.prngStreamHead[i])
  ) {
    failures.push(
      structuralFailure(
        effectId,
        `PRNG stream head mismatch: expected [${expected.prngStreamHead.join(', ')}], actual [${actual.prngStreamHead.join(', ')}]`,
        null,
        null,
      ),
    );
  }
  if (expected.samples.length !== actual.samples.length) {
    failures.push(
      structuralFailure(
        effectId,
        `sample count mismatch: expected ${expected.samples.length}, actual ${actual.samples.length}`,
        null,
        null,
      ),
    );
    return { ok: false, failures };
  }

  for (let i = 0; i < expected.samples.length; i += 1) {
    const e: EffectsSample = expected.samples[i]!;
    const a: EffectsSample = actual.samples[i]!;
    if (e.step !== a.step) {
      failures.push(
        structuralFailure(
          effectId,
          `sample ${i}: step number mismatch (expected ${e.step}, actual ${a.step})`,
          e.step,
          null,
        ),
      );
      continue;
    }
    // Per-layer-kind set sizes are structural (the rig's layer list is fixed; a count drift is a bug).
    if (
      e.emitters.length !== a.emitters.length ||
      e.sprites.length !== a.sprites.length ||
      e.ribbons.length !== a.ribbons.length
    ) {
      failures.push(
        structuralFailure(
          effectId,
          `step ${e.step}: layer-count mismatch (emitters ${e.emitters.length}/${a.emitters.length}, sprites ${e.sprites.length}/${a.sprites.length}, ribbons ${e.ribbons.length}/${a.ribbons.length})`,
          e.step,
          null,
        ),
      );
      continue;
    }
    for (let k = 0; k < e.emitters.length; k += 1) {
      compareEmitter(effectId, e.step, e.emitters[k]!, a.emitters[k]!, failures);
    }
    for (let k = 0; k < e.sprites.length; k += 1) {
      compareSprite(effectId, e.step, e.sprites[k]!, a.sprites[k]!, failures);
    }
    for (let k = 0; k < e.ribbons.length; k += 1) {
      compareRibbon(effectId, e.step, e.ribbons[k]!, a.ribbons[k]!, failures);
    }
  }

  return { ok: failures.length === 0, failures };
}
