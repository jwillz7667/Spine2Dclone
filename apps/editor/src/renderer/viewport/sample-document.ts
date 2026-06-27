import type { SkeletonDocument } from '@marionette/format/types';

// A Phase-0 placeholder rig so the viewport has something to show before file IO (WP-0.8) and
// create-by-drag authoring (WP-0.7) exist: a root bone with one child, and one region attachment on
// the root. It is a draft (hash ''), so the runtime-web validate-before-solve boundary accepts it
// without hash verification. This is throwaway sample data, not part of the format or any fixture.
export function sampleDocument(): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name: 'sample',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 120,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
      {
        name: 'limb',
        parent: 'root',
        length: 90,
        x: 120,
        y: 0,
        rotation: 35,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 'body',
        bone: 'root',
        color: { r: 0.85, g: 0.85, b: 0.95, a: 1 },
        attachment: 'body',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: {
            body: {
              type: 'region',
              path: 'body',
              x: 60,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 120,
              height: 48,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'sample.png',
          width: 128,
          height: 64,
          regions: [
            {
              name: 'body',
              x: 0,
              y: 0,
              w: 120,
              h: 48,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 120,
              originalH: 48,
            },
          ],
        },
      ],
    },
  };
}
