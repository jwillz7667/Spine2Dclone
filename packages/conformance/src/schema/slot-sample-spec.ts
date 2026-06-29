import { z } from 'zod';

// The committed slot sample-spec schema (phase-4-slot-composer.md WP-4.13, implements conformance WP-V.5).
// It is the slot-track analogue of the effects sample-spec (A.4): one committed file per pair names the
// times at which the golden ALSO dumps `rollupValueAt` for every `counterRollup` directive, so the displayed
// win-counter integer is locked at those instants (not just the directive's [startMs, endMs] window).
//
// `pairId` ties the spec to its SLOT_PAIRS entry (the spin + scene). `sampleMs` is the strictly-increasing
// list of integer-ms instants at which each counterRollup directive is evaluated. The times are evaluated for
// EVERY counterRollup directive in the timeline (a pair with no counterRollup simply records no rollup
// samples). Integer ms only: the rollup math is pinned integer/fixed-point (runtime-core/slot rollup.ts), so a
// sample time is an integer the same on every runtime.
export const slotSampleSpecSchema = z
  .object({
    pairId: z.string().min(1),
    sampleMs: z.array(z.number().int().nonnegative()).min(1),
  })
  .strict()
  .superRefine((spec, ctx) => {
    // Strictly increasing (so the dump order is canonical and a duplicate/out-of-order time is a loud
    // authoring bug, not a silently shadowed sample).
    for (let i = 1; i < spec.sampleMs.length; i += 1) {
      if (spec.sampleMs[i]! <= spec.sampleMs[i - 1]!) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sampleMs', i],
          message: `sampleMs must be strictly increasing (${spec.sampleMs[i - 1]} >= ${spec.sampleMs[i]})`,
        });
      }
    }
  });

export type SlotSampleSpec = z.infer<typeof slotSampleSpecSchema>;

export class SlotSampleSpecValidationError extends Error {
  override readonly name = 'SlotSampleSpecValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`slot sample-spec failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateSlotSampleSpec(input: unknown): SlotSampleSpec {
  const result = slotSampleSpecSchema.safeParse(input);
  if (!result.success) throw new SlotSampleSpecValidationError(result.error);
  return result.data;
}
