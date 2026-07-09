import { describe, expect, it } from 'vitest';
import type { Animation, CurveType, Slot } from '@marionette/format/types';
import { buildPose, sampleSkeleton, SLOT_COLOR_STRIDE } from '../src';
import { worldOf } from './rig';
import { anim, bone, fullDoc, slot } from './constraint-fixtures';

// ADR-0011 section 3: per-component split bone tracks, split rgb/alpha slot color, and the keyable
// two-color dark tint. The split bone tracks must produce the IDENTICAL world affine that the equivalent
// joint tracks would (they are two encodings of one channel); the color/dark tracks blend the pose color
// and dark lanes.

const linear: CurveType = 'linear';
const scalarKey = (time: number, value: number) => ({ time, value: { value }, curve: linear });

describe('split component bone tracks (ADR-0011 section 3)', () => {
  const worldAt = (animation: Animation): number[] => {
    const document = fullDoc({
      bones: [bone('b', null, { x: 3, y: -2, rotation: 12, scaleX: 1.1, scaleY: 0.9 })],
      animations: { a: animation },
    });
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 1, pose);
    return Array.from(worldOf(pose, 'b'));
  };

  it('translateX/translateY equal the joint translate channel', () => {
    const joint = worldAt(anim({ bones: { b: { translate: [
      { time: 0, value: { x: 0, y: 0 }, curve: linear },
      { time: 1, value: { x: 20, y: -15 }, curve: linear },
    ] } } }));
    const split = worldAt(anim({ bones: { b: {
      translateX: [scalarKey(0, 0), scalarKey(1, 20)],
      translateY: [scalarKey(0, 0), scalarKey(1, -15)],
    } } }));
    expect(split).toEqual(joint);
  });

  it('scaleX/scaleY equal the joint scale channel', () => {
    const joint = worldAt(anim({ bones: { b: { scale: [
      { time: 0, value: { x: 1, y: 1 }, curve: linear },
      { time: 1, value: { x: 1.4, y: 0.7 }, curve: linear },
    ] } } }));
    const split = worldAt(anim({ bones: { b: {
      scaleX: [scalarKey(0, 1), scalarKey(1, 1.4)],
      scaleY: [scalarKey(0, 1), scalarKey(1, 0.7)],
    } } }));
    expect(split).toEqual(joint);
  });

  it('shearX/shearY equal the joint shear channel', () => {
    const joint = worldAt(anim({ bones: { b: { shear: [
      { time: 0, value: { x: 0, y: 0 }, curve: linear },
      { time: 1, value: { x: 10, y: 6 }, curve: linear },
    ] } } }));
    const split = worldAt(anim({ bones: { b: {
      shearX: [scalarKey(0, 0), scalarKey(1, 10)],
      shearY: [scalarKey(0, 0), scalarKey(1, 6)],
    } } }));
    expect(split).toEqual(joint);
  });
});

describe('split slot color and keyable dark tint (ADR-0011 section 3)', () => {
  const tintSlot: Slot = {
    ...slot('s', 'b'),
    color: { r: 1, g: 1, b: 1, a: 1 },
    darkColor: { r: 0.2, g: 0.1, b: 0.3, a: 1 },
  };

  const document = fullDoc({
    bones: [bone('b', null)],
    slots: [tintSlot],
    animations: {
      a: anim({
        slots: {
          s: {
            rgb: [
              { time: 0, value: { rgb: { r: 1, g: 1, b: 1 } }, curve: linear },
              { time: 1, value: { rgb: { r: 1, g: 0, b: 0 } }, curve: linear },
            ],
            alpha: [
              { time: 0, value: { alpha: 1 }, curve: linear },
              { time: 1, value: { alpha: 0.4 }, curve: linear },
            ],
            dark: [
              { time: 0, value: { color: { r: 0.2, g: 0.1, b: 0.3, a: 1 } }, curve: linear },
              { time: 1, value: { color: { r: 0.8, g: 0.2, b: 0.5, a: 1 } }, curve: linear },
            ],
          },
        },
      }),
    },
  });

  it('split rgb/alpha resolve the slot color', () => {
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 1, pose);
    const c = Array.from(pose.slotColor.subarray(0, SLOT_COLOR_STRIDE));
    expect(c[0]).toBeCloseTo(1, 6);
    expect(c[1]).toBeCloseTo(0, 6);
    expect(c[2]).toBeCloseTo(0, 6);
    expect(c[3]).toBeCloseTo(0.4, 6);
  });

  it('the dark timeline resolves into the pose dark-color lane', () => {
    const pose = buildPose(document);
    expect(pose.slotHasDarkColor[0]).toBe(1);

    sampleSkeleton(document, 'a', 1, pose);
    const d = Array.from(pose.slotDarkColor.subarray(0, SLOT_COLOR_STRIDE));
    expect(d[0]).toBeCloseTo(0.8, 6);
    expect(d[1]).toBeCloseTo(0.2, 6);
    expect(d[2]).toBeCloseTo(0.5, 6);
  });

  it('the dark lane resets to the setup dark tint each frame (t=0 shows setup)', () => {
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 0, pose);
    const d = Array.from(pose.slotDarkColor.subarray(0, SLOT_COLOR_STRIDE));
    expect(d[0]).toBeCloseTo(0.2, 6);
    expect(d[1]).toBeCloseTo(0.1, 6);
    expect(d[2]).toBeCloseTo(0.3, 6);
  });

  it('a slot with no setup darkColor has an inert dark lane', () => {
    const plain = fullDoc({
      bones: [bone('b', null)],
      slots: [slot('s', 'b')],
      animations: { a: anim() },
    });
    const pose = buildPose(plain);
    expect(pose.slotHasDarkColor[0]).toBe(0);
    sampleSkeleton(plain, 'a', 0.5, pose);
    // Inert default (0, 0, 0, 1); renderers skip it because slotHasDarkColor is 0.
    expect(Array.from(pose.slotDarkColor.subarray(0, SLOT_COLOR_STRIDE))).toEqual([0, 0, 0, 1]);
  });
});
