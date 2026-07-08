import { z } from 'zod';
import { animationSchema } from './animation';
import { atlasRefSchema } from './atlas';
import { boneSchema } from './bone';
import { ikConstraintSchema, transformConstraintSchema } from './constraint';
import { eventDefSchema } from './event';
import { skeletonMetaSchema } from './metadata';
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
// Phase 2 (ADR-0004, formatVersion 0.2.0) ADDS `ikConstraints` and `transformConstraints` (REQUIRED
// arrays, empty when the rig has none) and the ik/transform/deform animation timelines (in
// animationSchema). A pre-0.2.0 document lacking these is migrated (empties injected), never silently
// widened. Stage F1 (ADR-0008, formatVersion 0.3.0) ADDS the `events` root collection (EventDef[],
// REQUIRED, empty when the rig defines none), the OPTIONAL `metadata` block, and the drawOrder/event
// animation timelines (in animationSchema). A pre-0.3.0 document lacking these is migrated (empties
// injected). Growing the format further is a MINOR bump with its own ADR and migration
// (format-contract section 10.3).
export const skeletonDocumentSchema = z
  .object({
    formatVersion: z.string(),
    name: z.string().min(1),
    hash: z.string().regex(/^([0-9a-f]{64})?$/, 'hash must be 64 lowercase hex chars or empty'),
    bones: z.array(boneSchema).min(1),
    slots: z.array(slotSchema),
    skins: z.array(skinSchema),
    ikConstraints: z.array(ikConstraintSchema),
    transformConstraints: z.array(transformConstraintSchema),
    events: z.array(eventDefSchema),
    animations: z.record(z.string(), animationSchema),
    atlas: atlasRefSchema,
    metadata: skeletonMetaSchema.optional(),
  })
  .strict();

export type SkeletonDocument = z.infer<typeof skeletonDocumentSchema>;
