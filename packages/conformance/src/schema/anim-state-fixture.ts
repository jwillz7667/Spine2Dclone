import { z } from 'zod';

// The committed anim-state fixture schema (ADR-0005 conformance family). One fixture per scenario: the
// canonical solved output of replaying the scenario through runtime-core's AnimationState. Each captured
// sample records the per-bone world affine (blended crossfade / additive poses, the continuous contract,
// compared within the A.5 tolerance) and the per-slot active attachment name (the discrete greater-weight
// winner, compared with EXACT equality). Validate on import / fail loudly (Law 3).

// A 2x3 affine [a, b, c, d, tx, ty] (runtime-core math/affine layout), the same shape the skeletal
// fixtures store.
const affineSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

const sampleSchema = z
  .object({
    index: z.number().int().nonnegative(),
    // The accumulated advanced time at capture, a human-readable label (not compared numerically beyond
    // its committed value; the ordered call script is the actual contract).
    time: z.number().finite(),
    label: z.string().optional(),
    // World affines keyed by bone name, emitted in document order (parents precede children).
    bones: z.record(z.string(), affineSchema),
    // Active attachment name (or null) per slot, the discrete channel winner at this capture.
    slots: z.record(z.string(), z.string().nullable()),
  })
  .strict();

export const animStateFixtureSchema = z
  .object({
    scenarioId: z.string().min(1),
    rigId: z.string().min(1),
    scenarioHash: z.string().min(1),
    rigHash: z.string().min(1),
    coreVersion: z.string().min(1),
    toolchain: z.string().min(1),
    generatedBy: z.string().min(1),
    samples: z.array(sampleSchema).min(1),
  })
  .strict();

export type AnimStateAffine = z.infer<typeof affineSchema>;
export type AnimStateFixtureSample = z.infer<typeof sampleSchema>;
export type AnimStateFixture = z.infer<typeof animStateFixtureSchema>;

export class AnimStateFixtureValidationError extends Error {
  override readonly name = 'AnimStateFixtureValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`anim-state fixture failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateAnimStateFixture(input: unknown): AnimStateFixture {
  const result = animStateFixtureSchema.safeParse(input);
  if (!result.success) throw new AnimStateFixtureValidationError(result.error);
  return result.data;
}
