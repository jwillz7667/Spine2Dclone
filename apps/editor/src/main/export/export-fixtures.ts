import { computeContentHash } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { encodePng, type DecodedImage } from '@marionette/atlas-pack';
import type { AtlasImportPage } from '../../shared';

// Test-only fixtures for the export handler suites (imported by the *.test.ts files only). A minimal but
// VALID SkeletonDocument (one bone, one region slot, one 'spin' animation, one 16x16 atlas page) plus the
// matching atlas page bytes, so the pure export cores can be exercised end to end without Electron. The
// shape mirrors render-preview's media-scenarios spinDocument; the hash is computed so validateDocument
// with verifyHash:true accepts it (project export re-validates on the way to disk).

function rawSpinDocument(): Record<string, unknown> {
  const rotateKey = (time: number, angle: number): unknown => ({
    time,
    value: { angle },
    curve: 'linear',
  });
  return {
    formatVersion: '0.2.0',
    name: 'export-spin',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 50,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 's',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'img',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          s: {
            img: {
              type: 'region',
              path: 'img',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 16,
              height: 16,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    animations: {
      spin: {
        duration: 1,
        bones: { root: { rotate: [rotateKey(0, 0), rotateKey(0.5, 90), rotateKey(1, 180)] } },
        slots: {},
        ik: {},
        transform: {},
        deform: {},
      },
    },
    atlas: {
      pages: [
        {
          file: 'spin.png',
          width: 16,
          height: 16,
          regions: [
            {
              name: 'img',
              x: 0,
              y: 0,
              w: 16,
              h: 16,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 16,
              originalH: 16,
            },
          ],
        },
      ],
    },
  };
}

// A valid, content-hashed document (verifyHash:true accepts it).
export function validSpinDocument(): unknown {
  const draft = rawSpinDocument();
  // The literal is structurally a SkeletonDocument; cast once to feed the typed hash function.
  return { ...draft, hash: computeContentHash(draft as unknown as SkeletonDocument) };
}

// A 16x16 opaque gradient page matching the 'spin.png' atlas page, encoded as PNG bytes.
export function spinAtlasPages(): AtlasImportPage[] {
  const size = 16;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      rgba[i] = x * 16;
      rgba[i + 1] = y * 16;
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  const image: DecodedImage = { width: size, height: size, rgba };
  return [{ file: 'spin.png', data: encodePng(image) }];
}
