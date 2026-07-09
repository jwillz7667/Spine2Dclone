import { z } from 'zod';

// Constraints (handoff section 6, format-contract section 4.7). AUTHORED in Phase 2 (ADR-0004) and
// DEEPENED in stage F2 (ADR-0009, formatVersion 0.4.0): IK gains softness/stretch/compress/uniform and a
// signed bend direction that supersedes the Phase-2 `bendPositive` boolean; transform constraints gain
// `local`/`relative` variant flags; both arrays share an optional explicit `order`. Value-range and arity
// faults that Zod can express are reported through custom issues carrying `params.code` so the structural
// mapper (validate/structural.ts) surfaces the exact FormatErrorCode, mirroring COLOR_RANGE. Referential
// faults (bone/target existence, chain continuity, name uniqueness, order density) need the document graph
// and live in the semantic layer (validate/constraints.ts).

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

// The signed IK bend direction (ADR-0009 section 1.1): +1 or -1 selects which of the two mirror IK
// solutions (elbow/knee direction). A closed literal union, so any other value is SCHEMA_SHAPE and no
// dedicated code is needed. Supersedes the Phase-2 `bendPositive` boolean (migrated true -> +1,
// false -> -1). Reused by the animation IkFrame (schema/animation.ts).
export const bendDirectionSchema = z.union([z.literal(1), z.literal(-1)]);

// IK softness (ADR-0009 section 1.1): a NON-NEGATIVE world-unit distance from full extension at which the
// two-bone solve eases in. Zero (the migrated default) reproduces the hard solve. A negative value is
// IK_SOFTNESS_RANGE, a structural refinement mirroring the mix ranges. Reused by the IkFrame.
export const ikSoftnessSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'IK_SOFTNESS_RANGE' },
        message: `ik softness must be >= 0, received ${value}`,
      });
    }
  });

// The optional explicit constraint solve order (ADR-0009 section 1.3): a non-negative integer index into
// a single ordering over the combined ikConstraints + transformConstraints set. Its density/uniqueness
// across the whole set is a graph invariant checked in the semantic layer (CONSTRAINT_ORDER_INVALID); the
// per-field structural rule is only "non-negative integer".
export const constraintOrderSchema = z.number().int().finite().nonnegative();

// An IK constraint (handoff section 6, ADR-0009 section 1.1): a 1 or 2 bone chain driven toward a target
// bone, with a blend `mix`, a signed `bend` direction, and the depth controls softness/stretch/compress/
// uniform. `bones` arity (1 or 2) is IK_BONES_ARITY; the referential checks (bones/target exist, chain
// continuity, order density) are semantic (validate/constraints.ts).
export const ikConstraintSchema = z
  .object({
    name: z.string(),
    bones: z.array(z.string()),
    target: z.string(),
    mix: ikMixSchema,
    bend: bendDirectionSchema,
    softness: ikSoftnessSchema,
    stretch: z.boolean(),
    compress: z.boolean(),
    uniform: z.boolean(),
    order: constraintOrderSchema.optional(),
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

// A transform constraint (handoff section 6, ADR-0003, ADR-0009 section 1.2): drives a bone's six world
// channels from a target with a per-channel mix factor and an additive offset. The `local` and `relative`
// flags select the LOCAL-space and RELATIVE-offset variants (default false reproduces the ADR-0003 world,
// absolute behavior). Offsets are unbounded finite numbers (degrees for rotation/shear, world units for
// x/y, ratio for scale). Bone/target existence and order density are semantic (validate/constraints.ts).
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
    local: z.boolean(),
    relative: z.boolean(),
    order: constraintOrderSchema.optional(),
  })
  .strict();

export type IkConstraint = z.infer<typeof ikConstraintSchema>;
export type TransformConstraint = z.infer<typeof transformConstraintSchema>;
