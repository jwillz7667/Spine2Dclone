import { describe, expect, it } from 'vitest';
import { Container, Mesh, Sprite } from 'pixi.js';
import { SkeletonView } from '../src';
import { bone, makeDocument, mesh, region, slot } from './rig';

// Per-slot blend modes reach the displays (the gap the parity audit found: blendModeToPixi existed but
// renderFromPose never assigned it). Assignment happens at scene build for BOTH display kinds, through
// the same mapping the particle renderer uses (one blend path, phase-3 section 7.4). The pooled-sprite
// case matters most: sprites survive document rebuilds, so a stale blend from a previous document must
// be overwritten, not inherited.

function layerOf(view: SkeletonView): Container {
  return view.root.children[0] as Container;
}

describe('per-slot blend mode assignment', () => {
  it('stamps the slot blend mode onto the sprite and the mesh display', () => {
    const document = makeDocument({
      bones: [bone('root', null)],
      slots: [
        slot('glow', 'root', 'glow', { blendMode: 'additive' }),
        slot('shade', 'root', 'shade', { blendMode: 'multiply' }),
      ],
      skin: { glow: { glow: mesh('glow') }, shade: { shade: region('shade') } },
    });
    const view = new SkeletonView();
    view.sync(document);

    const meshDisplay = layerOf(view).children.find((c): c is Mesh => c instanceof Mesh)!;
    // PixiJS v8 names additive blending 'add' (blend-mode.ts mapping).
    expect(meshDisplay.blendMode).toBe('add');
    const shadeSprite = layerOf(view)
      .children.filter((c): c is Sprite => c instanceof Sprite)
      .at(-1)!;
    expect(shadeSprite.blendMode).toBe('multiply');
  });

  it('re-stamps a pooled sprite on document rebuild (no stale blend from the previous scene)', () => {
    const additive = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('body', 'root', 'body', { blendMode: 'screen' })],
      skin: { body: { body: region('body') } },
    });
    const normal = makeDocument({
      bones: [bone('root', null)],
      slots: [slot('body', 'root', 'body')],
      skin: { body: { body: region('body') } },
      name: 'other',
    });

    const view = new SkeletonView();
    view.sync(additive);
    const sprite = (): Sprite =>
      layerOf(view).children.find((c): c is Sprite => c instanceof Sprite)!;
    expect(sprite().blendMode).toBe('screen');

    view.sync(normal);
    expect(sprite().blendMode).toBe('normal');
  });
});
