import { z } from 'zod';

// Constraints (handoff section 6, format-contract section 4.7). AUTHORED in Phase 2 (ADR-0004) and
// DEEPENED in stage F2 (ADR-0009, formatVersion 0.4.0): IK gains softness/stretch/compress/uniform and a
// signed bend direction that supersedes the Phase-2 `bendPositive` boolean; transform constraints gain
// `local`/`relative` variant flags; both arrays share an optional explicit `order`. Stage F3 (ADR-0011,
// formatVersion 0.5.0) ADDS a third constraint kind, the path constraint, which joins the shared `order`
// and name namespace. Value-range and arity faults that Zod can express are reported through custom issues
// carrying `params.code` so the structural mapper (validate/structural.ts) surfaces the exact
// FormatErrorCode, mirroring COLOR_RANGE. Referential faults (bone/target existence, chain continuity, name
// uniqueness, order density) need the document graph and live in the semantic layer (validate/constraints.ts,
// validate/paths.ts).

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

// A path-constraint mix factor is a finite number in [0, 1] (ADR-0011 section 2). It carries its own code
// (PATH_MIX_RANGE) so a range fault is attributed to the path family, mirroring IK_MIX_RANGE / TC_MIX_RANGE.
// The same refinement applies to the animation path FRAMES (schema/animation.ts).
export const pathMixSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PATH_MIX_RANGE' },
        message: `path-constraint mix must be in [0, 1], received ${value}`,
      });
    }
  });

// The path-constraint mode enums (ADR-0011 section 2). Closed literal unions, so an unknown member is
// SCHEMA_SHAPE and needs no dedicated code. `positionMode` reads `position` as an absolute arc length
// (fixed) or a [0,1] fraction (percent); `spacingMode` distributes bones by bone length, a fixed arc
// distance, a fraction of total length, or a proportional stretch-to-fit; `rotateMode` orients each bone
// to the tangent, toward the next bone (chain), or chain with length-preserving scale (chainScale).
export const pathPositionModeSchema = z.enum(['fixed', 'percent']);
export const pathSpacingModeSchema = z.enum(['length', 'fixed', 'percent', 'proportional']);
export const pathRotateModeSchema = z.enum(['tangent', 'chain', 'chainScale']);

// A path constraint (ADR-0011 section 2): distributes and orients a non-empty list of `bones` along the
// path attachment carried by the target SLOT (not a bone; a path lives on a slot). `position`/`spacing`/
// `offsetRotation` are unbounded finite values whose meaning depends on the modes; `mixRotate`/`mixX`/`mixY`
// are the three blend channels (a path constraint writes rotation and x/y translation only). `bones` must
// be non-empty (PATH_BONES_EMPTY); the referential checks (target slot exists and carries a path, bones
// resolve, order density) are semantic (validate/paths.ts, validate/constraints.ts).
export const pathConstraintSchema = z
  .object({
    name: z.string(),
    target: z.string(),
    bones: z.array(z.string()),
    positionMode: pathPositionModeSchema,
    spacingMode: pathSpacingModeSchema,
    rotateMode: pathRotateModeSchema,
    position: z.number().finite(),
    spacing: z.number().finite(),
    offsetRotation: z.number().finite(),
    mixRotate: pathMixSchema,
    mixX: pathMixSchema,
    mixY: pathMixSchema,
    order: constraintOrderSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.bones.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bones'],
        params: { code: 'PATH_BONES_EMPTY' },
        message: 'path constraint must drive at least one bone',
      });
    }
  });

export type IkConstraint = z.infer<typeof ikConstraintSchema>;
export type TransformConstraint = z.infer<typeof transformConstraintSchema>;
export type PathConstraint = z.infer<typeof pathConstraintSchema>;
export type PathPositionMode = z.infer<typeof pathPositionModeSchema>;
export type PathSpacingMode = z.infer<typeof pathSpacingModeSchema>;
export type PathRotateMode = z.infer<typeof pathRotateModeSchema>;
