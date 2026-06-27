import { z } from 'zod';
import { animationSchema } from './animation';
import { atlasRefSchema } from './atlas';
import { boneSchema } from './bone';
import { skinSchema } from './skin';
import { slotSchema } from './slot';

// The root SkeletonDocument (handoff section 6), Phase-0 subset (phase-0-foundations.md WP-0.3).
//
// Closed (.strict()) so unknown keys fail as SCHEMA_SHAPE. `bones` is non-empty by structural rule
// (.min(1)): an empty bone array is SCHEMA_SHAPE, not a semantic error, and a single-bone document
// always has a root (format-contract section 5.1). `hash` is a 64-char lowercase hex digest or the
// empty string (an unhashed draft); a malformed-but-correctly-shaped hash that does not match the
// content is caught by the hash layer as HASH_MISMATCH, not here.
//
// The ikConstraints/transformConstraints/events fields and the ik/transform/deform/drawOrder/event
// animation timelines from the full handoff type are intentionally NOT in this Phase-0 root: they
// arrive with their validators in later phases (LAW 5), and adding them is a format MINOR bump with
// a tested migration (format-contract section 10.3).
export const skeletonDocumentSchema = z
  .object({
    formatVersion: z.string(),
    name: z.string().min(1),
    hash: z.string().regex(/^([0-9a-f]{64})?$/, 'hash must be 64 lowercase hex chars or empty'),
    bones: z.array(boneSchema).min(1),
    slots: z.array(slotSchema),
    skins: z.array(skinSchema),
    animations: z.record(z.string(), animationSchema),
    atlas: atlasRefSchema,
  })
  .strict();

export type SkeletonDocument = z.infer<typeof skeletonDocumentSchema>;
