import { describe, expect, it } from 'vitest';
import { runAtlasExport } from '../src/atlas-export';
import { createMemoryFileStore } from '../src/memory-file-store';
import { ATLAS_TARGETS_MANIFEST_FILE, atlasTargetsManifestSchema } from '../src/manifest';
import { decodePng, encodePng } from '../src/png';
import { premultiplyRgba } from '../src/pma';
import type { TextureEncoder } from '../src/encoder';

// A solid, uniformly semi-transparent sprite so PMA changes the pixels (a fully-opaque sprite is a PMA
// no-op and could not distinguish the on/off pipelines).
function makeAlphaSpritePng(
  size: number,
  rgba: readonly [number, number, number, number],
): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = rgba[0];
    buf[i + 1] = rgba[1];
    buf[i + 2] = rgba[2];
    buf[i + 3] = rgba[3];
  }
  return encodePng({ width: size, height: size, rgba: buf });
}

function seedStore(): ReturnType<typeof createMemoryFileStore> {
  return createMemoryFileStore([
    ['src/torso.png', makeAlphaSpritePng(16, [200, 100, 50, 128])],
    ['src/arm.png', makeAlphaSpritePng(12, [40, 160, 240, 200])],
  ]);
}

const CONFIG = { maxPageSize: 128, padding: 2 } as const;

