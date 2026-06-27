import { z } from 'zod';
import { rgbaSchema } from './color';

// Per-slot blend mode (handoff section 6).
export const blendModeSchema = z.enum(['normal', 'additive', 'multiply', 'screen']);

export type BlendMode = z.infer<typeof blendModeSchema>;

// A slot rides on a bone and shows at most one attachment in setup pose (handoff section 6).
// `bone` must name an existing bone and `attachment`, when non-null, must resolve in the default
// skin under this slot; both are referential checks done in the semantic layer. `darkColor` is an
// optional second tint channel: absent means single-color tint, which is NOT equivalent to black.
export const slotSchema = z
  .object({
    name: z.string(),
    bone: z.string(),
    color: rgbaSchema,
    darkColor: rgbaSchema.optional(),
    attachment: z.string().nullable(),
    blendMode: blendModeSchema,
  })
  .strict();

export type Slot = z.infer<typeof slotSchema>;
