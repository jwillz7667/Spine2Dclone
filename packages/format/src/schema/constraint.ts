import { z } from 'zod';

// Constraints (handoff section 6, format-contract section 4.7). First AUTHORED in Phase 2; the schema
// shapes are additive and gated by ADR-0004 (formatVersion 0.2.0 + migration). Value-range and arity
// faults that Zod can express are reported through custom issues carrying `params.code` so the
// structural mapper (validate/structural.ts) surfaces the exact FormatErrorCode, mirroring COLOR_RANGE
// and CURVE_BEZIER_X_RANGE. Referential faults (bone/target existence, chain continuity, name
// uniqueness) need the document graph and live in the semantic layer (validate/constraints.ts).

// A constraint mix factor is a finite number in [0, 1]. IK and transform constraints carry distinct
// codes (IK_MIX_RANGE vs TC_MIX_RANGE) so a reviewer sees which family a range fault came from. The
// same refinements apply to the animation ik/transform FRAMES (schema/animation.ts) so a keyed mix is
// range-checked exactly like a constraint definition (format-contract section 4.8).
export const ikMixSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'IK_MIX_RANGE' },
        message: `ik mix must be in [0, 1], received ${value}`,
      });
    }
  });

export const tcMixSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'TC_MIX_RANGE' },
        message: `transform-constraint mix must be in [0, 1], received ${value}`,
      });
    }
  });

// An IK constraint (handoff section 6): a 1 or 2 bone chain driven toward a target bone, with a blend
// `mix` and a `bendPositive` elbow/knee direction. `bones` arity (1 or 2) is IK_BONES_ARITY; the
// referential checks (bones/target exist, chain continuity) are semantic (validate/constraints.ts).
export const ikConstraintSchema = z
  .object({
    name: z.string(),
    bones: z.array(z.string()),
    target: z.string(),
    mix: ikMixSchema,
    bendPositive: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.bones.length < 1 || value.bones.length > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bones'],
        params: { code: 'IK_BONES_ARITY' },
        message: `ik constraint chain must have 1 or 2 bones, received ${value.bones.length}`,
      });
    }
  });

// A transform constraint (handoff section 6): drives a bone's six world channels from a target with a
// per-channel mix factor and an additive offset (solve semantics in ADR-0003). Offsets are unbounded
// finite numbers (in degrees for rotation/shear, world units for x/y, ratio for scale). Bone/target
// existence is semantic (validate/constraints.ts).
export const transformConstraintSchema = z
  .object({
    name: z.string(),
    bones: z.array(z.string()),
    target: z.string(),
    mixRotate: tcMixSchema,
    mixX: tcMixSchema,
    mixY: tcMixSchema,
    mixScaleX: tcMixSchema,
    mixScaleY: tcMixSchema,
    mixShearY: tcMixSchema,
    offsetRotation: z.number().finite(),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    offsetScaleX: z.number().finite(),
    offsetScaleY: z.number().finite(),
    offsetShearY: z.number().finite(),
  })
  .strict();

export type IkConstraint = z.infer<typeof ikConstraintSchema>;
export type TransformConstraint = z.infer<typeof transformConstraintSchema>;
