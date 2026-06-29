import { z } from 'zod';

// Effects-format scalar primitives (phase-3-vfx-particles.md section 8.1). These are owned by the
// effects format (NOT by the shared `common` sub-contract), so they live here.

// A closed numeric range. When `min === max` the value is a constant and consumes ZERO PRNG draws
// (section 8.3 draw order). `min <= max` is a semantic check (RANGE_MIN_GT_MAX), not a structural
// one, so the validator can point its JSON path at the offending node; both components are finite.
export const rangeFSchema = z
  .object({
    min: z.number().finite(),
    max: z.number().finite(),
  })
  .strict();

export type RangeF = z.infer<typeof rangeFSchema>;

// A 2D vector (gravity, acceleration, line endpoints). Both components finite.
export const vec2Schema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export type Vec2 = z.infer<typeof vec2Schema>;

// An RGB color in [0, 1] per channel; alpha is handled separately by `alphaOverLife`. The range
// violation is reported as the EFFECT_COLOR_RANGE refinement code (mirroring the skeletal COLOR_RANGE
// convention), so the structural mapper surfaces it precisely with the per-channel path.
export const rgbSchema = z
  .object({
    r: z.number().finite(),
    g: z.number().finite(),
    b: z.number().finite(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const channel of ['r', 'g', 'b'] as const) {
      const component = value[channel];
      if (component < 0 || component > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [channel],
          params: { code: 'EFFECT_COLOR_RANGE' },
          message: `color channel ${channel} must be in [0, 1], received ${component}`,
        });
      }
    }
  });

export type RGB = z.infer<typeof rgbSchema>;
