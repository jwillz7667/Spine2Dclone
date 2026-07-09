import { z } from 'zod';

// RGBA color. Each channel is finite and in [0, 1] inclusive (format-contract section 4.1).
// The range violation is reported as the COLOR_RANGE refinement code, not a generic SCHEMA_SHAPE,
// so the structural mapper (validate/structural.ts) can surface it precisely. The custom issue
// carries `params.code` for that mapping; the per-channel `path` points at the offending channel.
export const rgbaSchema = z
  .object({
    r: z.number().finite(),
    g: z.number().finite(),
    b: z.number().finite(),
    a: z.number().finite(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const channel of ['r', 'g', 'b', 'a'] as const) {
      const component = value[channel];
      if (component < 0 || component > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [channel],
          params: { code: 'COLOR_RANGE' },
          message: `color channel ${channel} must be in [0, 1], received ${component}`,
        });
      }
    }
  });

export type RGBA = z.infer<typeof rgbaSchema>;

// RGB color (no alpha), for the split slot-color track (ADR-0009 section 4.2). Each channel is finite
// and in [0, 1]; a range violation is COLOR_RANGE, the same refinement as rgbaSchema so the split and
// joint color tracks report identically. Used by the animation `rgb` timeline value.
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
          params: { code: 'COLOR_RANGE' },
          message: `color channel ${channel} must be in [0, 1], received ${component}`,
        });
      }
    }
  });

export type RGB = z.infer<typeof rgbSchema>;

// A single alpha channel in [0, 1], for the split slot-alpha track (ADR-0009 section 4.2). Modeled as
// a finite number with the COLOR_RANGE refinement so an out-of-range alpha reports like a color channel.
export const alphaChannelSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'COLOR_RANGE' },
        message: `alpha must be in [0, 1], received ${value}`,
      });
    }
  });
