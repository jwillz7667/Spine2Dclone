import { z } from 'zod';

// WinSequenceConfig (format-contract section 15.3). MINIMAL-BUT-VALID shape only. WP-4.8 OWNS and GROWS
// this: the full WinSequenceStep union (rollup, symbol-win, vfx, camera, audio directives), the
// per-tier escalation, and the deterministic emit/sort are WP-4.8's job and are NOT invented here. The
// job of this minimal form is only to let the smallest-valid SlotScene validate and to give the
// validator a place to exercise the "every referenced VFX preset name resolves" rule.
//
// A step carries an optional `vfxPreset` name. When present, the validator checks it resolves to a
// refs.vfxPresets[].name (format-contract section 15.4). The full directive union arrives in WP-4.8.
export const winSequenceStepSchema = z
  .object({
    // Optional VFX preset this step fires; checked against refs.vfxPresets by the semantic layer.
    vfxPreset: z.string().min(1).optional(),
  })
  .strict();

export type WinSequenceStep = z.infer<typeof winSequenceStepSchema>;

// One named sequence is a (possibly empty) ordered list of steps. Keyed by sequence name (e.g. a tier
// label) in the parent record.
export const winSequenceSchema = z
  .object({
    steps: z.array(winSequenceStepSchema),
  })
  .strict();

export type WinSequence = z.infer<typeof winSequenceSchema>;

// Win-tier thresholds (running-total cutoffs that pick which sequence plays). Non-negative finite
// numbers; the full tier semantics (ordering, units) are pinned in WP-4.8.
const threshold = z.number().nonnegative().finite();

export const winSequenceConfigSchema = z
  .object({
    sequences: z.record(z.string(), winSequenceSchema),
    thresholds: z
      .object({
        big: threshold,
        mega: threshold,
        epic: threshold,
      })
      .strict(),
  })
  .strict();

export type WinSequenceConfig = z.infer<typeof winSequenceConfigSchema>;
