import { z } from 'zod';
import { attachmentSchema } from './attachment';

// A skin maps slot name -> attachment name -> attachment (handoff section 6). The document must
// contain a skin named 'default' (semantic SKIN_DEFAULT_MISSING); every top-level key must be an
// existing slot name (semantic SKIN_SLOT_UNKNOWN). Both are referential checks in the semantic
// layer. The attachment NAME is the inner key; an attachment has no `name` field of its own.
export const skinSchema = z
  .object({
    name: z.string(),
    attachments: z.record(z.string(), z.record(z.string(), attachmentSchema)),
  })
  .strict();

export type Skin = z.infer<typeof skinSchema>;
