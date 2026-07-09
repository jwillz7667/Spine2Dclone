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
    // The slot names whose resolved blend mode + color are captured at every poseTime (PP-B1,
    // rig-blendmodes). Opt-in and order-preserving: a spec that omits it captures no slots, so every
    // pre-PP-B1 fixture regenerates byte-identically. Each name must be an existing slot; the generator
    // captures them in this order so the fixture diff reads one slot per line.
    slots: z.array(z.string().min(1)).optional(),
    // Capture the resolved render order (pose.drawOrder) at every poseTime (PP-B4, rig-events-draworder).
    // Opt-in: a spec that omits it captures no draw order, so every pre-PP-B4 fixture regenerates
    // byte-identically. The captured integer permutation is compared EXACT.
    captureDrawOrder: z.boolean().optional(),
    // The slot names whose resolved sequence FRAME INDEX is captured at every poseTime (PP-B5 slice 5,
    // rig-sequences). Opt-in and order-preserving: a spec that omits it captures no sequences, so every
    // pre-slice-5 fixture regenerates byte-identically. The captured integer frame is compared EXACT.
    captureSequences: z.array(z.string().min(1)).optional(),
    // Per-sample active skin for skin-scoped constraints (PP-B5 slice 7, rig-skin-scoped). Parallel to
    // poseTimes: `activeSkins[i]` is the active skin at `poseTimes[i]` (null = only the default skin). Opt-
    // in; a spec that omits it samples every frame with no active skin, so every pre-slice-7 fixture
    // regenerates byte-identically. When present it MUST have the same length as poseTimes (build-fixture).
    activeSkins: z.array(z.string().min(1).nullable()).optional(),
    // The clip attachments whose resolved clip state (world polygon + clipped slot set) is captured at every
    // poseTime (PP-B2, rig-clipping). Each names the (skin, slot, attachment) triple of a clipping attachment;
    // its `end` slot comes from the attachment. Opt-in; omitting it captures no clips, so pre-PP-B2 fixtures
    // regenerate byte-identically.
    clips: z
      .array(z.object({ skin: z.string().min(1), slot: z.string().min(1), attachment: z.string().min(1) }).strict())
      .optional(),
    // The bounding-box attachments whose world vertices and per-probe hit results are captured (PP-B2,
    // rig-hit-point). Opt-in.
    boxes: z
      .array(z.object({ skin: z.string().min(1), slot: z.string().min(1), attachment: z.string().min(1) }).strict())
      .optional(),
    // The world-space probe points each captured bounding box is hit-tested against (PP-B2), in order. Each
    // captured box records one boolean per probe. Required-with `boxes`; a spec that names boxes but no probes
    // captures an empty hit list per box (still valid, just uninformative).
    hitProbes: z.array(z.tuple([z.number().finite(), z.number().finite()])).optional(),
    // The point attachments whose resolved world position + rotation are captured (PP-B2, rig-hit-point).
    // Opt-in.
    points: z
      .array(z.object({ skin: z.string().min(1), slot: z.string().min(1), attachment: z.string().min(1) }).strict())
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
