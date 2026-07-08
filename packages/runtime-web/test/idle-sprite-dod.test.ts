import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_FORMAT_VERSION, validateDocument, verifyContentHash } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  MAT2X3_STRIDE,
  sampleSkeleton,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { loopTime, samplePlaybackWorlds } from '../src';
import type { SampledFrame } from '../src';

// WP-1.13: the Phase 1 Definition-of-Done acceptance harness (phase-1-bone-puppet.md section 11.2). It
// loads the COMMITTED idle-sprite rig + sample-time list from packages/conformance/assets/ and proves
// the milestone: the editor's solve path and runtime-web's playback path animate the idle loop
// IDENTICALLY, the loop does not drift across iterations, and it loops seamlessly (no pop).
//
// What this proves and what it does NOT (LAW 1). The editor viewport (SkeletonView.syncAnimated) and
// the runtime-web playback path both call the SAME runtime-core sampleSkeleton symbol. So agreement
// here proves DETERMINISM (same document + same time => identical transforms, every time) and
// NON-PERTURBATION across the editor/runtime boundary (the two call sites cannot diverge while sharing
// the solve). It is NOT a cross-implementation correctness check; the runtime-core-vs-Unity/Godot
// question is the conformance suite's job in Phase 5, against the cross-runtime fixtures, not this rig.
//
// Tolerance choice. Because both paths run the identical solve, the assertions below use EXACT (deep)
// equality, not the A.5 tolerance. Exact equality is the strongest possible statement of determinism +
// non-perturbation: any difference would be a real bug, never float-reorder noise. The conformance A.5
// tolerance machinery (packages/conformance/compare/tolerance.ts) is deliberately NOT pulled in here;
// that band exists to absorb cross-runtime f64 differences (Phase 5), a different question.

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repo root (pnpm-workspace.yaml) not found above the test file');
    }
    dir = parent;
  }
  return dir;
}

const ASSET_DIR = join(repoRoot(), 'packages', 'conformance', 'assets', 'idle-sprite');
const RIG_PATH = join(ASSET_DIR, 'idle-sprite.rig.json');
const SAMPLE_LIST_PATH = join(ASSET_DIR, 'idle-sprite.sample-list.json');
const ANIMATION_NAME = 'idle';

// Load + VALIDATE the committed rig (DoD step 1, TASK-1.13.1: the export validates). Fails loudly with
// the exact FormatError list if the committed file ever drifts out of contract.
function loadRig(): SkeletonDocument {
  const raw: unknown = JSON.parse(readFileSync(RIG_PATH, 'utf8'));
  const report = validateDocument(raw, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new Error(`idle-sprite.rig.json failed validation: ${JSON.stringify(report.errors)}`);
  }
  return report.document;
}

