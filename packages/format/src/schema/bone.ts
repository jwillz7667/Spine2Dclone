import { z } from 'zod';

// Bone transform inheritance mode (handoff section 6). The format stores it; runtime-core
// implements its effect on the world-transform pass; conformance locks the behavior.
export const transformModeSchema = z.enum([
  'normal',
  'onlyTranslation',
  'noRotationOrReflection',
  'noScale',
  'noScaleOrReflection',
]);

export type TransformMode = z.infer<typeof transformModeSchema>;

// A single bone in the skeleton (handoff section 6). `parent` is null for a root, otherwise the
// name of a bone that appears at a strictly lower index (the bone-ordering invariant, validated
// in the semantic layer, not here). `length` is non-negative (format-contract section 4.1);
// rotation and shear are in degrees; scale may be negative (encodes reflection).
export const boneSchema = z
  .object({
    name: z.string(),
    parent: z.string().nullable(),
    length: z.number().finite().nonnegative(),
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite(),
    scaleX: z.number().finite(),
    scaleY: z.number().finite(),
    shearX: z.number().finite(),
    shearY: z.number().finite(),
    transformMode: transformModeSchema,
  })
  .strict();

export type Bone = z.infer<typeof boneSchema>;
