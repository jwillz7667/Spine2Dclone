import { describe, expect, it } from 'vitest';
import {
  ATLAS_TARGETS_MANIFEST_VERSION,
  atlasTargetsManifestSchema,
  type AtlasTargetsManifest,
} from '../src/manifest';

const VALID: AtlasTargetsManifest = {
  manifestVersion: ATLAS_TARGETS_MANIFEST_VERSION,
  premultipliedAlpha: true,
  textureTransport: 'uastc-ktx2',
  variants: [
    {
      scale: 1,
      dir: '',
      pages: [
        {
          file: 'atlas-0.png',
          width: 128,
          height: 128,
          sourcePngSha256: 'a'.repeat(64),
          compressed: [{ target: 'astc6x6', file: 'atlas-0.ktx2', encoder: 'basisu@1.16+abc' }],
          diagnostics: [],
        },
      ],
    },
    {
      scale: 0.5,
      dir: '@0.5x',
      pages: [
        {
          file: '@0.5x/atlas-0.png',
          width: 64,
          height: 64,
          sourcePngSha256: 'b'.repeat(64),
          compressed: [],
          diagnostics: [
            {
              code: 'ATLAS_COMPRESSION_UNSUPPORTED',
              target: 'bc7',
              message: 'no encoder wired',
            },
          ],
        },
      ],
    },
  ],
};

describe('atlasTargetsManifestSchema', () => {
  it('round-trips a valid manifest through JSON and re-validation', () => {
    const parsed = atlasTargetsManifestSchema.parse(VALID);
    const roundTripped = atlasTargetsManifestSchema.parse(JSON.parse(JSON.stringify(parsed)));

    expect(roundTripped).toEqual(VALID);
  });

  it('rejects an unknown top-level key (strict object)', () => {
    const result = atlasTargetsManifestSchema.safeParse({ ...VALID, extra: 1 });

    expect(result.success).toBe(false);
  });

  it('rejects a non-hex source sha256', () => {
    const bad = structuredClone(VALID);
    bad.variants[0]!.pages[0]!.sourcePngSha256 = 'not-a-hash';

    const result = atlasTargetsManifestSchema.safeParse(bad);

    expect(result.success).toBe(false);
  });

  it('rejects a compression target outside the enum', () => {
    const result = atlasTargetsManifestSchema.safeParse({
      ...VALID,
      variants: [
        {
          scale: 1,
          dir: '',
          pages: [
            {
              file: 'atlas-0.png',
              width: 1,
              height: 1,
              sourcePngSha256: 'c'.repeat(64),
              compressed: [{ target: 'etc1s', file: 'x', encoder: 'y' }],
              diagnostics: [],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty variants list', () => {
    const result = atlasTargetsManifestSchema.safeParse({ ...VALID, variants: [] });

    expect(result.success).toBe(false);
  });
});
