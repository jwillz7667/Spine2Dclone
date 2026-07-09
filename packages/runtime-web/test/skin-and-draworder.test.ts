import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { parseDocument } from '@marionette/format';
import { UnknownSkinError } from '@marionette/runtime-core';
import type { Animation } from '@marionette/format/types';
import { SkeletonView } from '../src';
import { bone, makeDocument, region, slot } from './rig';

// PP-C6: runtime skin switching (active-skin attachment resolution with default fallback, pooled display
// objects recycled on switch) and render order following pose.drawOrder instead of setup order.

const attachmentsLayer = (view: SkeletonView): Container => view.root.children[0]!;

function emptyAnim(): Animation {
  // A trivial animation so syncAnimated can drive the cache-hit (no-rebuild) render path.
  return {
    duration: 1,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    deform: {},
    drawOrder: [],
    events: [],
  } as unknown as Animation;
}

// A two-skin rig: the 'body' slot shows attachment 'body' (region path differs per skin, distinguished by
// width); the 'hat' slot exists only in the default skin, so the alt skin inherits it via fallback.
function twoSkinDoc() {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body'), slot('hat', 'root', 'hat')],
    skin: {
      body: { body: region('bodyA', { width: 64 }) },
      hat: { hat: region('hatA', { width: 50 }) },
    },
    extraSkins: [
      // 'alt' overrides only the body slot (width 40); it defines no hat, so hat inherits from default.
      { name: 'alt', attachments: { body: { body: region('bodyB', { width: 40 }) } } },
    ],
    animations: { pose: emptyAnim() },
  });
}

describe('PP-C6 runtime skin switching', () => {
  it('resolves attachments from the default skin until a switch', () => {
    const view = new SkeletonView();
    view.sync(twoSkinDoc());

    expect(view.getActiveSkin()).toBe('default');
    expect([...view.getSkinNames()].sort()).toEqual(['alt', 'default']);
    const scene = view.describe();
    const body = scene.attachments.find((a) => a.slot === 'body')!;
    const hat = scene.attachments.find((a) => a.slot === 'hat')!;
    expect(body.width).toBe(64); // default skin's bodyA
    expect(hat.width).toBe(50);
  });

  it('switches to a costume skin, overriding some slots and inheriting the rest', () => {
    const view = new SkeletonView();
    const document = twoSkinDoc();
    view.sync(document);

    view.setActiveSkin('alt');
    expect(view.getActiveSkin()).toBe('alt');
    // sync() re-parses (new document identity), so the switch persists through the rebuild.
    view.sync(document);

    const scene = view.describe();
    expect(scene.attachments.find((a) => a.slot === 'body')!.width).toBe(40); // alt's bodyB
    expect(scene.attachments.find((a) => a.slot === 'hat')!.width).toBe(50); // inherited default hat
  });

  it('recycles pooled display objects on a live switch (cache hit, no structural rebuild)', () => {
    const document = parseDocument(twoSkinDoc(), { verifyHash: false });
    const view = new SkeletonView();
    view.syncAnimated(document, 'pose', 0);

    const layer = attachmentsLayer(view);
    const spritesBefore = [...layer.children];
    expect(spritesBefore).toHaveLength(2);

    view.setActiveSkin('alt');
    view.syncAnimated(document, 'pose', 0); // same parsed document -> cache hit, no rebuild

    // The same pooled sprites are reused (no new display objects), only their resolved geometry changed.
    expect(layer.children).toHaveLength(2);
    expect(layer.children[0]).toBe(spritesBefore[0]);
    expect(layer.children[1]).toBe(spritesBefore[1]);
    expect(view.describe().attachments.find((a) => a.slot === 'body')!.width).toBe(40);
  });

  it('throws UnknownSkinError for a skin the document does not define', () => {
    const view = new SkeletonView();
    view.sync(twoSkinDoc());
    expect(() => view.setActiveSkin('nonexistent')).toThrow(UnknownSkinError);
  });

  it('surfaces an unknown remembered skin at the next document build', () => {
    const view = new SkeletonView();
    // No scene yet: the name is stored and validated when the scene builds.
    view.setActiveSkin('ghost');
    expect(() => view.sync(twoSkinDoc())).toThrow(UnknownSkinError);
  });
});

describe('PP-C6 draw-order render ordering', () => {
  // A rig whose 'swap' animation flips two slots via a draw-order key at t = 0.5: 'back' moves +1 render
  // position (behind 'front' becomes in front of it), 'front' fills the vacated back position.
  function swapDoc() {
    return makeDocument({
      bones: [bone('root', null)],
      slots: [slot('back', 'root', 'back'), slot('front', 'root', 'front')],
      skin: { back: { back: region('back') }, front: { front: region('front') } },
      animations: {
        swap: {
          duration: 1,
          bones: {},
          slots: {},
          ik: {},
          transform: {},
          deform: {},
          drawOrder: [{ time: 0.5, offsets: [{ slot: 'back', offset: 1 }] }],
          events: [],
        } as unknown as Animation,
      },
    });
  }

  it('renders in setup order before the first draw-order key', () => {
    const document = swapDoc();
    const view = new SkeletonView();
    view.syncAnimated(document, 'swap', 0); // t < 0.5 => setup order

    expect(view.describe().attachments.map((a) => a.slot)).toEqual(['back', 'front']);
  });

  it('reorders the attachment layer children to match the solved draw order', () => {
    const document = swapDoc();
    const view = new SkeletonView();

    view.syncAnimated(document, 'swap', 0);
    const layer = attachmentsLayer(view);
    const [backSprite, frontSprite] = [layer.children[0]!, layer.children[1]!];
    expect(view.describe().attachments.map((a) => a.slot)).toEqual(['back', 'front']);

    // After the key at 0.5 the draw order flips: 'front' renders furthest back, 'back' on top.
    view.syncAnimated(document, 'swap', 1);
    expect(view.describe().attachments.map((a) => a.slot)).toEqual(['front', 'back']);
    // The layer children are re-appended to the solved order, reusing the same pooled sprites.
    expect(layer.children[0]).toBe(frontSprite);
    expect(layer.children[1]).toBe(backSprite);

    // Scrubbing back before the key restores the setup order (a forward or backward reorder both apply).
    view.syncAnimated(document, 'swap', 0);
    expect(view.describe().attachments.map((a) => a.slot)).toEqual(['back', 'front']);
    expect(layer.children[0]).toBe(backSprite);
    expect(layer.children[1]).toBe(frontSprite);
  });
});
