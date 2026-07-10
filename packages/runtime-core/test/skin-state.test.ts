import { memoryUsage } from 'node:process';
import { describe, expect, it } from 'vitest';
import type { RegionAttachment, SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  buildSkinState,
  DEFAULT_SKIN_NAME,
  getActiveSkin,
  resolveAttachment,
  resolveSlotAttachment,
  sampleSkeleton,
  setActiveSkin,
  UnknownSkinError,
} from '../src';

// PP-B3 runtime skin selection. A pure, allocation-free lookup layer: the active skin resolves a slot's
// presented attachment, falling back to the default skin, without rebuilding the Pose. These tests pin
// the default active skin, the active-first-then-default resolution, the fail-loud unknown-skin error,
// the pose-driven resolve entry point, determinism, and the zero-per-call allocation contract.

function region(path: string): RegionAttachment {
  return {
    type: 'region',
    path,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 32,
    height: 32,
    color: { r: 1, g: 1, b: 1, a: 1 },
  };
}

// One root bone, two slots (each with a setup attachment), and two skins: `default` defines both slots'
// attachments; `costume` OVERRIDES slotA/baseA and omits slotB (so slotB must fall back to default).
function makeDoc(): SkeletonDocument {
  return {
    formatVersion: '0.2.0',
    name: 'skin-state-doc',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 32,
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
        name: 'slotA',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'baseA',
        blendMode: 'normal',
      },
      {
        name: 'slotB',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'baseB',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          slotA: { baseA: region('default/baseA') },
          slotB: { baseB: region('default/baseB') },
        },
      },
      {
        name: 'costume',
        attachments: {
          slotA: { baseA: region('costume/baseA') },
        },
      },
    ],
    animations: {
      // An empty animation, so sampleSkeleton resets slots to setup (populating pose.slotAttachment
      // with each slot's setup attachment name) with no timeline overrides, the realistic renderer flow.
      default: { duration: 1, bones: {}, slots: {}, ik: {}, transform: {}, deform: {} },
    },
    atlas: { pages: [] },
  };
}

describe('runtime skin state (PP-B3)', () => {
  it('defaults the active skin to the default skin', () => {
    const state = buildSkinState(makeDoc());
    expect(getActiveSkin(state)).toBe(DEFAULT_SKIN_NAME);
    expect(state.skinNames).toEqual(['default', 'costume']);
  });

  it('resolves an attachment from the active (default) skin', () => {
    const state = buildSkinState(makeDoc());
    expect(resolveAttachment(state, 'slotA', 'baseA')?.path).toBe('default/baseA');
    expect(resolveAttachment(state, 'slotB', 'baseB')?.path).toBe('default/baseB');
  });

  it('the active skin overrides the default for an attachment it defines', () => {
    const state = buildSkinState(makeDoc());
    setActiveSkin(state, 'costume');
    expect(resolveAttachment(state, 'slotA', 'baseA')?.path).toBe('costume/baseA');
  });

  it('falls back to the default skin for an attachment the active skin does not define', () => {
    const state = buildSkinState(makeDoc());
    setActiveSkin(state, 'costume');
    // costume does not define slotB, so slotB/baseB resolves from the default skin.
    expect(resolveAttachment(state, 'slotB', 'baseB')?.path).toBe('default/baseB');
  });

  it('returns null when neither the active nor the default skin defines the attachment', () => {
    const state = buildSkinState(makeDoc());
    expect(resolveAttachment(state, 'slotA', 'missing')).toBeNull();
    expect(resolveAttachment(state, 'noSuchSlot', 'baseA')).toBeNull();
  });

  it('fails loud with a typed UnknownSkinError when activating an unknown skin', () => {
    const state = buildSkinState(makeDoc());
    expect(() => setActiveSkin(state, 'nope')).toThrow(UnknownSkinError);
    // The active skin is unchanged after a rejected switch.
    expect(getActiveSkin(state)).toBe(DEFAULT_SKIN_NAME);
    try {
      setActiveSkin(state, 'nope');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownSkinError);
      expect((error as UnknownSkinError).skinName).toBe('nope');
    }
  });

  it('resolves a slot`s presented attachment from the solved pose (renderer entry point)', () => {
    const doc = makeDoc();
    const pose = buildPose(doc);
    sampleSkeleton(doc, 'default', 0, pose); // solve writes the active attachment names into the pose
    const state = buildSkinState(doc);

    const slotAIndex = pose.slotNames.indexOf('slotA');
    const slotBIndex = pose.slotNames.indexOf('slotB');
    expect(resolveSlotAttachment(state, pose, slotAIndex)?.path).toBe('default/baseA');

    setActiveSkin(state, 'costume');
    expect(resolveSlotAttachment(state, pose, slotAIndex)?.path).toBe('costume/baseA');
    expect(resolveSlotAttachment(state, pose, slotBIndex)?.path).toBe('default/baseB');
  });

  it('returns null from resolveSlotAttachment when the slot has no active attachment', () => {
    const doc = makeDoc();
    doc.slots[0]!.attachment = null; // slotA shows nothing in setup
    const pose = buildPose(doc);
    sampleSkeleton(doc, 'default', 0, pose);
    const state = buildSkinState(doc);
    expect(resolveSlotAttachment(state, pose, pose.slotNames.indexOf('slotA'))).toBeNull();
  });

  it('is deterministic: the same active skin always resolves to the same attachment reference', () => {
    const doc = makeDoc();
    const a = buildSkinState(doc);
    const b = buildSkinState(doc);
    setActiveSkin(a, 'costume');
    setActiveSkin(b, 'costume');
    // Same document objects, same active skin => byte-identical resolution (reference equality).
    expect(resolveAttachment(a, 'slotA', 'baseA')).toBe(resolveAttachment(b, 'slotA', 'baseA'));
    expect(resolveAttachment(a, 'slotB', 'baseB')).toBe(resolveAttachment(b, 'slotB', 'baseB'));
  });

  it('allocates no heap across repeated resolves (allocation probe)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error(
        'the skin-state allocation probe requires the worker to run with --expose-gc',
      );
    }

    const doc = makeDoc();
    const pose = buildPose(doc);
    sampleSkeleton(doc, 'default', 0, pose);
    const state = buildSkinState(doc);
    const slotAIndex = pose.slotNames.indexOf('slotA');

    // Warm up: let the JIT settle and any one-time allocation happen before measuring.
    for (let i = 0; i < 2000; i += 1) {
      setActiveSkin(state, i % 2 === 0 ? 'costume' : 'default');
      resolveSlotAttachment(state, pose, slotAIndex);
    }

    runGc();
    const before = memoryUsage().heapUsed;
    const iterations = 100_000;
    for (let i = 0; i < iterations; i += 1) {
      setActiveSkin(state, i % 2 === 0 ? 'costume' : 'default');
      resolveSlotAttachment(state, pose, slotAIndex);
    }
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;

    // Zero per-call allocation: 100k resolves that each allocated even a small object would add MBs.
    expect(heapGrowth).toBeLessThan(256 * 1024);
  });
});
