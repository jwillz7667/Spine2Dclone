import { memoryUsage } from 'node:process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  Animation,
  BoneTimelines,
  RGBA,
  SkeletonDocument,
  SlotTimelines,
} from '@marionette/format/types';
import {
  AnimationNotFoundError,
  buildPose,
  compose,
  MAT2X3_STRIDE,
  sampleSkeleton,
  SLOT_COLOR_STRIDE,
} from '../src';
import type { Mat2x3, Pose } from '../src';
import { buildBezierTable, evalBezierY } from '../src/skeleton/curve';
import { attachmentFrame, bone, colorKey, doc, rotateKey, slot, vec2Key } from './anim-fixtures';

// A non-trivial single-bone setup so add (rotation/translation/shear) and multiply (scale) are
// distinguishable from each other and from a no-op.
const SETUP = { x: 5, y: 7, rotation: 10, scaleX: 2, scaleY: 3, shearX: 4, shearY: 0 } as const;
const EASE = { type: 'bezier', cx1: 0.42, cy1: 0.0, cx2: 0.58, cy2: 1.0 } as const;

function localOf(pose: Pose, name: string): Mat2x3 {
  const i = pose.boneNames.indexOf(name);
  const base = i * MAT2X3_STRIDE;
  const l = pose.local;
  return [l[base]!, l[base + 1]!, l[base + 2]!, l[base + 3]!, l[base + 4]!, l[base + 5]!];
}

function slotColorOf(pose: Pose, name: string): RGBA {
  const i = pose.slotNames.indexOf(name);
  const base = i * SLOT_COLOR_STRIDE;
  const c = pose.slotColor;
  return { r: c[base]!, g: c[base + 1]!, b: c[base + 2]!, a: c[base + 3]! };
}

function slotAttachmentOf(pose: Pose, name: string): string | null {
  return pose.slotAttachment[pose.slotNames.indexOf(name)] ?? null;
}

function expectMat(actual: Mat2x3, expected: Mat2x3, eps = 1e-9): void {
  for (let i = 0; i < 6; i += 1) {
    expect(Math.abs(actual[i]! - expected[i]!)).toBeLessThanOrEqual(eps);
  }
}

// Sample a single bone channel onto SETUP and return the resulting local matrix.
function sampleBoneLocal(channel: BoneTimelines, t: number, duration = 2): Mat2x3 {
  const animation: Animation = { duration, bones: { b: channel }, slots: {} };
  const document = doc({ bones: [bone('b', null, SETUP)], animations: { test: animation } });
  const pose = buildPose(document);
  sampleSkeleton(document, 'test', t, pose);
  return localOf(pose, 'b');
}

describe('sampleSkeleton bone rotate channel (adds to setup rotation)', () => {
  const keys = (curve0: Parameters<typeof rotateKey>[2]) => [
    rotateKey(0, 0, curve0),
    rotateKey(1, 30, 'linear'),
  ];

  it('linear: interpolates the added angle across the segment', () => {
    expectMat(sampleBoneLocal({ rotate: keys('linear') }, 0.5), compose(5, 7, 10 + 15, 2, 3, 4, 0));
  });

  it('clamps to the first value before the first key', () => {
    expectMat(sampleBoneLocal({ rotate: keys('linear') }, -1), compose(5, 7, 10 + 0, 2, 3, 4, 0));
  });

  it('clamps to the last value after the last key', () => {
    expectMat(sampleBoneLocal({ rotate: keys('linear') }, 5), compose(5, 7, 10 + 30, 2, 3, 4, 0));
  });

  it('stepped: holds the segment-start angle until the next key', () => {
    expectMat(
      sampleBoneLocal({ rotate: keys('stepped') }, 0.99),
      compose(5, 7, 10 + 0, 2, 3, 4, 0),
    );
    expectMat(
      sampleBoneLocal({ rotate: keys('stepped') }, 1.0),
      compose(5, 7, 10 + 30, 2, 3, 4, 0),
    );
  });

  it('bezier: eases the added angle by the curve y at the normalized time', () => {
    const f = evalBezierY(buildBezierTable(EASE.cx1, EASE.cy1, EASE.cx2, EASE.cy2), 0, 0.4);
    expectMat(sampleBoneLocal({ rotate: keys(EASE) }, 0.4), compose(5, 7, 10 + 30 * f, 2, 3, 4, 0));
  });
});

