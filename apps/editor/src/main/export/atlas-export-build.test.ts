import {
  ATLAS_TARGETS_MANIFEST_FILE,
  atlasTargetsManifestSchema,
} from '@marionette/atlas-pack';
import { createMemoryFileStore, makeSpritePng } from '@marionette/atlas-pack/testing';
import { describe, expect, it } from 'vitest';
import type { ExportProfile } from '../../shared';
import { atlasExportInputsFromProfile, runProfileAtlasExport } from './atlas-export-build';

// Unit tests for the pure profile-driven atlas-export core (the Electron dialog + node file store seam is
// not exercised here, mirroring buildProjectExport's test). A real tiny atlas is packed into an in-memory
// store, proving the variant pages + manifest land on disk and the compression diagnostics surface.

function profile(overrides: Partial<ExportProfile['atlasExport']> = {}): ExportProfile {
  return {
    exportProfileVersion: '1.0.0',
    atlasExport: {
      maxPageSize: 2048,
      padding: 2,
      allowRotation: true,
      blendBinning: true,
      textureTransport: 'uastc-ktx2',
      compressionTargets: ['astc6x6', 'bc7', 'etc2'],
      premultipliedAlpha: true,
      scaleVariants: [1, 0.5],
      ...overrides,
    },
    particleProfiles: {
      mobile: { maxLiveParticles: 600, ambientQualityTier: 'medium' },
      desktop: { maxLiveParticles: 2000, ambientQualityTier: 'high' },
    },
    coldStartBudgets: {
      unityIosNativeMs: 1500,
      webWarmFirstFrameMs: 1500,
      webColdInteractiveMs: 4000,
    },
  };
}

function seedStore(): ReturnType<typeof createMemoryFileStore> {
  return createMemoryFileStore([
    ['src/torso.png', makeSpritePng({ width: 16, height: 16, contentX: 2, contentY: 2, contentW: 10, contentH: 10 })],
    ['src/arm.png', makeSpritePng({ width: 12, height: 12, contentX: 1, contentY: 1, contentW: 8, contentH: 8, seed: 5 })],
  ]);
}

describe('atlasExportInputsFromProfile', () => {
  it('projects the atlasExport knobs into a PackConfig and AtlasExportOptions', () => {
    const { config, options } = atlasExportInputsFromProfile(profile());

    expect(config).toEqual({ maxPageSize: 2048, padding: 2, allowRotation: true });
    expect(options.textureTransport).toBe('uastc-ktx2');
    expect(options.compressionTargets).toEqual(['astc6x6', 'bc7', 'etc2']);
    expect(options.premultipliedAlpha).toBe(true);
    expect(options.scaleVariants).toEqual([1, 0.5]);
  });

  it('omits absent premultipliedAlpha / scaleVariants so runAtlasExport applies its defaults', () => {
    const bare = profile();
    // An older profile / the frozen ship asset omits both optional fields.
    delete (bare.atlasExport as { premultipliedAlpha?: boolean }).premultipliedAlpha;
    delete (bare.atlasExport as { scaleVariants?: readonly number[] }).scaleVariants;

    const { options } = atlasExportInputsFromProfile(bare);

    expect('premultipliedAlpha' in options).toBe(false);
    expect('scaleVariants' in options).toBe(false);
  });
});

describe('runProfileAtlasExport', () => {
  it('writes the canonical page, each downscale variant page, and the manifest to disk', async () => {
    const store = seedStore();

    const built = await runProfileAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      profile: profile({ scaleVariants: [1, 0.5] }),
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const canonical = built.result.atlas.pages;
    expect(canonical.length).toBeGreaterThanOrEqual(1);
    for (const page of canonical) {
      // 1.0 pages at the root; the 0.5 variant lands in the '@0.5x' subfolder.
      expect(store.has(`out/${page.file}`)).toBe(true);
      expect(store.has(`out/@0.5x/${page.file}`)).toBe(true);
    }

    expect(store.has(`out/${ATLAS_TARGETS_MANIFEST_FILE}`)).toBe(true);
    const onDisk = JSON.parse(
      new TextDecoder().decode(await store.readBytes(`out/${ATLAS_TARGETS_MANIFEST_FILE}`)),
    );
    expect(atlasTargetsManifestSchema.parse(onDisk)).toEqual(built.result.manifest);
    expect(built.result.manifest.variants.map((v) => v.scale)).toEqual([1, 0.5]);
  });

  it('surfaces the ATLAS_COMPRESSION_UNSUPPORTED diagnostics from the stub encoder (never swallowed)', async () => {
    const store = seedStore();

    const built = await runProfileAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      profile: profile({ scaleVariants: [1], compressionTargets: ['astc6x6', 'bc7'] }),
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // One diagnostic per requested target on the single page of the single (1.0) variant.
    expect(built.diagnostics).toHaveLength(2);
    expect(built.diagnostics.every((d) => d.code === 'ATLAS_COMPRESSION_UNSUPPORTED')).toBe(true);
    expect(built.diagnostics.map((d) => d.target).sort()).toEqual(['astc6x6', 'bc7']);
  });

  it('returns a typed failure carrying the AtlasError code for a corrupt source sprite', async () => {
    const store = createMemoryFileStore([['src/bad.png', new Uint8Array([1, 2, 3, 4])]]);

    const built = await runProfileAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      profile: profile(),
    });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.message).toContain('ATLAS_DECODE_FAILED');
  });
});
