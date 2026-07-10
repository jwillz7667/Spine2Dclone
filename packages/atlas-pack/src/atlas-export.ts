import { join } from 'node:path';
import { mapWithConcurrency } from './concurrency';
import { unsupportedTextureEncoder } from './encoder';
import { AtlasError } from './errors';
import { importSprites } from './import-sprites';
import {
  ATLAS_TARGETS_MANIFEST_FILE,
  ATLAS_TARGETS_MANIFEST_VERSION,
  atlasTargetsManifestSchema,
} from './manifest';
import { packAtlas } from './pack';
import { bytesSha256, encodePng } from './png';
import { premultiplyRgba } from './pma';
import { downsamplePage, resolveScaleVariants, scaleAtlasRef } from './scale';
import { trimSprite } from './trim';
import type { CompressedTextureTarget, TextureEncoder } from './encoder';
import type { AtlasFileStore } from './file-store';
import type {
  AtlasTargetsManifest,
  AtlasTargetsManifestPage,
  AtlasTargetsManifestVariant,
  CompressedArtifact,
  CompressionDiagnostic,
} from './manifest';
import type { PackConfig, PageBitmap } from './pack';
import type { AtlasRef } from '@marionette/format/types';

// The mobile-shipping atlas export (phase-5 WP-5.2 GPU remainder): the deterministic pack pipeline, plus
// the FIXED premultiplied-alpha policy, export-profile-driven scale variants, and the compressed-texture
// manifest with its (currently stubbed) encoder slot. It composes the same pure pieces the Phase 1
// `runAtlasPipeline` uses and reproduces its 1.0 geometry EXACTLY (the canonical AtlasRef is deep-equal);
// the root PNG PIXELS also match runAtlasPipeline when `premultipliedAlpha` is false, and are premultiplied
// (still fully deterministic, byte-identical across runs) when it is true. The variants and manifest are
// strictly additive. The canonical AtlasRef (1.0 geometry, AtlasPage.file at the root) remains the format
// contract reference (Law 3); everything compression/scale is sidecar.

export type TextureTransport = 'uastc-ktx2' | 'per-target-sidecar';

export interface AtlasExportOptions {
  // FIXED PMA policy (TASK-5.2.5). Default true: pages are emitted premultiplied so additive/screen blends
  // match across runtimes. Recorded in the manifest so a runtime picks the matching blend equations.
  readonly premultipliedAlpha?: boolean;
  // Scales to emit. MUST include 1.0 (the canonical page). Each must be in (0, 1] with an integer
  // reciprocal. Default [1] (canonical only). Downscales land in '@<scale>x' subfolders.
  readonly scaleVariants?: readonly number[];
  // The chosen texture transport (DECISION-5.2.b). Only recorded in the manifest here; no bytes are
  // produced until a real encoder is wired.
  readonly textureTransport?: TextureTransport;
  // Compressed GPU targets to request per page. Default [] (no compression requested).
  readonly compressionTargets?: readonly CompressedTextureTarget[];
  // The encoder slot. Defaults to the unsupported stub (DECISION-5.2.c) which records typed diagnostics.
  readonly encoder?: TextureEncoder;
}

export interface RunAtlasExportParams {
  readonly sourceDir: string;
  readonly outputDir: string;
  readonly fileStore: AtlasFileStore;
  readonly config?: PackConfig;
  readonly options?: AtlasExportOptions;
}

export interface AtlasExportResult {
  // The canonical AtlasRef (1.0 geometry, page files at the output-dir root). The format contract reference.
  readonly atlas: AtlasRef;
  // The validated non-contract manifest describing every variant page and compressed artifact/diagnostic.
  readonly manifest: AtlasTargetsManifest;
}

const JSON_INDENT = 2;
const MAX_ENCODE_CONCURRENCY = 4;

// Path of a variant page relative to the output dir: '' dir collapses to the root, so the 1.0 variant keeps
// the plain AtlasPage.file the contract references.
function variantPagePath(dir: string, file: string): string {
  return dir === '' ? file : `${dir}/${file}`;
}

// Compressed-artifact filename for a page + target under the chosen transport. Under uastc-ktx2 there is a
// SINGLE transcodable container per page (all targets share it); under per-target-sidecar each target has
// its own pre-baked file.
function compressedFileName(
  pageFile: string,
  target: CompressedTextureTarget,
  transport: TextureTransport,
): string {
  const base = pageFile.endsWith('.png') ? pageFile.slice(0, -'.png'.length) : pageFile;
  return transport === 'uastc-ktx2' ? `${base}.ktx2` : `${base}.${target}.ktx2`;
}