describe('sampleSkeleton bone translate channel (adds to setup translation)', () => {
  const keys = (curve0: Parameters<typeof vec2Key>[3]) => [
    vec2Key(0, 0, 0, curve0),
    vec2Key(1, 20, 40, 'linear'),
  ];

  it('linear: adds the interpolated offset', () => {
    expectMat(sampleBoneLocal({ translate: keys('linear') }, 0.5), compose(15, 27, 10, 2, 3, 4, 0));
  });

  it('clamps before first and after last', () => {
    expectMat(sampleBoneLocal({ translate: keys('linear') }, -1), compose(5, 7, 10, 2, 3, 4, 0));
    expectMat(sampleBoneLocal({ translate: keys('linear') }, 9), compose(25, 47, 10, 2, 3, 4, 0));
  });

  it('stepped: holds the start offset', () => {
    expectMat(sampleBoneLocal({ translate: keys('stepped') }, 0.5), compose(5, 7, 10, 2, 3, 4, 0));
  });

  it('bezier: eases both components by the same curve fraction', () => {
    const f = evalBezierY(buildBezierTable(EASE.cx1, EASE.cy1, EASE.cx2, EASE.cy2), 0, 0.4);
    expectMat(
      sampleBoneLocal({ translate: keys(EASE) }, 0.4),
      compose(5 + 20 * f, 7 + 40 * f, 10, 2, 3, 4, 0),
    );
  });
});

describe('sampleSkeleton bone scale channel (multiplies setup scale)', () => {
  const keys = (curve0: Parameters<typeof vec2Key>[3]) => [
    vec2Key(0, 1, 1, curve0),
    vec2Key(1, 2, 4, 'linear'),
  ];

  it('linear: multiplies setup scale by the interpolated factor', () => {
    // factor at t=0.5 is (1.5, 2.5); setup scale (2, 3) -> (3, 7.5).
    expectMat(sampleBoneLocal({ scale: keys('linear') }, 0.5), compose(5, 7, 10, 3, 7.5, 4, 0));
  });

  it('clamps before first (factor 1 leaves setup scale unchanged) and after last', () => {
    expectMat(sampleBoneLocal({ scale: keys('linear') }, -1), compose(5, 7, 10, 2, 3, 4, 0));
    expectMat(sampleBoneLocal({ scale: keys('linear') }, 9), compose(5, 7, 10, 4, 12, 4, 0));
  });

  it('stepped: holds the start factor', () => {
    expectMat(sampleBoneLocal({ scale: keys('stepped') }, 0.5), compose(5, 7, 10, 2, 3, 4, 0));
  });

  it('bezier: eases the multiplied factor', () => {
    const f = evalBezierY(buildBezierTable(EASE.cx1, EASE.cy1, EASE.cx2, EASE.cy2), 0, 0.4);
    expectMat(
      sampleBoneLocal({ scale: keys(EASE) }, 0.4),
      compose(5, 7, 10, 2 * (1 + f), 3 * (1 + 3 * f), 4, 0),
    );
  });
});

