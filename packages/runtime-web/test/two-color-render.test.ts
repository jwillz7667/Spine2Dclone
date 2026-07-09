import { describe, expect, it } from 'vitest';
import { SkeletonView } from '@marionette/runtime-web';
import { bone, makeDocument, mesh, region, slot } from './rig';

// Structural (headless) verification that the two-color DARK lane flows from the solved pose into both the
// region and the mesh render records (PP-C8). The actual GPU tint is done by the two-color filter, which
// needs a WebGL/WebGPU context and is NOT exercised here (repo convention); describe() reporting the packed
// dark tint proves the renderer reads pose.slotDarkColor and enables two-color only for dark-color slots.
// The pixel math itself is covered by the shared parity test (two-color.test.ts) and the render-preview
// end-to-end pixel test.

const RED_DARK = 0xff0000; // packTint(1, 0, 0)

function twoColorDoc() {
  return makeDocument({
    name: 'two-color',
    bones: [bone('root', null)],
    slots: [
      // A region slot WITH a dark tint, a region slot WITHOUT one, and a mesh slot WITH a dark tint.
      slot('lit', 'root', 'litRegion', { darkColor: { r: 1, g: 0, b: 0, a: 1 } }),
      slot('plain', 'root', 'plainRegion'),
      slot('meshLit', 'root', 'litMesh', { darkColor: { r: 1, g: 0, b: 0, a: 1 } }),
    ],
    skin: {
      lit: { litRegion: region('litRegion') },
      plain: { plainRegion: region('plainRegion') },
      meshLit: { litMesh: mesh('litMesh') },
    },
  });
}

describe('runtime-web two-color dark tint wiring', () => {
  it('reports the packed dark tint on a dark-color region slot and null on a plain one', () => {
    const view = new SkeletonView();
    view.sync(twoColorDoc());
    const scene = view.describe();

    const lit = scene.attachments.find((a) => a.slot === 'lit');
    const plain = scene.attachments.find((a) => a.slot === 'plain');

    expect(lit?.dark).toBe(RED_DARK);
    expect(plain?.dark).toBeNull();
    // The LIGHT tint is still reported (white x white) for both, unchanged by two-color.
    expect(lit?.tint).toBe(0xffffff);
    expect(plain?.tint).toBe(0xffffff);

    view.destroy();
  });

  it('reports the packed dark tint on a dark-color mesh slot', () => {
    const view = new SkeletonView();
    view.sync(twoColorDoc());
    const scene = view.describe();

    const meshLit = scene.meshes.find((m) => m.slot === 'meshLit');

    expect(meshLit?.dark).toBe(RED_DARK);

    view.destroy();
  });

  it('a rig with no dark colors reports null dark on every attachment (no regression)', () => {
    const view = new SkeletonView();
    view.sync(
      makeDocument({
        bones: [bone('root', null)],
        slots: [slot('body', 'root', 'body')],
        skin: { body: { body: region('body') } },
      }),
    );

    for (const attachment of view.describe().attachments) {
      expect(attachment.dark).toBeNull();
    }

    view.destroy();
  });
});
