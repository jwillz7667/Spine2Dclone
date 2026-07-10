import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type { Animation } from '@marionette/format/types';
import { sequenceRegionName, SkeletonView } from '@marionette/runtime-web';
import { bone, makeDocument, region, slot } from './rig';

// A sequence attachment (ADR-0009 section 3) plays a numbered run of atlas regions over time. runtime-web
// selects the resolved frame's region per sample and swaps the display texture to it. Headless describe()
// reports the presented region NAME (the texture swap rides the same name), so a snapshot verifies the
// per-sample frame selection without a GL context.

const playAnimation: Animation = {
  duration: 1,
  bones: {},
  slots: { seqSlot: { sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }] } },
  ik: {},
  transform: {},
  deform: {},
  drawOrder: [],
  events: [],
};

function sequenceDoc() {
  return makeDocument({
    name: 'sequence',
    bones: [bone('root', null)],
    slots: [slot('seqSlot', 'root', 'seq')],
    skin: {
      seqSlot: {
        seq: region('frame', { sequence: { count: 3, start: 0, digits: 2, setupIndex: 1 } }),
      },
    },
    animations: { play: playAnimation },
  });
}

describe('sequenceRegionName (runtime-web, parity with render-preview)', () => {
  it('appends the zero-padded (start + frame) to the path', () => {
    const seq = { count: 3, start: 0, digits: 2, setupIndex: 0 };
    expect(sequenceRegionName('frame', seq, 0)).toBe('frame00');
    expect(sequenceRegionName('frame', seq, 2)).toBe('frame02');
    expect(sequenceRegionName('img', { count: 10, start: 5, digits: 3, setupIndex: 0 }, 2)).toBe(
      'img007',
    );
  });
});

describe('runtime-web sequence attachments', () => {
  it('presents the setup frame region at the setup pose', () => {
    const view = new SkeletonView();
    view.sync(sequenceDoc());

    const seqSlot = view.describe().attachments.find((a) => a.slot === 'seqSlot');
    // setupIndex 1 -> frame region 'frame01'.
    expect(seqSlot?.region).toBe('frame01');

    view.destroy();
  });

  it('advances the presented frame region as the sequence timeline plays', () => {
    const doc = parseDocument(sequenceDoc(), { verifyHash: false });
    const view = new SkeletonView();

    const regionAt = (t: number): string | undefined => {
      view.syncAnimated(doc, 'play', t);
      return view.describe().attachments.find((a) => a.slot === 'seqSlot')?.region;
    };

    // loop, 0.1s/frame from index 0: t in [0, 0.1) -> frame 0, [0.1, 0.2) -> frame 1, [0.2, 0.3) -> frame 2.
    expect(regionAt(0.05)).toBe('frame00');
    expect(regionAt(0.15)).toBe('frame01');
    expect(regionAt(0.25)).toBe('frame02');

    view.destroy();
  });

  it('reports the plain attachment path for a non-sequence region (no regression)', () => {
    const view = new SkeletonView();
    view.sync(
      makeDocument({
        bones: [bone('root', null)],
        slots: [slot('body', 'root', 'body')],
        skin: { body: { body: region('body') } },
      }),
    );

    expect(view.describe().attachments.find((a) => a.slot === 'body')?.region).toBe('body');

    view.destroy();
  });
});