// Read the committed sample-time list. Times live ONLY in this file so the harness cannot drift from
// them; we validate the shape on read (Law 3) rather than trust a hand-edited JSON array.
function loadSampleTimes(): number[] {
  const raw: unknown = JSON.parse(readFileSync(SAMPLE_LIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('idle-sprite.sample-list.json must be a JSON array');
  const times: number[] = [];
  for (const element of raw) {
    if (typeof element !== 'number' || !Number.isFinite(element)) {
      throw new Error('idle-sprite.sample-list.json must contain only finite numbers');
    }
    times.push(element);
  }
  return times;
}

// The editor's solve path: call runtime-core sampleSkeleton into a pose directly (the exact symbol the
// editor viewport's SkeletonView.syncAnimated drives) and read bone world affines + tips out of
// pose.world the same way the player does. This is implemented INDEPENDENTLY of samplePlaybackWorlds so
// the agreement assertion compares two distinct call sites of the SAME sampleSkeleton, not a function
// against itself.
function sampleEditorPath(document: SkeletonDocument, times: readonly number[]): SampledFrame[] {
  const pose = buildPose(document);
  const boneCount = document.bones.length;
  const frames: SampledFrame[] = [];
  for (const time of times) {
    sampleSkeleton(document, ANIMATION_NAME, time, pose);
    const worlds: Mat2x3[] = [];
    const tips: (readonly [number, number])[] = [];
    for (let i = 0; i < boneCount; i += 1) {
      const base = i * MAT2X3_STRIDE;
      const affine: Mat2x3 = [
        pose.world[base]!,
        pose.world[base + 1]!,
        pose.world[base + 2]!,
        pose.world[base + 3]!,
        pose.world[base + 4]!,
        pose.world[base + 5]!,
      ];
      worlds.push(affine);
      tips.push(transformPoint(affine, document.bones[i]!.length, 0));
    }
    frames.push({ time, worlds, tips });
  }
  return frames;
}

const RIG = loadRig();
const SAMPLE_TIMES = loadSampleTimes();
const DURATION = RIG.animations[ANIMATION_NAME]!.duration;

describe('idle-sprite Phase 1 DoD acceptance (WP-1.13)', () => {
  it('validates the committed rig clean with a verified content hash (TASK-1.13.1)', () => {
    const raw: unknown = JSON.parse(readFileSync(RIG_PATH, 'utf8'));

    const report = validateDocument(raw, { verifyHash: true });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(verifyContentHash(RIG)).toBe(true);
    expect(RIG.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    // The committed rig is a 0.1.0 document; loading it forward-migrates through the chain to the current
    // version, injecting the now-required empty ik/transform/deform timelines (0.2.0, ADR-0004) and the
    // drawOrder/events timelines (0.3.0, ADR-0008). The strict Animation shape is therefore these eight
    // keys (every added collection is present but empty).
    expect(Object.keys(RIG.animations[ANIMATION_NAME]!).sort()).toEqual([
      'bones',
      'deform',
      'drawOrder',
      'duration',
      'events',
      'ik',
      'slots',
      'transform',
    ]);
  });

  it('agrees EXACTLY between the editor solve path and the runtime-web playback path (TASK-1.13.2)', () => {
    const editor = sampleEditorPath(RIG, SAMPLE_TIMES);
    const runtime = samplePlaybackWorlds(RIG, ANIMATION_NAME, SAMPLE_TIMES);

    expect(runtime).toHaveLength(editor.length);
    for (let f = 0; f < editor.length; f += 1) {
      // Deep (bitwise) equality: both paths call the identical sampleSkeleton, so every bone world
      // affine and derived tip must match exactly. This is the determinism + non-perturbation proof
      // across the web boundary (see the file header for why exact, not A.5).
      expect(runtime[f]!.time).toBe(editor[f]!.time);
      expect(runtime[f]!.worlds).toEqual(editor[f]!.worlds);
      expect(runtime[f]!.tips).toEqual(editor[f]!.tips);
    }
  });

  it('does not drift across 10 loop iterations: a reused pose buffer stays stable (TASK-1.13.3)', () => {
    const inCycle = SAMPLE_TIMES.filter((time) => time < DURATION);
    expect(inCycle.length).toBeGreaterThan(0);

    // Replay the in-cycle phases across 10 loop cycles through ONE reused pose buffer
    // (samplePlaybackWorlds builds the pose once and samples every time into it). loopTime is the
    // transport wrap; on an in-cycle phase it is the identity, so each cycle revisits the identical
    // phase value, and asserting cycle k matches cycle 0 phase-for-phase proves the solve accumulates
    // NO drift in the reused buffer across loops.
    //
    // We fold each phase ONCE (loopTime(t, DURATION)) instead of feeding `t + k*DURATION`: for the
    // pinned non-binary duration (1.2), the elapsed-fold `(t + k*D) % D` carries sub-ULP f64 error
    // (for example 3 * 1.2 is 3.5999999999999996, which folds to ~1.2, not 0). That residual is a
    // property of loopTime's float arithmetic, NOT solve drift, and would defeat the exact equality
    // this milestone asserts. It is the conformance suite's A.5 concern (Phase 5), not the solve
    // determinism claim under test here.
    const CYCLES = 10;
    const phases = inCycle.map((time) => loopTime(time, DURATION));
    const times: number[] = [];
    for (let cycle = 0; cycle < CYCLES; cycle += 1) times.push(...phases);

    const frames = samplePlaybackWorlds(RIG, ANIMATION_NAME, times);
    for (let cycle = 1; cycle < CYCLES; cycle += 1) {
      for (let phase = 0; phase < phases.length; phase += 1) {
        const base = frames[phase]!;
        const later = frames[cycle * phases.length + phase]!;
        expect(later.worlds).toEqual(base.worlds);
        expect(later.tips).toEqual(base.tips);
      }
    }
  });

  it('loops seamlessly: pose(0) and pose(duration) are identical (TASK-1.13.4)', () => {
    const [start, end] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [0, DURATION]);

    // The idle rig has matched endpoints (first keyframe value == last per channel). With the
    // single-period clamp, pose(0) composes the first-key deltas and pose(duration) the last-key
    // deltas, which are equal, so the world affines and tips are bitwise identical: no pop at the seam.
    // No-drift (above) does not prove this; matched endpoints do (TASK-1.4.7).
    expect(end!.worlds).toEqual(start!.worlds);
    expect(end!.tips).toEqual(start!.tips);
  });

  it('clamps the past-duration sample (t > duration) to the final pose', () => {
    // The committed sample list ends at 1.35 > duration (1.2) to pin the clamp: sampleSkeleton is a
    // single-period function that clamps (it does NOT wrap), so pose(1.35) == pose(duration). Clamp and
    // the loop fold are different operations (1.35 would fold to 0.15 under loopTime); both are exercised.
    const past = SAMPLE_TIMES[SAMPLE_TIMES.length - 1]!;
    expect(past).toBeGreaterThan(DURATION);

    const [pastFrame, endFrame] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [past, DURATION]);
    expect(pastFrame!.worlds).toEqual(endFrame!.worlds);
    expect(pastFrame!.tips).toEqual(endFrame!.tips);
  });

  it('moves the rig between distinct in-cycle times (the equalities above are not vacuous)', () => {
    // Two between-key times with genuinely different authored deltas must yield different world affines;
    // otherwise the agreement/loop/seamless equalities could pass on a rig that never animates.
    const [a, b] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [0.3, 0.6]);
    expect(b!.worlds).not.toEqual(a!.worlds);
  });
});