describe('runAtlasExport', () => {
  it('emits the canonical page at the root and a valid single-variant manifest by default', async () => {
    const store = seedStore();

    const { atlas, manifest } = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: CONFIG,
    });

    expect(atlas.pages.length).toBeGreaterThanOrEqual(1);
    for (const page of atlas.pages) expect(store.has(`out/${page.file}`)).toBe(true);

    // The manifest is written to disk and re-validates.
    expect(store.has(`out/${ATLAS_TARGETS_MANIFEST_FILE}`)).toBe(true);
    const onDisk = JSON.parse(
      new TextDecoder().decode(await store.readBytes(`out/${ATLAS_TARGETS_MANIFEST_FILE}`)),
    );
    expect(atlasTargetsManifestSchema.parse(onDisk)).toEqual(manifest);

    expect(manifest.premultipliedAlpha).toBe(true);
    expect(manifest.variants.map((v) => v.scale)).toEqual([1]);
  });

  it('premultiplies the emitted page pixels when PMA is on (page === premultiply(straight page))', async () => {
    const offStore = seedStore();
    const off = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: offStore,
      config: CONFIG,
      options: { premultipliedAlpha: false },
    });
    const onStore = seedStore();
    const on = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: onStore,
      config: CONFIG,
      options: { premultipliedAlpha: true },
    });

    expect(off.manifest.premultipliedAlpha).toBe(false);
    expect(on.manifest.premultipliedAlpha).toBe(true);

    for (const page of on.atlas.pages) {
      const offImg = decodePng(await offStore.readBytes(`out/${page.file}`));
      const onImg = decodePng(await onStore.readBytes(`out/${page.file}`));
      const expected = premultiplyRgba(offImg.rgba, offImg.width, offImg.height);
      expect(Array.from(onImg.rgba)).toEqual(Array.from(expected));
    }
  });

  it('writes downscaled variants into @<scale>x subfolders with half dimensions', async () => {
    const store = seedStore();

    const { atlas, manifest } = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: CONFIG,
      options: { scaleVariants: [1, 0.5, 0.25] },
    });

    expect(manifest.variants.map((v) => v.scale)).toEqual([1, 0.5, 0.25]);
    for (const page of atlas.pages) {
      expect(store.has(`out/${page.file}`)).toBe(true);
      expect(store.has(`out/@0.5x/${page.file}`)).toBe(true);
      expect(store.has(`out/@0.25x/${page.file}`)).toBe(true);

      const half = decodePng(await store.readBytes(`out/@0.5x/${page.file}`));
      expect(half.width).toBe(page.width / 2);
      expect(half.height).toBe(page.height / 2);
    }

    // Manifest variant geometry matches the scaled dimensions.
    const half = manifest.variants.find((v) => v.scale === 0.5);
    expect(half?.pages[0]?.width).toBe(atlas.pages[0]!.width / 2);
  });

  it('records a typed diagnostic per target when no encoder is wired (stub slot)', async () => {
    const store = seedStore();

    const { manifest } = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: CONFIG,
      options: { compressionTargets: ['astc6x6', 'bc7'] },
    });

    for (const variant of manifest.variants) {
      for (const page of variant.pages) {
        expect(page.compressed).toEqual([]);
        expect(page.diagnostics.map((d) => d.target)).toEqual(['astc6x6', 'bc7']);
        for (const d of page.diagnostics) expect(d.code).toBe('ATLAS_COMPRESSION_UNSUPPORTED');
      }
    }
  });

  it('records compressed artifacts when a real encoder is injected (uastc-ktx2: one container per page)', async () => {
    const fakeEncoder: TextureEncoder = {
      name: 'fake',
      encode: (input) =>
        Promise.resolve({
          ok: true,
          bytes: new Uint8Array([1, 2, 3]),
          fingerprint: `fake@1+${input.target}`,
        }),
    };
    const store = seedStore();

    const { manifest } = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: CONFIG,
      options: {
        compressionTargets: ['astc6x6', 'bc7'],
        textureTransport: 'uastc-ktx2',
        encoder: fakeEncoder,
      },
    });

    const page = manifest.variants[0]!.pages[0]!;
    expect(page.diagnostics).toEqual([]);
    // Both targets share the single .ktx2 container under uastc-ktx2.
    expect(page.compressed.map((c) => c.file)).toEqual([
      page.file.replace(/\.png$/, '.ktx2'),
      page.file.replace(/\.png$/, '.ktx2'),
    ]);
    expect(page.compressed.map((c) => c.target)).toEqual(['astc6x6', 'bc7']);
  });

  it('uses per-target sidecar filenames under the sidecar transport', async () => {
    const fakeEncoder: TextureEncoder = {
      name: 'fake',
      encode: (input) =>
        Promise.resolve({
          ok: true,
          bytes: new Uint8Array([1]),
          fingerprint: `fake@1+${input.target}`,
        }),
    };
    const store = seedStore();

    const { manifest } = await runAtlasExport({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: CONFIG,
      options: {
        compressionTargets: ['astc6x6', 'bc7'],
        textureTransport: 'per-target-sidecar',
        encoder: fakeEncoder,
      },
    });

    const page = manifest.variants[0]!.pages[0]!;
    const base = page.file.replace(/\.png$/, '');
    expect(page.compressed.map((c) => c.file)).toEqual([
      `${base}.astc6x6.ktx2`,
      `${base}.bc7.ktx2`,
    ]);
  });

  it('is deterministic: two runs produce byte-identical page files and manifest JSON', async () => {
    const run = async () => {
      const store = seedStore();
      await runAtlasExport({
        sourceDir: 'src',
        outputDir: 'out',
        fileStore: store,
        config: CONFIG,
        options: { scaleVariants: [1, 0.5], compressionTargets: ['astc6x6'] },
      });
      return store;
    };

    const a = await run();
    const b = await run();

    const files = [
      'out/atlas-0.png',
      'out/@0.5x/atlas-0.png',
      `out/${ATLAS_TARGETS_MANIFEST_FILE}`,
    ];
    for (const file of files) {
      expect(a.has(file)).toBe(true);
      expect(Array.from(await a.readBytes(file))).toEqual(Array.from(await b.readBytes(file)));
    }
  });

  it('rejects a scale-variant list missing 1.0', async () => {
    await expect(
      runAtlasExport({
        sourceDir: 'src',
        outputDir: 'out',
        fileStore: seedStore(),
        config: CONFIG,
        options: { scaleVariants: [0.5] },
      }),
    ).rejects.toMatchObject({ code: 'ATLAS_INVALID_SCALE' });
  });
});
