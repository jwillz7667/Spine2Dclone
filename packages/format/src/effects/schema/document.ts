import { z } from 'zod';
import { atlasRefSchema } from '../../common';
import { effectBundleSchema } from './bundle';
import { effectConfigSchema } from './effect';

// The root EffectsDocument (phase-3-vfx-particles.md section 8.1): the sibling effects-library format,
// semver-versioned by `effectsFormatVersion` independently of the skeletal `formatVersion` (LAW 3,
// section 5). Closed (.strict()) so unknown keys fail as EFFECT_SCHEMA_SHAPE.
//
// `effects` is keyed by effect name (the name the sequencer references); `bundles` is keyed by bundle
// name. The map keys and the inner `name` fields are kept consistent by the semantic layer. `atlas`
// is the VFX atlas (coins, sparkles, rays, ribbons), usually a distinct pack from character atlases;
// it reuses the shared `AtlasRef` shape unchanged. `hash` is the content hash for runtime cache
// busting: a 64-char lowercase hex digest or the empty string (an unhashed draft), mirroring the
// skeletal format. A non-empty hash that does not match the recomputed content hash is caught by the
// hash layer as EFFECT_HASH_MISMATCH, not here.
export const effectsDocumentSchema = z
  .object({
    effectsFormatVersion: z.string(),
    name: z.string().min(1),
    hash: z.string().regex(/^([0-9a-f]{64})?$/, 'hash must be 64 lowercase hex chars or empty'),
    atlas: atlasRefSchema,
    effects: z.record(z.string(), effectConfigSchema),
    bundles: z.record(z.string(), effectBundleSchema),
  })
  .strict();

export type EffectsDocument = z.infer<typeof effectsDocumentSchema>;
