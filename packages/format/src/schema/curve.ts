import { z } from 'zod';

// Keyframe interpolation curve (handoff section 6 CurveType): the string literals 'linear' and
// 'stepped', or a cubic bezier easing. Bezier control x components (cx1, cx2) are constrained to
// [0, 1] so the easing remains a function of time (format-contract section 4.8); the y components
// (cy1, cy2) are unbounded finite to permit overshoot/anticipation. The x range violation is
// reported as CURVE_BEZIER_X_RANGE via a custom issue carrying `params.code`.
const bezierCurveSchema = z
  .object({
    type: z.literal('bezier'),
    cx1: z.number().finite(),
    cy1: z.number().finite(),
    cx2: z.number().finite(),
    cy2: z.number().finite(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const component of ['cx1', 'cx2'] as const) {
      const x = value[component];
      if (x < 0 || x > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [component],
          params: { code: 'CURVE_BEZIER_X_RANGE' },
          message: `bezier control ${component} must be in [0, 1], received ${x}`,
        });
      }
    }
  });

export const curveSchema = z.union([z.literal('linear'), z.literal('stepped'), bezierCurveSchema]);

export type CurveType = z.infer<typeof curveSchema>;
