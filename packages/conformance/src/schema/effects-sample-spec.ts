import { z } from 'zod';

// The committed effects sample-spec schema (phase-3-vfx-particles.md section 8.9, WP-3.10). It mirrors
// the skeletal sample-spec (A.4): the sampling window lives in one committed file per effect rig that
// every runtime (TS, Unity, Godot) reads, so particle state is dumped at IDENTICAL fixed-dt steps
// everywhere (INV-3). This is the single source of truth for the seed, the fixed simulation dt, the
// step count, and which steps to snapshot; nothing else embeds them.
//
// `effectName` selects the EffectConfig (by its document key) from the committed effects rig (a full
// EffectsDocument, validated via the format contract). `seed` is the deterministic trigger seed
// (section 8.3, used as hash32(seed, layerIndex) per layer). `qualityTier` is fixed at 'high', the
// reference tier (section 7.3): deterministic effects ignore tier scaling anyway, but the field is
// recorded so the contract is explicit and Unity/Godot generate at the same tier. `simulationDt` is the
// fixed sim step in seconds (it must equal the effect's own simulationDt; the generator asserts this so
// a spec cannot silently sample at a different cadence than the effect solves at). `steps` is the total
// number of fixed-dt steps to advance; `snapshotSteps` is the strictly-increasing list of 1-based step
// indices whose solved state is recorded (a step index of N means the state AFTER the N-th stepOnce).
export const effectsSampleSpecSchema = z
  .object({
    effectName: z.string().min(1),
    seed: z.number().int().nonnegative(),
    qualityTier: z.literal('high'),
    simulationDt: z.number().finite().positive(),
    steps: z.number().int().positive(),
    snapshotSteps: z.array(z.number().int().positive()).min(1),
  })
  .strict();

export type EffectsSampleSpec = z.infer<typeof effectsSampleSpecSchema>;

export class EffectsSampleSpecValidationError extends Error {
  override readonly name = 'EffectsSampleSpecValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`effects sample-spec failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateEffectsSampleSpec(input: unknown): EffectsSampleSpec {
  const result = effectsSampleSpecSchema.safeParse(input);
  if (!result.success) throw new EffectsSampleSpecValidationError(result.error);
  return result.data;
}