async function encodeCompressedArtifacts(
  page: PageBitmap,
  pngSha256: string,
  pageFileRel: string,
  targets: readonly CompressedTextureTarget[],
  transport: TextureTransport,
  premultipliedAlpha: boolean,
  encoder: TextureEncoder,
): Promise<{ compressed: CompressedArtifact[]; diagnostics: CompressionDiagnostic[] }> {
  const compressed: CompressedArtifact[] = [];
  const diagnostics: CompressionDiagnostic[] = [];
  for (const target of targets) {
    const result = await encoder.encode({ page, pngSha256, target, premultipliedAlpha });
    if (result.ok) {
      compressed.push({
        target,
        file: compressedFileName(pageFileRel, target, transport),
        encoder: result.fingerprint,
      });
    } else {
      diagnostics.push({ code: result.code, target: result.target, message: result.message });
    }
  }
  return { compressed, diagnostics };
}

export async function runAtlasExport(params: RunAtlasExportParams): Promise<AtlasExportResult> {
  const { sourceDir, outputDir, fileStore, config, options } = params;
  const premultipliedAlpha = options?.premultipliedAlpha ?? true;
  const transport: TextureTransport = options?.textureTransport ?? 'uastc-ktx2';
  const compressionTargets = options?.compressionTargets ?? [];
  const encoder = options?.encoder ?? unsupportedTextureEncoder;
  const variants = resolveScaleVariants(options?.scaleVariants ?? [1]);

  const imported = await importSprites(sourceDir, fileStore);
  const trimmed = imported.map((sprite) => {
    const trim = trimSprite(sprite.rgba, sprite.width, sprite.height);
    return {
      name: sprite.name,
      trimmedW: trim.trimmedW,
      trimmedH: trim.trimmedH,
      offsetX: trim.offsetX,
      offsetY: trim.offsetY,
      originalW: trim.originalW,
      originalH: trim.originalH,
      pixels: trim.pixels,
    };
  });

  const { atlas, pageBitmaps } = packAtlas(trimmed, config);

  // The base pages the variants derive from: premultiplied FIRST when PMA is on, so downsample averaging
  // runs in premultiplied space (correct order; avoids dark fringes).
  const baseBitmaps: PageBitmap[] = pageBitmaps.map((bitmap) =>
    premultipliedAlpha
      ? { ...bitmap, rgba: premultiplyRgba(bitmap.rgba, bitmap.width, bitmap.height) }
      : bitmap,
  );

  const manifestVariants: AtlasTargetsManifestVariant[] = [];
  for (const variant of variants) {
    const variantAtlas = scaleAtlasRef(atlas, variant.scale);
    const manifestPages: AtlasTargetsManifestPage[] = await mapWithConcurrency(
      variantAtlas.pages,
      MAX_ENCODE_CONCURRENCY,
      async (page, index): Promise<AtlasTargetsManifestPage> => {
        const base = baseBitmaps[index];
        if (base === undefined) {
          throw new AtlasError('ATLAS_INVALID_CONFIG', `missing base bitmap for page ${index}`);
        }
        const scaled = downsamplePage(base, variant.factor);
        if (scaled.width !== page.width || scaled.height !== page.height) {
          throw new AtlasError(
            'ATLAS_DIMENSION_MISMATCH',
            `variant ${variant.scale} page ${index}: pixels ${scaled.width}x${scaled.height} ` +
              `disagree with geometry ${page.width}x${page.height}`,
          );
        }
        const png = encodePng({ width: scaled.width, height: scaled.height, rgba: scaled.rgba });
        const pageFileRel = variantPagePath(variant.dir, page.file);
        await fileStore.writeBytes(join(outputDir, pageFileRel), png);
        const pngSha256 = bytesSha256(png);
        const { compressed, diagnostics } = await encodeCompressedArtifacts(
          scaled,
          pngSha256,
          pageFileRel,
          compressionTargets,
          transport,
          premultipliedAlpha,
          encoder,
        );
        return {
          file: pageFileRel,
          width: scaled.width,
          height: scaled.height,
          sourcePngSha256: pngSha256,
          compressed,
          diagnostics,
        };
      },
    );
    manifestVariants.push({ scale: variant.scale, dir: variant.dir, pages: manifestPages });
  }

  // resolveScaleVariants guarantees a non-empty, 1.0-first list, so the cast to the schema's nonempty tuple
  // is sound; assert it for the validator.
  const manifest = atlasTargetsManifestSchema.parse({
    manifestVersion: ATLAS_TARGETS_MANIFEST_VERSION,
    premultipliedAlpha,
    textureTransport: transport,
    variants: manifestVariants as [AtlasTargetsManifestVariant, ...AtlasTargetsManifestVariant[]],
  });

  const manifestJson = `${JSON.stringify(manifest, null, JSON_INDENT)}\n`;
  await fileStore.writeBytes(
    join(outputDir, ATLAS_TARGETS_MANIFEST_FILE),
    new TextEncoder().encode(manifestJson),
  );

  return { atlas, manifest };
}
