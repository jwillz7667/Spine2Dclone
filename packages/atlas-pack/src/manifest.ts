import { z } from 'zod';

// The NON-CONTRACT compressed-texture manifest, `atlas-targets.json` (phase-5 WP-5.2, TASK-5.2.6). It is
// deliberately OUTSIDE packages/format (Law 3: the atlas contract AtlasRef/AtlasPage/AtlasRegion does not
// change for compression or scale variants). It is a sidecar the export pipeline writes and a runtime reads
// to find, per canonical page, the scale variants on disk and any compressed artifacts (with their source
// PNG sha256 and encoder fingerprint). It has its OWN semver, independent of formatVersion. When no encoder
// is wired (DECISION-5.2.c) a page's `compressed` list is empty and its `diagnostics` explain why.

// Semver of THIS manifest shape, independent of formatVersion and exportProfileVersion.
export const ATLAS_TARGETS_MANIFEST_VERSION = '1.0.0';

const compressedTarget = z.enum(['astc6x6', 'bc7', 'etc2']);

const compressedArtifactSchema = z
  .object({
    target: compressedTarget,
    // Path relative to the atlas output dir, e.g. '@0.5x/atlas-0.astc6x6.ktx2'.
    file: z.string(),
    // Deterministic encoder fingerprint `<encoder>@<version>+<settings-hash>` (WP-5.2 R4).
    encoder: z.string(),
  })
  .strict();

const compressionDiagnosticSchema = z
  .object({
    code: z.literal('ATLAS_COMPRESSION_UNSUPPORTED'),
    target: compressedTarget,
    message: z.string(),
  })
  .strict();

const manifestPageSchema = z
  .object({
    // Path to the canonical PNG relative to the atlas output dir. '@1x' collapses to the root, so a 1.0
    // page is 'atlas-0.png' and a 0.5 page is '@0.5x/atlas-0.png'.
    file: z.string(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    // sha256 of the canonical PNG file bytes for this variant page (byte-identity anchor for a runtime).
    sourcePngSha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be a lowercase hex sha256'),
    compressed: z.array(compressedArtifactSchema),
    diagnostics: z.array(compressionDiagnosticSchema),
  })
  .strict();

const manifestVariantSchema = z
  .object({
    scale: z.number().positive().max(1),
    // Subfolder for this variant's pages ('' for the canonical 1.0 variant at the root).
    dir: z.string(),
    pages: z.array(manifestPageSchema),
  })
  .strict();

export const atlasTargetsManifestSchema = z
  .object({
    manifestVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'must be a semver string'),
    // The FIXED premultiplied-alpha policy the pages were emitted under (TASK-5.2.5). A runtime reads this
    // to choose straight vs premultiplied blend equations.
    premultipliedAlpha: z.boolean(),
    // The chosen texture transport (DECISION-5.2.b), recorded for the runtime loader.
    textureTransport: z.enum(['uastc-ktx2', 'per-target-sidecar']),
    variants: z.array(manifestVariantSchema).nonempty(),
  })
  .strict();

export type CompressedArtifact = z.infer<typeof compressedArtifactSchema>;
export type CompressionDiagnostic = z.infer<typeof compressionDiagnosticSchema>;
export type AtlasTargetsManifestPage = z.infer<typeof manifestPageSchema>;
export type AtlasTargetsManifestVariant = z.infer<typeof manifestVariantSchema>;
export type AtlasTargetsManifest = z.infer<typeof atlasTargetsManifestSchema>;

// The canonical manifest filename written next to the atlas pages.
export const ATLAS_TARGETS_MANIFEST_FILE = 'atlas-targets.json';
