import { z } from 'zod';

// Constraints (handoff section 6, format-contract section 4.7). AUTHORED in Phase 2 (ADR-0004) and
// DEEPENED in stage F2 (ADR-0009, formatVersion 0.4.0): IK gains softness/stretch/compress/uniform and a
// signed bend direction that supersedes the Phase-2 `bendPositive` boolean; transform constraints gain
// `local`/`relative` variant flags; both arrays share an optional explicit `order`. Stage F3 (ADR-0011,
// formatVersion 0.5.0) ADDS a third constraint kind, the path constraint, which joins the shared `order`
// and name namespace. Stage F4 (ADR-0014, formatVersion 0.6.0) ADDS a fourth constraint kind, the physics
// constraint (a per-bone damped spring over selected channels), plus the OPTIONAL skeleton physics settings
// block; physics joins the same `order` and name namespace. Value-range and arity faults that Zod can
// express are reported through custom issues carrying `params.code` so the structural mapper
// (validate/structural.ts) surfaces the exact FormatErrorCode, mirroring COLOR_RANGE. Referential faults
// (bone/target existence, chain continuity, name uniqueness, order density) need the document graph and live
// in the semantic layer (validate/constraints.ts, validate/paths.ts, validate/physics.ts).

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

// A physics-constraint mix factor is a finite number in [0, 1] (ADR-0014 section 1). It carries its own
// code (PHYSICS_MIX_RANGE) so a range fault is attributed to the physics family, mirroring the other mix
// ranges. The same refinement applies to the skeleton physics settings block and the animation physics
// FRAMES (schema/animation.ts).
export const physicsMixSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_MIX_RANGE' },
        message: `physics mix must be in [0, 1], received ${value}`,
      });
    }
  });

// Physics inertia (ADR-0014 section 1): the follow-through factor in [0, 1]. 0 tracks the pose rigidly, 1
// lags fully then springs to catch up. PHYSICS_INERTIA_RANGE guards the range (definition and frame).
export const physicsInertiaSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_INERTIA_RANGE' },
        message: `physics inertia must be in [0, 1], received ${value}`,
      });
    }
  });

// Physics damping (ADR-0014 section 1): the per-step velocity retention in [0, 1]. 1 is undamped, 0 is dead.
// PHYSICS_DAMPING_RANGE guards the range (definition and frame).
export const physicsDampingSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0 || value > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_DAMPING_RANGE' },
        message: `physics damping must be in [0, 1], received ${value}`,
      });
    }
  });

// Physics strength (ADR-0014 section 1): a NON-NEGATIVE spring stiffness. 0 is a free channel (no restoring
// force). A negative (repelling, unstable) spring is PHYSICS_STRENGTH_RANGE, mirroring IK_SOFTNESS_RANGE.
export const physicsStrengthSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_STRENGTH_RANGE' },
        message: `physics strength must be >= 0, received ${value}`,
      });
    }
  });

// Physics mass (ADR-0014 section 1): a STRICTLY POSITIVE inertial mass (external force -> acceleration is
// force / mass). Zero or negative is PHYSICS_MASS_RANGE (a division by zero or a sign flip).
export const physicsMassSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_MASS_RANGE' },
        message: `physics mass must be > 0, received ${value}`,
      });
    }
  });

// Physics step (ADR-0014 section 1, 2.2): the STRICTLY POSITIVE fixed simulation timestep in seconds (the
// integer-step-clock anchor; authoring default 1/60). Zero or negative has no valid clock: PHYSICS_STEP_RANGE.
export const physicsStepSchema = z
  .number()
  .finite()
  .superRefine((value, ctx) => {
    if (value <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        params: { code: 'PHYSICS_STEP_RANGE' },
        message: `physics step must be > 0, received ${value}`,
      });
    }
  });

// The simulated bone-channel set (ADR-0014 section 1). A closed literal union over the bone's local pose
// properties (matching schema/bone.ts), so an unknown member is SCHEMA_SHAPE and needs no dedicated code.
// scaleY and shearY are deliberately out of the v1 set (ADR-0014 Alternatives).
export const physicsChannelSchema = z.enum(['x', 'y', 'rotation', 'scaleX', 'shearX']);

// A physics constraint (ADR-0014 section 1): binds to ONE `bone` (both the driven bone and its own setpoint
// reference) and simulates a non-empty, unique subset of that bone's local channels as a damped-driven
// spring toward the animated pose. `step`/`inertia`/`strength`/`damping`/`mass`/`mix` are the model
// parameters (ranges above); `wind`/`gravity` are unbounded finite world-force inputs. `channels` non-empty
// is PHYSICS_CHANNELS_EMPTY and a repeat is PHYSICS_CHANNEL_DUPLICATE (both structural refinements in the
// CONSTRAINT family, mirroring PATH_BONES_EMPTY); the bone reference and order density are semantic
// (validate/physics.ts, validate/constraints.ts). Physics joins the shared name and `order` namespace,
// which now spans the ik, transform, path, and physics arrays (ADR-0014 section 4).
export const physicsConstraintSchema = z
  .object({
    name: z.string(),
    bone: z.string(),
    channels: z.array(physicsChannelSchema),
    step: physicsStepSchema,
    inertia: physicsInertiaSchema,
    strength: physicsStrengthSchema,
    damping: physicsDampingSchema,
    mass: physicsMassSchema,
    wind: z.number().finite(),
    gravity: z.number().finite(),
    mix: physicsMixSchema,
    order: constraintOrderSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.channels.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['channels'],
        params: { code: 'PHYSICS_CHANNELS_EMPTY' },
        message: 'physics constraint must simulate at least one channel',
      });
      return;
    }
    const seen = new Set<string>();
    for (const [index, channel] of value.channels.entries()) {
      if (seen.has(channel)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['channels', index],
          params: { code: 'PHYSICS_CHANNEL_DUPLICATE' },
          message: `physics channel "${channel}" is listed more than once`,
        });
      } else {
        seen.add(channel);
      }
    }
  });

// The OPTIONAL skeleton-level physics settings block (ADR-0014 section 5): global `gravity`/`wind` world
// defaults ADDED to each constraint's values and a master `mix` MULTIPLIED into each constraint's mix. The
// three fields are REQUIRED WITHIN the block (a total shape); the block itself is optional (absent means
// gravity 0, wind 0, mix 1). `mix` reuses PHYSICS_MIX_RANGE.
export const physicsSettingsSchema = z
  .object({
    gravity: z.number().finite(),
    wind: z.number().finite(),
    mix: physicsMixSchema,
  })
  .strict();

export type IkConstraint = z.infer<typeof ikConstraintSchema>;
export type TransformConstraint = z.infer<typeof transformConstraintSchema>;
export type PathConstraint = z.infer<typeof pathConstraintSchema>;
export type PathPositionMode = z.infer<typeof pathPositionModeSchema>;
export type PathSpacingMode = z.infer<typeof pathSpacingModeSchema>;
export type PathRotateMode = z.infer<typeof pathRotateModeSchema>;
export type PhysicsConstraint = z.infer<typeof physicsConstraintSchema>;
export type PhysicsChannel = z.infer<typeof physicsChannelSchema>;
export type PhysicsSettings = z.infer<typeof physicsSettingsSchema>;