describe('sampleSkeleton bone shear channel (adds to setup shear)', () => {
  const keys = (curve0: Parameters<typeof vec2Key>[3]) => [
    vec2Key(0, 0, 0, curve0),
    vec2Key(1, 10, 6, 'linear'),
  ];

  it('linear: adds the interpolated shear in degrees', () => {
    // at t=0.5 shear delta is (5, 3); setup shear (4, 0) -> (9, 3).
    expectMat(sampleBoneLocal({ shear: keys('linear') }, 0.5), compose(5, 7, 10, 2, 3, 9, 3));
  });

  it('clamps before first and after last', () => {
    expectMat(sampleBoneLocal({ shear: keys('linear') }, -1), compose(5, 7, 10, 2, 3, 4, 0));
    expectMat(sampleBoneLocal({ shear: keys('linear') }, 9), compose(5, 7, 10, 2, 3, 14, 6));
  });

  it('stepped: holds the start shear', () => {
    expectMat(sampleBoneLocal({ shear: keys('stepped') }, 0.5), compose(5, 7, 10, 2, 3, 4, 0));
  });

  it('bezier: eases both shear components', () => {
    const f = evalBezierY(buildBezierTable(EASE.cx1, EASE.cy1, EASE.cx2, EASE.cy2), 0, 0.4);
    expectMat(
      sampleBoneLocal({ shear: keys(EASE) }, 0.4),
      compose(5, 7, 10, 2, 3, 4 + 10 * f, 6 * f),
    );
  });
});

// Slot color + attachment sampling. A single slot 's' on bone 'b'.
const RED: RGBA = { r: 1, g: 0, b: 0, a: 1 };
const BLUE: RGBA = { r: 0, g: 0, b: 1, a: 1 };
const SETUP_COLOR: RGBA = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

function slotDoc(
  slotTimelines: SlotTimelines,
  setupAttachment: string | null = null,
): SkeletonDocument {
  const animation: Animation = { duration: 2, bones: {}, slots: { s: slotTimelines } };
  return doc({
    bones: [bone('b', null)],
    slots: [slot('s', 'b', { color: SETUP_COLOR, attachment: setupAttachment })],
    animations: { test: animation },
  });
}

function sampleSlot(
  slotTimelines: SlotTimelines,
  t: number,
  setupAttachment: string | null = null,
): Pose {
  const document = slotDoc(slotTimelines, setupAttachment);
  const pose = buildPose(document);
  sampleSkeleton(document, 'test', t, pose);
  return pose;
}

function expectColor(actual: RGBA, expected: RGBA, eps = 1e-9): void {
  expect(Math.abs(actual.r - expected.r)).toBeLessThanOrEqual(eps);
  expect(Math.abs(actual.g - expected.g)).toBeLessThanOrEqual(eps);
  expect(Math.abs(actual.b - expected.b)).toBeLessThanOrEqual(eps);
  expect(Math.abs(actual.a - expected.a)).toBeLessThanOrEqual(eps);
}

describe('sampleSkeleton slot color channel (replaces setup color, per-component lerp)', () => {
  const keys = (curve0: Parameters<typeof colorKey>[2]) => [
    colorKey(0, RED, curve0),
    colorKey(1, BLUE, 'linear'),
  ];

  it('linear: replaces setup color with the interpolated keyframe color', () => {
    expectColor(slotColorOf(sampleSlot({ color: keys('linear') }, 0.5), 's'), {
      r: 0.5,
      g: 0,
      b: 0.5,
      a: 1,
    });
  });

  it('clamps to the first key color before the first key (replace, not setup-relative)', () => {
    expectColor(slotColorOf(sampleSlot({ color: keys('linear') }, -1), 's'), RED);
  });

  it('clamps to the last key color after the last key', () => {
    expectColor(slotColorOf(sampleSlot({ color: keys('linear') }, 9), 's'), BLUE);
  });

  it('stepped: holds the segment-start color', () => {
    expectColor(slotColorOf(sampleSlot({ color: keys('stepped') }, 0.5), 's'), RED);
  });

  it('leaves the setup color when the slot has no color channel', () => {
    expectColor(slotColorOf(sampleSlot({}, 0.5), 's'), SETUP_COLOR);
  });
});

