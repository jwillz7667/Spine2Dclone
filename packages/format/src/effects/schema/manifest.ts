import { z } from 'zod';

// ProjectManifest (phase-3-vfx-particles.md section 5.2): the thin manifest that binds the separately
// valid project artifacts (the skeleton, the effects library, and in Phase 4 the slot scene). Each
// member lists its on-disk path, its `kind`, and its expected content `hash`. The manifest is the
// integrity index: a member whose recomputed content hash differs from the listed `hash`, or a member
// listed but absent, is a typed error surfaced by the manifest validator (section 8.1, WP-3.0
// TASK-3.0.6). Versioned by `projectFormatVersion`, independent of both other version lines.
export const projectMemberSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(['skeleton', 'effects']),
    hash: z.string().regex(/^[0-9a-f]{64}$/, 'member hash must be 64 lowercase hex chars'),
  })
  .strict();

export type ProjectMember = z.infer<typeof projectMemberSchema>;

export const projectManifestSchema = z
  .object({
    projectFormatVersion: z.string(),
    name: z.string().min(1),
    members: z.array(projectMemberSchema),
  })
  .strict();

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
