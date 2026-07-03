import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_CONCURRENCY, importSprites } from './import-sprites';
import { createMemoryFileStore } from './memory-file-store';
import { makeSpritePng } from './synthetic';
import type { AtlasFileStore } from './file-store';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps a store so readBytes records how many reads are in flight at once, to assert the import cap.
function instrumentReads(store: AtlasFileStore): {
  store: AtlasFileStore;
  getMaxInFlight: () => number;
} {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    getMaxInFlight: () => maxInFlight,
    store: {
      listDir: (path) => store.listDir(path),
      writeBytes: (path, data) => store.writeBytes(path, data),
      readBytes: async (path) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(2);
        const bytes = await store.readBytes(path);
        inFlight -= 1;
        return bytes;
      },
    },
  };
}

describe('importSprites', () => {
  it('decodes every PNG and names regions by file base name, in sorted order', async () => {
    const store = createMemoryFileStore([
      [
        'assets/torso.png',
        makeSpritePng({
          width: 64,
          height: 128,
          contentX: 2,
          contentY: 4,
          contentW: 60,
          contentH: 120,
        }),
      ],
      [
        'assets/armL.png',
        makeSpritePng({
          width: 48,
          height: 96,
          contentX: 2,
          contentY: 3,
          contentW: 44,
          contentH: 90,
        }),
      ],
      ['assets/notes.txt', new Uint8Array([1, 2, 3])],
    ]);

    const imported = await importSprites('assets', store);

    expect(imported.map((s) => s.name)).toEqual(['armL', 'torso']);
    const torso = imported.find((s) => s.name === 'torso');
    expect(torso?.width).toBe(64);
    expect(torso?.height).toBe(128);
    expect(torso?.fileName).toBe('torso.png');
  });

  it('never exceeds the concurrency cap when importing many sprites', async () => {
    const seed: Array<readonly [string, Uint8Array]> = [];
    for (let i = 0; i < 200; i += 1) {
      const name = `sprite-${String(i).padStart(3, '0')}.png`;
      seed.push([
        `assets/${name}`,
        makeSpritePng({
          width: 16,
          height: 16,
          contentX: 1,
          contentY: 1,
          contentW: 14,
          contentH: 14,
          seed: i,
        }),
      ]);
    }
    const base = createMemoryFileStore(seed);
    const { store, getMaxInFlight } = instrumentReads(base);

    const imported = await importSprites('assets', store);

    expect(imported).toHaveLength(200);
    expect(getMaxInFlight()).toBeLessThanOrEqual(MAX_IMPORT_CONCURRENCY);
    // With 200 sprites the pool saturates exactly at the cap.
    expect(getMaxInFlight()).toBe(MAX_IMPORT_CONCURRENCY);
  });
});
