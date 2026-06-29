import { z } from 'zod';
import { blendModeSchema } from '../../common';
import { lifeCurveNumberSchema, lifeCurveRgbSchema } from './life-curve';
import { rangeFSchema, vec2Schema } from './primitives';

// The three effect layer types (phase-3-vfx-particles.md section 8.1). Each is a closed (.strict())
// object so unknown keys fail as EFFECT_SCHEMA_SHAPE; the discriminated union below keys on `type`.
// Field names and enums are taken VERBATIM from section 8.1 and the section 10 command table; this is
// the reimplementation contract for the Phase 5 native runtimes.

// Spawn schedule (section 8.1). `rate` spawns continuously; `burst` spawns a single batch at a time;
// `bursts` is an ordered list of batches whose `atTime` values must strictly increase (semantic).
export const spawnConfigSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('rate'),
      particlesPerSecond: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('burst'),
      count: z.number().int().nonnegative(),
      atTime: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      mode: z.literal('bursts'),
      bursts: z
        .array(
          z
            .object({
              atTime: z.number().finite().nonnegative(),
              count: z.number().int().nonnegative(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
]);

export type SpawnConfig = z.infer<typeof spawnConfigSchema>;

// Spawn-position source (section 8.1). `point` is the origin; `line` samples a segment; `circle`
// samples a disc (or its edge); `rect` samples a centered box. The draw counts these shapes consume
// are pinned in the runtime-core per-particle draw order (section 8.3).
export const emitterShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('point') }).strict(),
  z
    .object({
      kind: z.literal('line'),
      x1: z.number().finite(),
      y1: z.number().finite(),
      x2: z.number().finite(),
      y2: z.number().finite(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('circle'),
      radius: z.number().finite().nonnegative(),
      edgeOnly: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rect'),
      width: z.number().finite().nonnegative(),
      height: z.number().finite().nonnegative(),
    })
    .strict(),
]);

export type EmitterShape = z.infer<typeof emitterShapeSchema>;

// Particle texture (section 8.1): a single static atlas region, or an animated sequence of regions
// played at `fps` in one of three modes. Region NAMES are resolved against the document atlas in the
// semantic layer (EFFECT_REGION_MISSING).
export const particleTextureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), region: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('animated'),
      regions: z.array(z.string().min(1)).min(1),
      fps: z.number().finite().positive(),
      mode: z.enum(['loop', 'overLife', 'once']),
    })
    .strict(),
]);

export type ParticleTexture = z.infer<typeof particleTextureSchema>;

// Optional per-particle streak attached to an emitter particle (section 8.1). The `region` resolves
// against the document atlas; `maxSegments` is a HARD pooled vertex budget.
export const trailSpecSchema = z
  .object({
    region: z.string().min(1),
    maxSegments: z.number().int().min(1),
    segmentSpacing: z.number().finite().positive(),
    widthOverLength: lifeCurveNumberSchema,
    alphaOverLength: lifeCurveNumberSchema,
  })
  .strict();

export type TrailSpec = z.infer<typeof trailSpecSchema>;

// EmitterLayer (section 8.1): the particle emitter. `maxParticles` is a HARD pool cap (mobile perf);
// `particleTrail` is an optional per-particle streak (null when absent).
export const emitterLayerSchema = z
  .object({
    type: z.literal('emitter'),
    name: z.string().min(1),
    blendMode: blendModeSchema,
    maxParticles: z.number().int().min(1),
    spawn: spawnConfigSchema,
    shape: emitterShapeSchema,
    lifetime: rangeFSchema,
    startSpeed: rangeFSchema,
    emissionAngle: rangeFSchema,
    startRotation: rangeFSchema,
    angularVelocity: rangeFSchema,
    startScale: rangeFSchema,
    gravity: vec2Schema,
    acceleration: vec2Schema,
    drag: z.number().finite().nonnegative(),
    scaleOverLife: lifeCurveNumberSchema,
    colorOverLife: lifeCurveRgbSchema,
    alphaOverLife: lifeCurveNumberSchema,
    texture: particleTextureSchema,
    particleTrail: trailSpecSchema.nullable(),
  })
  .strict();

export type EmitterLayer = z.infer<typeof emitterLayerSchema>;

// SpriteAnimatorLayer (section 8.1, 8.6): a single animated quad (god rays, glow blob, screen flash).
// `anchorSpace: 'screen'` covers the viewport (the flash); `'world'` places it at the resolved
// anchor. `rotationDegPerSec` spins continuously (not wrapped). No PRNG draws.
export const spriteAnimatorLayerSchema = z
  .object({
    type: z.literal('spriteAnimator'),
    name: z.string().min(1),
    blendMode: blendModeSchema,
    region: z.string().min(1),
    anchorSpace: z.enum(['world', 'screen']),
    rotationDegPerSec: z.number().finite(),
    scaleOverLife: lifeCurveNumberSchema,
    colorOverLife: lifeCurveRgbSchema,
    alphaOverLife: lifeCurveNumberSchema,
    loop: z.boolean(),
    layerDuration: z.number().finite().positive(),
  })
  .strict();

export type SpriteAnimatorLayer = z.infer<typeof spriteAnimatorLayerSchema>;

// RibbonTrailLayer (section 8.1, 8.6): a triangle-strip ribbon following a logical anchor resolved at
// trigger time. `maxSegments` is a HARD pooled vertex budget; over-LENGTH curves taper head to tail.
export const ribbonTrailLayerSchema = z
  .object({
    type: z.literal('ribbonTrail'),
    name: z.string().min(1),
    blendMode: blendModeSchema,
    region: z.string().min(1),
    anchorRef: z.string().min(1),
    maxSegments: z.number().int().min(1),
    segmentSpacing: z.number().finite().positive(),
    widthOverLength: lifeCurveNumberSchema,
    colorOverLength: lifeCurveRgbSchema,
    alphaOverLength: lifeCurveNumberSchema,
  })
  .strict();

export type RibbonTrailLayer = z.infer<typeof ribbonTrailLayerSchema>;

// The layer discriminated union (section 8.1): drawn in array order (z within the effect).
export const effectLayerSchema = z.discriminatedUnion('type', [
  emitterLayerSchema,
  spriteAnimatorLayerSchema,
  ribbonTrailLayerSchema,
]);

export type EffectLayer = z.infer<typeof effectLayerSchema>;
