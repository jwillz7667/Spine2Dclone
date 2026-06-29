import { z } from 'zod';

// The committed particle expected-output fixture schema (phase-3-vfx-particles.md section 8.9, WP-3.10,
// TASK-3.10.6). A particle fixture is the canonical serialized result of running the runtime-core
// effects solve over an effects rig (a single EffectConfig) at a fixed simulationDt and seed, dumping
// the solved state at each sampled step. It is a NEW fixture SHAPE versus skeleton pose fixtures (which
// store bone affines over poseTimes): particles store per-step per-particle SoA rows.
//
// Validate on import / fail loudly (Law 3): a fixture that does not match this schema is rejected with a
// typed EffectsFixtureValidationError. The schema is `.strict()` everywhere so an unexpected member
// fails loudly until it is deliberately added.
//
// The integer/float split (section 8.9) is structural in the data layout, not just in the comparison:
//   EXACT (integer step schedule, portable across TS/C#/GDScript): liveCount, per-particle spawnOrder,
//     frame index, alive flag. No EXACT quantity is a float-threshold crossing (section 8.4), so a
//     last-ULP difference can never flip one of these one step early or late on a native runtime.
//   EPSILON (float, single tolerance table A.5): px, py, rot, outScale, outR, outG, outB, outAlpha.
// `anchorSpace: 'screen'` layers are EXCLUDED from the cross-runtime rig set (their solved transform is
// a function of viewport size, a non-portable render input); world/bone layers are fully covered.

// One live particle's solved state at a sampled step. The integer lanes (spawnOrder, frame, alive) are
// compared EXACT; the float lanes (px..outAlpha) on the epsilon path. Rows are emitted sorted by
// spawnOrder so the JSON key order is stable for diffs regardless of pool-slot iteration order.
const particleRowSchema = z
  .object({
    spawnOrder: z.number().int().nonnegative(), // EXACT: monotonic spawn counter (the conformance key)
    frame: z.number().int().nonnegative(), // EXACT: animated-frame index (integer arithmetic)
    alive: z.union([z.literal(0), z.literal(1)]), // EXACT: a row is recorded only while alive, so 1
    px: z.number().finite(), // EPSILON: float Euler position
    py: z.number().finite(),
    rot: z.number().finite(), // EPSILON: float rotation degrees
    outScale: z.number().finite(), // EPSILON: scaleOverLife output
    outR: z.number().finite(), // EPSILON: colorOverLife channels
    outG: z.number().finite(),
    outB: z.number().finite(),
    outAlpha: z.number().finite(), // EPSILON: alphaOverLife output
  })
  .strict();

export type ParticleRow = z.infer<typeof particleRowSchema>;

// One emitter layer's solved state at a sampled step: the EXACT live count plus the per-particle rows
// (one per live particle, sorted by spawnOrder). `layerName` ties the dump to the layer that produced it.
const emitterStateSchema = z
  .object({
    layerName: z.string().min(1),
    liveCount: z.number().int().nonnegative(), // EXACT
    particles: z.array(particleRowSchema),
  })
  .strict();

export type EmitterState = z.infer<typeof emitterStateSchema>;

// One sprite-animator layer's solved state at a sampled step (section 8.6). All float (epsilon path),
// no PRNG draws, plus the integer stepIndex (EXACT) so the local clock is locked. World-space sprites
// only; `anchorSpace: 'screen'` layers are excluded from the rig set.
const spriteStateSchema = z
  .object({
    layerName: z.string().min(1),
    stepIndex: z.number().int().nonnegative(), // EXACT: integer local clock
    rotationDeg: z.number().finite(), // EPSILON
    scale: z.number().finite(),
    alpha: z.number().finite(),
    r: z.number().finite(),
    g: z.number().finite(),
    b: z.number().finite(),
  })
  .strict();

export type SpriteState = z.infer<typeof spriteStateSchema>;

// One ribbon-trail layer's solved state at a sampled step (section 8.6). The vertex COUNT is EXACT
// (the ring buffer fill is integer-deterministic given the anchor path); the per-vertex geometry
// (vx, vy) and per-vertex alpha/color are on the epsilon path.
const ribbonVertexSchema = z
  .object({
    vx: z.number().finite(),
    vy: z.number().finite(),
    vAlpha: z.number().finite(),
    vR: z.number().finite(),
    vG: z.number().finite(),
    vB: z.number().finite(),
  })
  .strict();

export type RibbonVertex = z.infer<typeof ribbonVertexSchema>;

const ribbonStateSchema = z
  .object({
    layerName: z.string().min(1),
    vertexCount: z.number().int().nonnegative(), // EXACT
    vertices: z.array(ribbonVertexSchema),
  })
  .strict();

export type RibbonState = z.infer<typeof ribbonStateSchema>;

// One sampled step's full solved state across all of the effect's layers. `step` is the 1-based step
// index (the state AFTER the N-th stepOnce), matching the sample-spec snapshotSteps entry.
const effectsSampleSchema = z
  .object({
    step: z.number().int().positive(),
    emitters: z.array(emitterStateSchema),
    sprites: z.array(spriteStateSchema),
    ribbons: z.array(ribbonStateSchema),
  })
  .strict();

export type EffectsSample = z.infer<typeof effectsSampleSchema>;

export const effectsFixtureSchema = z
  .object({
    effectId: z.string().min(1),
    effectName: z.string().min(1), // the EffectConfig key the fixture was generated from
    rigHash: z.string().min(1), // sha256:<hex> of the effects rig file (provenance, A.3)
    specHash: z.string().min(1), // sha256:<hex> of the effects sample-spec
    seed: z.number().int().nonnegative(), // the deterministic trigger seed (section 8.3)
    simulationDt: z.number().finite().positive(),
    coreVersion: z.string().min(1), // provenance, not compared
    toolchain: z.string().min(1), // pinned generation toolchain id (A.7), e.g. node-22.13.1-v8
    generatedBy: z.string().min(1),
    // The committed PRNG golden vector reference (WP-3.10 acceptance): at least the first two nextU32
    // draws of the layer-0 stream hash32(seed, 0), so the integer stream is locked alongside the dump.
    // A regenerated fixture recomputes this from runtime-core; a drift here means the PRNG changed.
    prngStreamHead: z.array(z.number().int().nonnegative()).min(1),
    samples: z.array(effectsSampleSchema).min(1),
  })
  .strict();

export type EffectsFixture = z.infer<typeof effectsFixtureSchema>;

// Typed boundary error (Law 3): carries the Zod issues so a caller sees exactly which member of a
// malformed particle fixture failed.
export class EffectsFixtureValidationError extends Error {
  override readonly name = 'EffectsFixtureValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`effects fixture failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateEffectsFixture(input: unknown): EffectsFixture {
  const result = effectsFixtureSchema.safeParse(input);
  if (!result.success) throw new EffectsFixtureValidationError(result.error);
  return result.data;
}
