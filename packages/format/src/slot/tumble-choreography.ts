import { z } from 'zod';

// TumbleChoreography (format-contract section 15.3, section 15.6). MINIMAL-BUT-VALID shape only.
// WP-4.10 OWNS and GROWS this: the cascade sequencer extension, the drop solver, and the per-step
// rollup chain are WP-4.10's job and are NOT invented here. `tumble` is a CONDITIONAL member (section
// 15.6): the schema and the member are defined now so the envelope shape is stable, but the cascade
// authoring path is the conditional follow-on track. For non-cascade games `tumble` carries only timing
// defaults and is never exercised by a cascade.
//
// The rollup curve is stored as a closed enum string. The CLOSED enum mirrors the slot rollup CurveType
// owned by runtime-core/slot (format-contract section 15.3): the format validates the chosen member; the
// evaluation function lives in runtime-core so all runtimes share one definition. This is a DIFFERENT
// curve from the skeletal keyframe CurveType (linear/stepped/bezier).
export const rollupCurveSchema = z.enum(['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic']);

export type RollupCurve = z.infer<typeof rollupCurveSchema>;

// All durations are non-negative integer milliseconds (timing only; section 15.6).
const durationMs = z.number().int().nonnegative();

export const tumbleChoreographySchema = z
  .object({
    explodeMs: durationMs,
    dropMs: durationMs,
    dropEasing: rollupCurveSchema,
    refillStaggerMs: durationMs,
    settleMs: durationMs,
    stepGapMs: durationMs,
    rollupCurve: rollupCurveSchema,
  })
  .strict();

export type TumbleChoreography = z.infer<typeof tumbleChoreographySchema>;
