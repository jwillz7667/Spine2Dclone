import { describe, expect, it } from 'vitest';
import type { SequenceMode, SkeletonDocument } from '@marionette/format/types';
import { buildPose, resolveSequenceFrame, sampleSkeleton, sampleSlotSequenceFrame } from '../src';

// ADR-0011 section 2: sequence-attachment frame resolution. The frame index is discrete integer math, so
// these assert exact values (no tolerance), mirroring the cross-language conformance lock.

describe('resolveSequenceFrame (ADR-0011 section 2)', () => {
  // count 4 (frames 0..3), delay 0.1; sample the advance at elapsed producing advanced = floor(e/0.1).
  const frame = (mode: SequenceMode, index: number, elapsed: number): number =>
    resolveSequenceFrame(mode, index, 0.1, 4, elapsed);

  it('hold stays on the key index regardless of elapsed', () => {
    expect([0, 0.35, 0.75].map((e) => frame('hold', 1, e))).toEqual([1, 1, 1]);
  });

  it('once advances forward and clamps on the last frame', () => {
    expect([0, 0.15, 0.35, 0.75].map((e) => frame('once', 0, e))).toEqual([0, 1, 3, 3]);
  });

  it('loop wraps modulo count', () => {
    expect([0, 0.15, 0.35, 0.55, 0.75].map((e) => frame('loop', 0, e))).toEqual([0, 1, 3, 1, 3]);
  });

  it('pingpong bounces between the ends', () => {
    expect([0, 0.15, 0.35, 0.55, 0.75].map((e) => frame('pingpong', 0, e))).toEqual([0, 1, 3, 1, 1]);
  });

  it('onceReverse advances backward and clamps at 0', () => {
    expect([0, 0.15, 0.35, 0.75].map((e) => frame('onceReverse', 3, e))).toEqual([3, 2, 0, 0]);
  });

  it('loopReverse wraps downward with a non-negative residue', () => {
    expect([0, 0.15, 0.35, 0.55, 0.75].map((e) => frame('loopReverse', 3, e))).toEqual([3, 2, 0, 2, 0]);
  });

  it('pingpongReverse bounces starting downward', () => {
    expect([0, 0.15, 0.35, 0.55, 0.75].map((e) => frame('pingpongReverse', 3, e))).toEqual([
      3, 2, 0, 2, 2,
    ]);
  });

  it('a non-positive delay advances no frames (holds on index)', () => {
    expect(resolveSequenceFrame('loop', 2, 0, 4, 5)).toBe(2);
  });

  it('a single-frame sequence always resolves to frame 0', () => {
    expect(resolveSequenceFrame('loop', 0, 0.1, 1, 5)).toBe(0);
  });
});

describe('sampleSlotSequenceFrame (ADR-0011 section 2)', () => {
  const region = (setupIndex: number): unknown => ({
    type: 'region',
    path: 't',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 8,
    height: 8,
    color: { r: 1, g: 1, b: 1, a: 1 },
    sequence: { count: 4, start: 0, digits: 2, setupIndex },
  });

  const doc = (): SkeletonDocument =>
    ({
      formatVersion: '0.4.0',
      name: 'seq-test',
      hash: '',
      bones: [
        {
          name: 'root',
          parent: null,
          length: 0,
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
        { name: 'played', bone: 'root', color: { r: 1, g: 1, b: 1, a: 1 }, attachment: 'a', blendMode: 'normal' },
        { name: 'setupOnly', bone: 'root', color: { r: 1, g: 1, b: 1, a: 1 }, attachment: 'a', blendMode: 'normal' },
        { name: 'plain', bone: 'root', color: { r: 1, g: 1, b: 1, a: 1 }, attachment: 'p', blendMode: 'normal' },
      ],
      skins: [
        {
          name: 'default',
          attachments: {
            played: { a: region(2) },
            setupOnly: { a: region(1) },
            plain: {
              p: {
                type: 'region',
                path: 'p',
                x: 0,
                y: 0,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                width: 8,
                height: 8,
                color: { r: 1, g: 1, b: 1, a: 1 },
              },
            },
          },
        },
      ],
      ikConstraints: [],
      transformConstraints: [],
      animations: {
        default: {
          duration: 1,
          bones: {},
          slots: { played: { sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }] } },
          ik: {},
          transform: {},
          deform: {},
          drawOrder: [],
          events: [],
        },
      },
      atlas: { pages: [] },
    }) as unknown as SkeletonDocument;

  it('resolves the active timeline frame for a slot with a sequence attachment', () => {
    const document = doc();
    const pose = buildPose(document);
    sampleSkeleton(document, 'default', 0.35, pose);
    // loop, index 0, delay 0.1, elapsed 0.35 -> advanced 3 -> (0 + 3) % 4 = 3.
    expect(sampleSlotSequenceFrame(document, 'default', 0.35, pose, 'played')).toBe(3);
  });

  it('shows the setup frame when the slot has a sequence attachment but no timeline', () => {
    const document = doc();
    const pose = buildPose(document);
    sampleSkeleton(document, 'default', 0.5, pose);
    expect(sampleSlotSequenceFrame(document, 'default', 0.5, pose, 'setupOnly')).toBe(1);
  });

  it('returns -1 for a slot whose active attachment has no sequence block', () => {
    const document = doc();
    const pose = buildPose(document);
    sampleSkeleton(document, 'default', 0.5, pose);
    expect(sampleSlotSequenceFrame(document, 'default', 0.5, pose, 'plain')).toBe(-1);
  });
});
