import { describe, expect, it } from 'vitest';
import { createMemoryFileStore } from '../src/memory-file-store';
import { decodePng, decodedPagePixelHash } from '../src/png';
import { runAtlasPipeline } from '../src/pipeline';
import { trimSprite } from '../src/trim';
import { bytesEqual, cropRgba, defined, makeRgba, makeSpritePng } from '../src/synthetic';
import type { SyntheticSpriteSpec } from '../src/synthetic';

interface NamedSpec extends SyntheticSpriteSpec {
  readonly name: string;
}

const IDLE_SPRITES: readonly NamedSpec[] = [
  {
    name: 'torso',
    width: 64,
    height: 128,
    contentX: 2,
    contentY: 4,
    contentW: 60,
    contentH: 120,
    seed: 1,
  },
  {
    name: 'armL',
    width: 48,
    height: 96,
    contentX: 2,
    contentY: 3,
    contentW: 44,
    contentH: 90,
    seed: 2,
  },
  {
    name: 'armR',
    width: 48,
    height: 96,
    contentX: 2,
    contentY: 3,
    contentW: 44,
    contentH: 90,
    seed: 3,
  },
];

function seedSource(specs: readonly NamedSpec[]): Array<readonly [string, Uint8Array]> {
  return specs.map((spec) => [`src/${spec.name}.png`, makeSpritePng(spec)] as const);
}

describe('runAtlasPipeline', () => {
  it('emits an AtlasRef plus one PNG per page and resolves each page file', async () => {
    const store = createMemoryFileStore(seedSource(IDLE_SPRITES));

    const atlas = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: { maxPageSize: 128, padding: 2 },
    });

    expect(atlas.pages.length).toBeGreaterThanOrEqual(1);
    for (const page of atlas.pages) {
      expect(store.has(`out/${page.file}`)).toBe(true);
      const decoded = decodePng(await store.readBytes(`out/${page.file}`));
      expect(decoded.width).toBe(page.width);
      expect(decoded.height).toBe(page.height);
    }
    const allRegionNames = atlas.pages.flatMap((p) => p.regions.map((r) => r.name)).sort();
    expect(allRegionNames).toEqual(['armL', 'armR', 'torso']);
  });

  it('round-trips every region: cropping the page at (x,y,w,h) reproduces the trimmed source bitmap', async () => {
    const store = createMemoryFileStore(seedSource(IDLE_SPRITES));

    const atlas = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: store,
      config: { maxPageSize: 128, padding: 2 },
    });

    for (const page of atlas.pages) {
      const decoded = decodePng(await store.readBytes(`out/${page.file}`));
      for (const region of page.regions) {
        const spec = defined(
          IDLE_SPRITES.find((s) => s.name === region.name),
          `unknown region ${region.name}`,
        );
        const trimmed = trimSprite(makeRgba(spec), spec.width, spec.height);

        // The region carries the source trim metadata.
        expect(region.offsetX).toBe(trimmed.offsetX);
        expect(region.offsetY).toBe(trimmed.offsetY);
        expect(region.w).toBe(trimmed.trimmedW);
        expect(region.h).toBe(trimmed.trimmedH);
        expect(region.originalW).toBe(spec.width);
        expect(region.originalH).toBe(spec.height);

        const crop = cropRgba(decoded, region.x, region.y, region.w, region.h);
        expect(bytesEqual(crop, trimmed.pixels)).toBe(true);
      }
    }
  });

  it('is deterministic: two independent runs produce a deep-equal AtlasRef and equal decoded-page-pixel hashes', async () => {
    const storeA = createMemoryFileStore(seedSource(IDLE_SPRITES));
    const storeB = createMemoryFileStore(seedSource(IDLE_SPRITES));

    const atlasA = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: storeA,
      config: { maxPageSize: 128, padding: 2 },
    });
    const atlasB = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: storeB,
      config: { maxPageSize: 128, padding: 2 },
    });

    expect(atlasA).toEqual(atlasB);
    for (const page of atlasA.pages) {
      const hashA = decodedPagePixelHash(await storeA.readBytes(`out/${page.file}`));
      const hashB = decodedPagePixelHash(await storeB.readBytes(`out/${page.file}`));
      expect(hashA).toBe(hashB);
    }
  });

  it('produces a single page when content fits and multiple pages when it does not', async () => {
    const small = [IDLE_SPRITES[0]].filter((s): s is NamedSpec => s !== undefined);
    const oneStore = createMemoryFileStore(seedSource(small));
    const onePage = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: oneStore,
      config: { maxPageSize: 256, padding: 2 },
    });
    expect(onePage.pages).toHaveLength(1);

    const manyStore = createMemoryFileStore(seedSource(IDLE_SPRITES));
    const manyPages = await runAtlasPipeline({
      sourceDir: 'src',
      outputDir: 'out',
      fileStore: manyStore,
      config: { maxPageSize: 128, padding: 2 },
    });
    expect(manyPages.pages.length).toBeGreaterThan(1);
  });
});
