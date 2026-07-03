import { describe, expect, it } from 'vitest';
import { isAtlasError, runAtlasPipeline } from '@marionette/atlas-pack';
import { bytesEqual, createMemoryFileStore, makeSpritePng } from '@marionette/atlas-pack/testing';
import { REMBG_ENV, removeBackground, requireRembgConfig, resolveRembgConfig } from './rembg';

const MISSING_BIN = '/marionette/no/such/rembg-binary';

describe('rembg configuration (asset-prep, gated and fail-fast)', () => {
  it('resolveRembgConfig returns null when the env var is unset (background removal off)', () => {
    expect(resolveRembgConfig({})).toBeNull();
    expect(resolveRembgConfig({ [REMBG_ENV]: '   ' })).toBeNull();
  });

  it('resolveRembgConfig fails fast at boot when the env var points at nothing usable', () => {
    try {
      resolveRembgConfig({ [REMBG_ENV]: MISSING_BIN });
      throw new Error('expected resolveRembgConfig to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_REMBG_INVALID_BIN');
    }
  });

  it('requireRembgConfig throws ATLAS_REMBG_NOT_CONFIGURED when removal is requested but the env var is unset', () => {
    try {
      requireRembgConfig({});
      throw new Error('expected requireRembgConfig to throw');
    } catch (error) {
      expect(isAtlasError(error) && error.code).toBe('ATLAS_REMBG_NOT_CONFIGURED');
    }
  });

  it('with rembg requested but the binary absent, asset prep fails fast before any pack work', async () => {
    const store = createMemoryFileStore([
      [
        'src/torso.png',
        makeSpritePng({
          width: 16,
          height: 16,
          contentX: 1,
          contentY: 1,
          contentW: 14,
          contentH: 14,
        }),
      ],
    ]);
    let packReached = false;

    // The asset-prep gate validates rembg up front; it throws before the pipeline is ever invoked.
    await expect(
      (async () => {
        requireRembgConfig({ [REMBG_ENV]: MISSING_BIN });
        packReached = true;
        return runAtlasPipeline({ sourceDir: 'src', outputDir: 'out', fileStore: store });
      })(),
    ).rejects.toMatchObject({ code: 'ATLAS_REMBG_INVALID_BIN' });

    expect(packReached).toBe(false);
    expect(store.has('out/atlas-0.png')).toBe(false);
  });

  it('the deterministic pack pipeline is independent of rembg (succeeds even with a broken rembg config)', async () => {
    const store = createMemoryFileStore([
      [
        'src/torso.png',
        makeSpritePng({
          width: 16,
          height: 16,
          contentX: 1,
          contentY: 1,
          contentW: 14,
          contentH: 14,
        }),
      ],
    ]);
    const previous = process.env[REMBG_ENV];
    process.env[REMBG_ENV] = MISSING_BIN;
    try {
      const atlas = await runAtlasPipeline({
        sourceDir: 'src',
        outputDir: 'out',
        fileStore: store,
      });
      expect(atlas.pages).toHaveLength(1);
      expect(store.has('out/atlas-0.png')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env[REMBG_ENV];
      else process.env[REMBG_ENV] = previous;
    }
  });

  // The real spawn path uses a binary that copies stdin to stdout. /bin/cat satisfies that contract on
  // POSIX hosts, so we exercise the actual child-process plumbing without depending on a rembg install.
  it.skipIf(process.platform === 'win32')(
    'removeBackground streams a PNG through the configured binary (stdin to stdout)',
    async () => {
      const config = requireRembgConfig({ [REMBG_ENV]: '/bin/cat' });
      const png = makeSpritePng({
        width: 8,
        height: 8,
        contentX: 0,
        contentY: 0,
        contentW: 8,
        contentH: 8,
      });

      const output = await removeBackground(png, config);

      expect(bytesEqual(output, png)).toBe(true);
    },
  );
});
