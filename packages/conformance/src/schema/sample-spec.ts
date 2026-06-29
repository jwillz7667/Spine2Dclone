import { z } from 'zod';

// The committed sample-spec schema (conformance-and-ci.md A.4, WP-V.0). Sample times are NOT chosen
// per runtime: they live in one committed file per rig that every runtime (TS, Unity, Godot) reads,
// guaranteeing identical sampling (INV-3). This is the single source of truth for the times; nothing
// else in the codebase embeds them (phase-1-bone-puppet.md WP-1.12, TASK-1.12.2).
//
// `poseTimes` is the instantaneous-pose sample list: a mix of exact keyframe times, between-keyframe
// times that exercise interpolation and the bezier segment, and at least one time at or past
// `duration` to pin clamp-vs-loop behavior. `eventStep` (deterministic frame advance for event
// firing, A.4) is optional: it is omitted for rigs without events, such as `rig-2bone`, and arrives
// with the Phase 2 event rigs.
export const sampleSpecSchema = z
  .object({
    rigId: z.string().min(1),
    animation: z.string().min(1),
    duration: z.number().finite().nonnegative(),
    loop: z.boolean(),
    poseTimes: z.array(z.number().finite()).min(1),
    // The mesh attachments whose skinned + deformed world vertices are sampled at every poseTime (Phase 2,
    // FIX-2.RM / FIX-2.W / FIX-2.DF). Omitted for bone-only rigs (rig-2bone). Each names the (skin, slot,
    // attachment) triple; the generator records its positions per sample.
    meshes: z
      .array(
        z
          .object({
            skin: z.string().min(1),
            slot: z.string().min(1),
            attachment: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    eventStep: z
      .object({
        dt: z.number().finite().positive(),
        from: z.number().finite(),
        to: z.number().finite(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type SampleSpec = z.infer<typeof sampleSpecSchema>;

export class SampleSpecValidationError extends Error {
  override readonly name = 'SampleSpecValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`sample-spec failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateSampleSpec(input: unknown): SampleSpec {
  const result = sampleSpecSchema.safeParse(input);
  if (!result.success) throw new SampleSpecValidationError(result.error);
  return result.data;
}
