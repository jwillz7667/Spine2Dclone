import { z } from 'zod';
import { attachmentSchema } from './attachment';

// A skin maps slot name -> attachment name -> attachment (handoff section 6). The document must
// contain a skin named 'default' (semantic SKIN_DEFAULT_MISSING); every top-level key must be an
// existing slot name (semantic SKIN_SLOT_UNKNOWN). Both are referential checks in the semantic
// layer. The attachment NAME is the inner key; an attachment has no `name` field of its own.
//
// Stage F2 (ADR-0009 section 5) ADDS the optional skin-scoping lists `bones` and `constraints`: names of
// bones and (ik or transform) constraints active only while this skin is active. Each name must resolve
// (semantic SKIN_BONE_UNKNOWN / SKIN_CONSTRAINT_UNKNOWN); a skin without scoping omits them.
export const skinSchema = z
  .object({
    name: z.string(),
    attachments: z.record(z.string(), z.record(z.string(), attachmentSchema)),
    bones: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
  })
  .strict();

export type Skin = z.infer<typeof skinSchema>;
