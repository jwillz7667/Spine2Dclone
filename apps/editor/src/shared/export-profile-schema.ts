// The Export Profile schema (the THIRD store, phase-5-production-hardening.md section 4.1).
//
// This is NOT the undoable DocumentModel and NOT ephemeral Zustand editor state. It is a committed,
// versioned, schema-validated project artifact holding export and playback knobs only; it carries NO
// document data and has its OWN semver (exportProfileVersion), independent of
// SkeletonDocument.formatVersion (LAW 3 protection). Editing it is not a Command and is not undoable
// (LAW 2): it is project state, the concrete form of the section 4.1 "third store".
//
// It lives in the isomorphic editor-shared module (Zod-only, no node/electron) so it is the SINGLE
// source for BOTH the main process (validating the on-disk artifact) AND the renderer (typing and
// pre-validating the Export dialog's profile form). The main-process export-profile barrel re-exports it
// unchanged, so the phase-5 loader/persister and its tests keep the same public API.
//
// RECONCILIATION (deliberate, vs section 4.1 verbatim): section 4.1 names the atlas-knobs group
// `atlas`, but SkeletonDocument ALSO has a top-level `atlas` field. Sharing that name would make the
// TASK-5.0.5 / TASK-5.0.8 disjoint-field-names guard fail (the two stores must have no shared top-level
// key so they can never silently converge). We therefore name the profile's atlas-knobs group
// `atlasExport` here; every other field matches section 4.1 exactly.
import { z } from 'zod';

// Semver of THIS schema, validated by pattern. INDEPENDENT of SkeletonDocument.formatVersion.
const semver = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/, 'must be a semver string');

const deviceParticleProfile = z.object({
  // The Phase 3 per-scene MAX_LIVE_PARTICLES budget (section 8.8) for this profile.
  maxLiveParticles: z.number().int().positive(),
  // Phase 3 quality tier; scales spawn rate + maxParticles for ambient (deterministic:false) ONLY.
  ambientQualityTier: z.enum(['low', 'medium', 'high']),
});

export const exportProfileSchema = z
  .object({
    // Semver of THIS schema, INDEPENDENT of SkeletonDocument.formatVersion.
    exportProfileVersion: semver,
    // Atlas export knobs (named `atlasExport`, not `atlas`, per the reconciliation note above).
    atlasExport: z.object({
      maxPageSize: z.union([z.literal(2048), z.literal(4096)]),
      padding: z.number().int().min(0).max(8),
      allowRotation: z.boolean(),
      blendBinning: z.boolean(),
      // DECISION-5.2.b: 'uastc-ktx2' (single transcodable artifact, preferred) or
      // 'per-target-sidecar' (fallback).
      textureTransport: z.enum(['uastc-ktx2', 'per-target-sidecar']),
      // Transcode/encode targets used by whichever transport is chosen.
      compressionTargets: z.array(z.enum(['astc6x6', 'bc7', 'etc2'])).nonempty(),
    }),
    // Both keys REQUIRED. Scales AMBIENT effects only.
    particleProfiles: z.object({
      mobile: deviceParticleProfile,
      desktop: deviceParticleProfile,
    }),
    // Android has no native cold-start budget this phase (no Android native ship build); it is
    // throughput-gated only.
    coldStartBudgets: z.object({
      unityIosNativeMs: z.number().int().positive(),
      webWarmFirstFrameMs: z.number().int().positive(),
      webColdInteractiveMs: z.number().int().positive(),
    }),
  })
  // .strict() so unknown keys fail loudly, matching the format package's closed-object discipline.
  .strict();

export type ExportProfile = z.infer<typeof exportProfileSchema>;

// The compressed-texture targets exposed in the Export dialog's texture-variant selection. Mirrors the
// atlasExport.compressionTargets enum so the dialog offers exactly the targets the schema accepts.
export const COMPRESSION_TARGETS = ['astc6x6', 'bc7', 'etc2'] as const;
export type CompressionTarget = (typeof COMPRESSION_TARGETS)[number];
