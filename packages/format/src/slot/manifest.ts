import { z } from 'zod';

// SlotProjectManifest (format-contract section 15.4 / phase-4 section 6.2, WP-4.4 TASK-4.4.5). A slot
// project on disk is N SkeletonDocument files (symbols, backgrounds), the Phase 3 VFX preset bundle,
// and exactly one SlotSceneDocument, plus this manifest listing every artifact with its content hash.
// The manifest is the integrity index: a member whose recomputed content hash differs from the listed
// `hash`, or a member listed but absent, is a typed error surfaced by the manifest validator.
//
// This is the SLOT project manifest (it lists a slotScene member); it is a separate version line from
// the effects ProjectManifest. The format package imports no Node built-ins, so the FS read stays at
// the caller boundary: the integrity step is parameterized by a resolver the caller supplies.
export const slotProjectMemberSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(['skeleton', 'effects', 'slotScene']),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'member hash must be 64 lowercase hex chars'),
  })
  .strict();

export type SlotProjectMember = z.infer<typeof slotProjectMemberSchema>;

export const slotProjectManifestSchema = z
  .object({
    projectFormatVersion: z.string(),
    name: z.string().min(1),
    members: z.array(slotProjectMemberSchema),
  })
  .strict();

export type SlotProjectManifest = z.infer<typeof slotProjectManifestSchema>;
