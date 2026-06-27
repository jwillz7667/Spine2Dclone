import { describe, expect, it, vi } from 'vitest';
import { Sprite } from 'pixi.js';
import * as runtimeCore from '@marionette/runtime-core';
import {
  AnimationNotFoundError,
  buildPose,
  MAT2X3_STRIDE,
  sampleSkeleton,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';
import { mapWorldToDisplay, SkeletonView } from '../src';
import { bone, makeDocument, region, slot } from './rig';

// A two-bone rig with an arm rotate channel and an offset region on the arm, so an arm rotation moves
// both the arm bone world transform and the hand sprite origin (a region offset off the rotation pivot).
function rotatingRig(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null), bone('arm', 'root', { x: 50, length: 50 })],
    slots: [slot('hand', 'arm', 'hand')],
    skin: { hand: { hand: region('hand', { x: 30 }) } },
    animations: {
      spin: {
        duration: 1,
        bones: {
          arm: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 90 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
      },
    },
  });
}

// A single-slot rig whose color channel fades white -> black, so the rendered tint must follow the
// sampled color, not the (white) setup color.
function fadingRig(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('body') } },
    animations: {
      fade: {
        duration: 1,
        bones: {},
        slots: {
          body: {
            color: [
              { time: 0, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' },
              { time: 1, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' },
            ],
          },
        },
      },
    },
  });
}

// A rig whose rotate channel has MATCHED endpoints (first key angle == last key angle), the seamless-
// loop precondition: with clamp, pose(0) and pose(duration) agree, so the rendered frames are equal.
function idleRig(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body', { color: { r: 0.8, g: 0.6, b: 0.4, a: 1 } })],
    skin: { body: { body: region('body') } },
    animations: {
      idle: {
        duration: 2,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 10 }, curve: 'linear' },
              { time: 1, value: { angle: 40 }, curve: 'linear' },
              { time: 2, value: { angle: 10 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
      },
    },
  });
}

function boneWorld(pose: Pose, name: string): Mat2x3 {
  const base = pose.boneNames.indexOf(name) * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

function boneTransform(view: SkeletonView, name: string) {
  const found = view.describe().bones.find((b) => b.name === name);
  if (found === undefined) throw new Error(`bone "${name}" not in scene`);
  return found.transform;
}

function attachmentOf(view: SkeletonView, slotName: string) {
  const found = view.describe().attachments.find((a) => a.slot === slotName);
  if (found === undefined) throw new Error(`attachment for slot "${slotName}" not in scene`);
  return found;
}

function firstSprite(view: SkeletonView): Sprite {
  const layer = view.root.children[0]!;
  const child = layer.children[0]!;
  if (!(child instanceof Sprite)) throw new Error('expected an attachment sprite');
  return child;
}

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

describe('SkeletonView animated playback', () => {
  it('moves the rig over time and its world transforms equal runtime-core.sampleSkeleton', () => {
    const document = rotatingRig();
    const view = new SkeletonView();

    view.syncAnimated(document, 'spin', 0);
    const armAt0 = boneTransform(view, 'arm');
    const handAt0 = attachmentOf(view, 'hand').worldPosition;

    view.syncAnimated(document, 'spin', 0.5);
    const armAt05 = boneTransform(view, 'arm');
    const handAt05 = attachmentOf(view, 'hand').worldPosition;

    // The sprite moves: the arm world rotation advances and the hand origin shifts off the pivot.
    expect(armAt05.rotation).not.toBeCloseTo(armAt0.rotation, 6);
    expect(distance(handAt0, handAt05)).toBeGreaterThan(1);

    // The rendered transform is exactly what sampleSkeleton writes for the same (document, anim, t):
    // the render reads the pose it solved.
    const pose = buildPose(document);
    sampleSkeleton(document, 'spin', 0.5, pose);
    const expected = mapWorldToDisplay(boneWorld(pose, 'arm'));
    expect(armAt05.x).toBeCloseTo(expected.x, 12);
    expect(armAt05.y).toBeCloseTo(expected.y, 12);
    expect(armAt05.rotation).toBeCloseTo(expected.rotation, 12);
    expect(armAt05.scaleX).toBeCloseTo(expected.scaleX, 12);
    expect(armAt05.scaleY).toBeCloseTo(expected.scaleY, 12);
  });

  it('renders the sampled slot color, not the setup color, on the live sprite and in describe()', () => {
    const document = fadingRig();
    const view = new SkeletonView();

    view.syncAnimated(document, 'fade', 0);
    const tintAt0 = attachmentOf(view, 'body').tint;
    const spriteTintAt0 = firstSprite(view).tint;

    view.syncAnimated(document, 'fade', 1);
    const tintAt1 = attachmentOf(view, 'body').tint;
    const spriteTintAt1 = firstSprite(view).tint;

    // White at t=0, black at t=1: the animated color drives the tint.
    expect(tintAt0).toBe(0xffffff);
    expect(tintAt1).toBe(0x000000);
    expect(tintAt0).not.toBe(tintAt1);
    // Render == describe: the live sprite carries the same tint the description reports.
    expect(spriteTintAt0).toBe(tintAt0);
    expect(spriteTintAt1).toBe(tintAt1);
    // Not the setup color: the slot's setup color is white, so a setup render would stay 0xffffff.
    expect(tintAt1).not.toBe(0xffffff);

    // The sampled pose color itself differs across the two times (driven independently).
    const pose = buildPose(document);
    sampleSkeleton(document, 'fade', 0, pose);
    const channelAt0 = pose.slotColor[0]!;
    sampleSkeleton(document, 'fade', 1, pose);
    const channelAt1 = pose.slotColor[0]!;
    expect(channelAt0).toBeCloseTo(1, 9);
    expect(channelAt1).toBeCloseTo(0, 9);
  });

  it('renders deep-equal at t=0 and t=duration for matched endpoints (seamless-loop precondition)', () => {
    const document = idleRig();
    const view = new SkeletonView();

    view.syncAnimated(document, 'idle', 0);
    const atStart = view.describe();
    view.syncAnimated(document, 'idle', 2);
    const atEnd = view.describe();

    expect(atEnd).toEqual(atStart);
  });

  it('syncAnimatedLoop folds elapsed time into one period and rejects an unknown animation', () => {
    const document = idleRig();
    const view = new SkeletonView();

    // elapsed 2.5 over a 2s loop wraps to 0.5, so it renders the same frame as a direct t=0.5.
    view.syncAnimatedLoop(document, 'idle', 2.5);
    const looped = view.describe();
    view.syncAnimated(document, 'idle', 0.5);
    const direct = view.describe();
    expect(looped).toEqual(direct);

    expect(() => view.syncAnimatedLoop(document, 'missing', 0)).toThrow(AnimationNotFoundError);
  });

  it('builds the pose once per document and reuses pooled sprites across frames', () => {
    const buildSpy = vi.spyOn(runtimeCore, 'buildPose');
    try {
      const document = rotatingRig();
      const view = new SkeletonView();

      view.syncAnimated(document, 'spin', 0);
      const sprite = firstSprite(view);

      view.syncAnimated(document, 'spin', 0.25);
      view.syncAnimated(document, 'spin', 0.5);

      // The pose is built exactly once for the document; later frames reuse it (TASK-1.10.5).
      expect(buildSpy).toHaveBeenCalledTimes(1);
      // Display objects are pooled, not recreated: the steady-state frame allocates no sprites.
      expect(firstSprite(view)).toBe(sprite);
    } finally {
      buildSpy.mockRestore();
    }
  });
});