describe('sampleSkeleton slot attachment channel (stepped name swap)', () => {
  const frames = {
    attachment: [attachmentFrame(0, 'a'), attachmentFrame(1, 'b'), attachmentFrame(2, null)],
  };

  it('holds the active name until the next key', () => {
    expect(slotAttachmentOf(sampleSlot(frames, 0.5), 's')).toBe('a');
    expect(slotAttachmentOf(sampleSlot(frames, 1.5), 's')).toBe('b');
  });

  it('clamps to the first name before the first key and the last name after the last key', () => {
    expect(slotAttachmentOf(sampleSlot(frames, -1), 's')).toBe('a');
    expect(slotAttachmentOf(sampleSlot(frames, 9), 's')).toBeNull();
  });

  it('keeps the setup attachment when the slot has no attachment channel', () => {
    expect(slotAttachmentOf(sampleSlot({}, 0.5, 'setupAttach'), 's')).toBe('setupAttach');
  });
});

describe('sampleSkeleton error handling', () => {
  it('throws a typed AnimationNotFoundError for an unknown animation id', () => {
    const document = doc({ bones: [bone('b', null)] });
    const pose = buildPose(document);
    expect(() => sampleSkeleton(document, 'missing', 0, pose)).toThrow(AnimationNotFoundError);
  });
});

// A richer rig (two bones, multiple channels including bezier, plus a slot color) used by the
// determinism, zero-allocation, and loop tests.
function richDoc(): SkeletonDocument {
  const animation: Animation = {
    duration: 1.2,
    bones: {
      root: {
        rotate: [rotateKey(0, 0, EASE), rotateKey(0.6, 8, EASE), rotateKey(1.2, 0, 'linear')],
        translate: [
          vec2Key(0, 0, 0, 'linear'),
          vec2Key(0.6, 0, 6, 'linear'),
          vec2Key(1.2, 0, 0, 'linear'),
        ],
      },
      child: {
        rotate: [
          rotateKey(0, 0, 'stepped'),
          rotateKey(0.6, 20, 'linear'),
          rotateKey(1.2, 0, 'linear'),
        ],
        scale: [
          vec2Key(0, 1, 1, 'linear'),
          vec2Key(0.6, 1.2, 1.2, 'linear'),
          vec2Key(1.2, 1, 1, 'linear'),
        ],
      },
    },
    slots: {
      s: {
        color: [
          colorKey(0, RED, 'linear'),
          colorKey(0.6, BLUE, 'linear'),
          colorKey(1.2, RED, 'linear'),
        ],
      },
    },
  };
  return doc({
    bones: [bone('root', null, { rotation: 90 }), bone('child', 'root', { x: 100 })],
    slots: [slot('s', 'child', { color: SETUP_COLOR })],
    animations: { idle: animation },
  });
}

interface PoseSnapshot {
  local: number[];
  world: number[];
  slotColor: number[];
  slotAttachment: (string | null)[];
}

function snapshotPose(pose: Pose): PoseSnapshot {
  return {
    local: Array.from(pose.local),
    world: Array.from(pose.world),
    slotColor: Array.from(pose.slotColor),
    slotAttachment: [...pose.slotAttachment],
  };
}

describe('sampleSkeleton determinism (LAW 1)', () => {
  it('produces the same output across 1000 repeated calls (cloning before comparison)', () => {
    const document = richDoc();
    const pose = buildPose(document);

    sampleSkeleton(document, 'idle', 0.37, pose);
    const first = snapshotPose(pose);

    for (let i = 0; i < 1000; i += 1) {
      sampleSkeleton(document, 'idle', 0.37, pose);
      expect(snapshotPose(pose)).toStrictEqual(first);
    }
  });

  it('allocates no heap per call after warmup (allocation probe)', () => {
    const runGc = (globalThis as { gc?: () => void }).gc;
    if (typeof runGc !== 'function') {
      throw new Error(
        'the sampleSkeleton allocation probe requires the worker to run with --expose-gc',
      );
    }

    const document = richDoc();
    const pose = buildPose(document);
    // Warm up: build and cache the prepared animation, let the JIT settle, before measuring.
    for (let i = 0; i < 2000; i += 1) sampleSkeleton(document, 'idle', (i % 12) / 10, pose);

    runGc();
    const before = memoryUsage().heapUsed;
    const iterations = 100_000;
    for (let i = 0; i < iterations; i += 1) sampleSkeleton(document, 'idle', (i % 12) / 10, pose);
    runGc();
    const heapGrowth = memoryUsage().heapUsed - before;

    // Any per-call allocation (even a 6-number array) over 100k calls would add megabytes; the residual
    // is GC/measurement noise held well under a tight threshold.
    expect(heapGrowth).toBeLessThan(512 * 1024);
  });
});

