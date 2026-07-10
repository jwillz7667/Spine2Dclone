import { describe, expect, it } from 'vitest';
import { SkeletonView } from '../src';

// Clipping in runtime-web (ADR-0012 section 3, PP-C8 part 2). runtime-web applies clipping as a PixiJS
// Graphics polygon MASK; the pure DECISION (which slots a clip masks, and the world polygon) is the clip-plan
// module, surfaced through describe().clips so it is verifiable WITHOUT a WebGL context (the mask itself is a
// GPU stencil, exactly as the two-color tint is a GPU filter the headless path does not exercise). These
// tests pin that decision: a clip on 's_clip' whose end is 's_img' masks 's_img' to the clip's world polygon,
// a rig with no clip attachment plans no clips, and the masked slot's display object receives a mask.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

// Two slots on the origin bone: 's_clip' presents a clipping attachment (a rectangle covering world x in
// [-20, 0], the LEFT HALF of the region) whose `end` is 's_img'; 's_img' presents a 40x40 region. Both ride
// the same origin bone with no rotation, so the local clip polygon equals the world polygon.
function clipDoc(): unknown {
  return {
    formatVersion: '0.4.0',
    name: 'rw-clip',
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
      { name: 's_clip', bone: 'root', color: WHITE, attachment: 'clip', blendMode: 'normal' },
      { name: 's_img', bone: 'root', color: WHITE, attachment: 'img', blendMode: 'normal' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          s_clip: {
            clip: {
              type: 'clipping',
              end: 's_img',
              vertices: [-20, -20, 0, -20, 0, 20, -20, 20],
              color: WHITE,
            },
          },
          s_img: {
            img: {
              type: 'region',
              path: 'img',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 40,
              height: 40,
              color: WHITE,
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    animations: {},
    events: [],
    atlas: {
      pages: [
        {
          file: 'page.png',
          width: 8,
          height: 8,
          regions: [
            {
              name: 'img',
              x: 0,
              y: 0,
              w: 8,
              h: 8,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 8,
              originalH: 8,
            },
          ],
        },
      ],
    },
  };
}

// A single-slot region rig with NO clip attachment (the no-clip control).
function plainDoc(): unknown {
  const doc = clipDoc() as { slots: unknown[]; skins: { attachments: Record<string, unknown> }[] };
  doc.slots = [
    { name: 's_img', bone: 'root', color: WHITE, attachment: 'img', blendMode: 'normal' },
  ];
  delete (doc.skins[0]!.attachments as Record<string, unknown>).s_clip;
  return doc;
}

// Reach the masks the adapter built (GL-free: Graphics construction needs no context). masksLayer is the
// third child of root (attachments, bones, masks).
function maskChildren(view: SkeletonView): { visible: boolean }[] {
  const root = view.root as unknown as { children: { children: { visible: boolean }[] }[] };
  return root.children[2]!.children;
}

describe('SkeletonView clipping (ADR-0012, PP-C8 part 2)', () => {
  it('plans a clip that masks the slots in its draw-order range to its world polygon', () => {
    const view = new SkeletonView();
    view.sync(clipDoc());

    const { clips } = view.describe();
    expect(clips).toHaveLength(1);
    expect(clips[0]!.clipSlot).toBe('s_clip');
    expect(clips[0]!.clippedSlots).toEqual(['s_img']);
    // World polygon equals the local polygon (origin bone, identity), the LEFT-HALF rectangle.
    expect(clips[0]!.polygon).toEqual([-20, -20, 0, -20, 0, 20, -20, 20]);
  });

  it('assigns a GPU mask to the clipped slot display object', () => {
    const view = new SkeletonView();
    view.sync(clipDoc());

    // The adapter built exactly one mask (one masked, visible display object) and it is active (visible).
    const masks = maskChildren(view);
    const active = masks.filter((m) => m.visible);
    expect(active).toHaveLength(1);
  });

  it('plans no clips for a rig with no clip attachment', () => {
    const view = new SkeletonView();
    view.sync(plainDoc());

    expect(view.describe().clips).toEqual([]);
  });
});
