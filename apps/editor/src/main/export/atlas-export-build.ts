import {
  isAtlasError,
  runAtlasExport,
  type AtlasExportOptions,
  type AtlasExportResult,
  type AtlasFileStore,
  type AtlasTargetsManifest,
  type CompressionDiagnostic,
  type PackConfig,
} from '@marionette/atlas-pack';
import type { ExportProfile } from '../../shared';

// The PURE profile-driven atlas-export core (WP-5.2 wiring): it projects the export profile's atlasExport
// knobs into the two inputs runAtlasExport consumes, runs the shipping-atlas pipeline (PMA policy, scale
// variants, compressed-texture manifest) into an injected AtlasFileStore, and returns a typed result with
// the compression diagnostics surfaced (never swallowed). It holds NO Electron and NO real filesystem, so
// it is unit-testable headless with an in-memory store, exactly like buildProjectExport. The Electron
// dialog + node file store live in export-atlas.ts.

export interface AtlasExportInputs {
  readonly config: PackConfig;
  readonly options: AtlasExportOptions;
}

// Map atlasExport -> { PackConfig, AtlasExportOptions }. `blendBinning` has no PackConfig consumer in
// atlas-pack (the packer bins nothing today), so it is intentionally not projected; every other field maps
// straight through. Absent premultipliedAlpha / scaleVariants are omitted so runAtlasExport applies its own
// documented defaults (true / [1]) rather than being forced to a value (exactOptionalPropertyTypes).
export function atlasExportInputsFromProfile(profile: ExportProfile): AtlasExportInputs {
  const atlas = profile.atlasExport;
  const config: PackConfig = {
    maxPageSize: atlas.maxPageSize,
    padding: atlas.padding,
    allowRotation: atlas.allowRotation,
  };
  const options: AtlasExportOptions = {
    textureTransport: atlas.textureTransport,
    compressionTargets: atlas.compressionTargets,
    ...(atlas.premultipliedAlpha === undefined
      ? {}
      : { premultipliedAlpha: atlas.premultipliedAlpha }),
    ...(atlas.scaleVariants === undefined ? {} : { scaleVariants: atlas.scaleVariants }),
  };
  return { config, options };
}

export type AtlasExportBuildResult =
  | {
      readonly ok: true;
      readonly result: AtlasExportResult;
      // Flattened compression diagnostics across every variant page (the ATLAS_COMPRESSION_UNSUPPORTED
      // records the stubbed encoder emits). Surfaced so the caller can report them, never hidden.
      readonly diagnostics: readonly CompressionDiagnostic[];
    }
  | { readonly ok: false; readonly message: string };

export interface RunProfileAtlasExportParams {
  readonly sourceDir: string;
  readonly outputDir: string;
  readonly fileStore: AtlasFileStore;
  readonly profile: ExportProfile;
}

export async function runProfileAtlasExport(
  params: RunProfileAtlasExportParams,
): Promise<AtlasExportBuildResult> {
  const { config, options } = atlasExportInputsFromProfile(params.profile);
  try {
    const result = await runAtlasExport({
      sourceDir: params.sourceDir,
      outputDir: params.outputDir,
      fileStore: params.fileStore,
      config,
      options,
    });
    return { ok: true, result, diagnostics: collectDiagnostics(result.manifest) };
  } catch (error) {
    // atlas-pack throws a typed AtlasError carrying a stable code; surface the code so the report is
    // actionable, mirroring the atlas-import seam.
    if (isAtlasError(error)) {
      return { ok: false, message: `atlas export failed (${error.code}): ${error.message}` };
    }
    const message = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `atlas export failed: ${message}` };
  }
}

function collectDiagnostics(manifest: AtlasTargetsManifest): CompressionDiagnostic[] {
  const diagnostics: CompressionDiagnostic[] = [];
  for (const variant of manifest.variants) {
    for (const page of variant.pages) {
      diagnostics.push(...page.diagnostics);
    }
  }
  return diagnostics;
}
