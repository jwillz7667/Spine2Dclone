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