// The A.5 tolerance classes (conformance-and-ci.md A.5): world basis atol 1e-6 / rtol 1e-6, world
// translation atol 1e-4 / rtol 1e-6.
function withinA5(actual: number, expected: number, atol: number, rtol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    atol + rtol * Math.max(Math.abs(actual), Math.abs(expected)),
  );
}

function expectWorldWithinA5(a: Pose, b: Pose): void {
  expect(a.boneCount).toBe(b.boneCount);
  for (let i = 0; i < a.boneCount; i += 1) {
    const base = i * MAT2X3_STRIDE;
    withinA5(a.world[base]!, b.world[base]!, 1e-6, 1e-6);
    withinA5(a.world[base + 1]!, b.world[base + 1]!, 1e-6, 1e-6);
    withinA5(a.world[base + 2]!, b.world[base + 2]!, 1e-6, 1e-6);
    withinA5(a.world[base + 3]!, b.world[base + 3]!, 1e-6, 1e-6);
    withinA5(a.world[base + 4]!, b.world[base + 4]!, 1e-4, 1e-6);
    withinA5(a.world[base + 5]!, b.world[base + 5]!, 1e-4, 1e-6);
  }
}

describe('sampleSkeleton loop boundary semantics (TASK-1.4.7)', () => {
  it('agrees at t=0 and t=duration when first and last keyframe values match (seamless precondition)', () => {
    const document = richDoc(); // every channel has matched first/last keyframe values
    const atZero = buildPose(document);
    const atDuration = buildPose(document);

    sampleSkeleton(document, 'idle', 0, atZero);
    sampleSkeleton(document, 'idle', document.animations.idle!.duration, atDuration);

    expectWorldWithinA5(atZero, atDuration);
  });

  it('does not wrap: clamps past the duration to the last value rather than interpolating to the first', () => {
    // A non-seamless rig (first angle 0, last angle 45). Past the duration the value clamps to 45, not
    // back toward 0; this pins that the sampler is single-period (looping is the transport's job).
    const animation: Animation = {
      duration: 1,
      bones: { b: { rotate: [rotateKey(0, 0, 'linear'), rotateKey(1, 45, 'linear')] } },
      slots: {},
    };
    const document = doc({ bones: [bone('b', null, SETUP)], animations: { test: animation } });
    const pose = buildPose(document);

    sampleSkeleton(document, 'test', 2, pose);
    expectMat(localOf(pose, 'b'), compose(5, 7, 10 + 45, 2, 3, 4, 0));
  });
});

describe('runtime-core sampling stays platform-agnostic (INV runtime-core renderer-free)', () => {
  it('imports no renderer or DOM package in the new sampling sources', () => {
    const files = ['curve.ts', 'sample.ts', 'prepared.ts', 'pose.ts', 'build-pose.ts'];
    const banned = /(from\s+['"](pixi\.js|@pixi\/[^'"]+|react|react-dom)['"])/;
    for (const file of files) {
      const source = readFileSync(new URL(`../src/skeleton/${file}`, import.meta.url), 'utf8');
      expect(banned.test(source)).toBe(false);
    }
  });
});
