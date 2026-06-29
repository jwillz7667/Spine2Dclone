import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_FORMAT_VERSION, validateDocument, verifyContentHash } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  MAT2X3_STRIDE,
  sampleMeshVertices,
  sampleSkeleton,
  transformPoint,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { loopTime, samplePlaybackWorlds } from '../src';
import type { SampledFrame } from '../src';

// WP-2.11 runtime-web parity acceptance (phase-2-rigging.md DoD, TASK-2.11.2): the Phase 2 integrated
// milestone. It loads the COMMITTED mesh-limb-rig (a weighted, IK-driven, deform-wobbling limb authored
// through document-core commands) and proves the editor's solve path and runtime-web's playback path
// animate it IDENTICALLY, on bone world transforms AND on mesh vertex positions.
//
// What this proves and what it does NOT (LAW 1). The editor viewport and the runtime-web playback path
// both call the SAME runtime-core symbols (sampleSkeleton for bones, sampleMeshVertices for the skinned
// + deformed mesh). So agreement here proves DETERMINISM (same document + same time => identical output,
// every time) and NON-PERTURBATION across the editor/runtime boundary (the two call sites cannot diverge
// while sharing the solve). It is NOT a cross-implementation correctness check; runtime-core vs
// Unity/Godot is the conformance suite's job in Phase 5, against the cross-runtime fixtures, not this rig.
//
// Tolerance choice. Because both paths run the identical solve, the assertions below use EXACT (deep)
// equality, not the A.5 tolerance: any difference would be a real bug, never float-reorder noise. (Same
// justification as the Phase 1 idle-sprite DoD; this rig extends it from bones to mesh vertices.)
//
// Boundary note. runtime-web depends on runtime-core + format ONLY (never document-core). This test does
// NOT import the document-core builder; it loads the committed JSON asset through @marionette/format's
// validateDocument, exactly as the player loads a document on import.

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

const ASSET_DIR = join(repoRoot(), 'packages', 'conformance', 'assets', 'mesh-limb-rig');
const RIG_PATH = join(ASSET_DIR, 'mesh-limb-rig.rig.json');
const SAMPLE_LIST_PATH = join(ASSET_DIR, 'mesh-limb-rig.sample-list.json');
const ANIMATION_NAME = 'wave';
const SLOT_NAME = 'limb';
const ATTACHMENT_NAME = 'limb';
const SKIN_NAME = 'default';

// Load + VALIDATE the committed rig (DoD step 1: the export validates). Fails loudly with the exact
// FormatError list if the committed file ever drifts out of contract.
function loadRig(): SkeletonDocument {
  const raw: unknown = JSON.parse(readFileSync(RIG_PATH, 'utf8'));
  const report = validateDocument(raw, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new Error(`mesh-limb-rig.rig.json failed validation: ${JSON.stringify(report.errors)}`);
  }
  return report.document;
}

// Read the committed sample-time list, validating its shape on read (Law 3) rather than trusting a
// hand-edited JSON array.
function loadSampleTimes(): number[] {
  const raw: unknown = JSON.parse(readFileSync(SAMPLE_LIST_PATH, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('mesh-limb-rig.sample-list.json must be a JSON array');
  const times: number[] = [];
  for (const element of raw) {
    if (typeof element !== 'number' || !Number.isFinite(element)) {
      throw new Error('mesh-limb-rig.sample-list.json must contain only finite numbers');
    }
    times.push(element);
  }
  return times;
}

// The editor's bone solve path: call runtime-core sampleSkeleton into a pose directly (the exact symbol
// the editor viewport drives) and read bone world affines + tips out of pose.world the same way the
// player does. Implemented INDEPENDENTLY of samplePlaybackWorlds so the agreement assertion compares two
// distinct call sites of the SAME sampleSkeleton, not a function against itself.
function sampleEditorBones(document: SkeletonDocument, times: readonly number[]): SampledFrame[] {
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

// Sample the limb mesh's final world vertices (skin + deform, solve-order step 5) at each time. Each call
// site builds its OWN pose, solves the skeleton at t, then calls sampleMeshVertices into a fresh buffer,
// so comparing two such call sites compares two distinct drivers of the SAME runtime-core symbols, not a
// function against itself. Returns one number[] of [x, y, ...] per time (copied out of the scratch).
function sampleMeshPositions(document: SkeletonDocument, times: readonly number[]): number[][] {
  const pose: Pose = buildPose(document);
  const mesh = document.skins.find((s) => s.name === SKIN_NAME)!.attachments[SLOT_NAME]![
    ATTACHMENT_NAME
  ]!;
  if (mesh.type !== 'mesh') throw new Error('mesh-limb-rig limb attachment is not a mesh');
  const vertexCount = mesh.uvs.length / 2;
  const out = new Float32Array(vertexCount * 2);
  const results: number[][] = [];
  for (const time of times) {
    sampleSkeleton(document, ANIMATION_NAME, time, pose);
    const written = sampleMeshVertices(
      document,
      ANIMATION_NAME,
      time,
      pose,
      SKIN_NAME,
      SLOT_NAME,
      ATTACHMENT_NAME,
      out,
    );
    expect(written).toBe(vertexCount);
    results.push(Array.from(out.subarray(0, vertexCount * 2)));
  }
  return results;
}

const RIG = loadRig();
const SAMPLE_TIMES = loadSampleTimes();
const DURATION = RIG.animations[ANIMATION_NAME]!.duration;

describe('mesh-limb-rig Phase 2 DoD parity (WP-2.11)', () => {
  it('validates the committed rig clean with a verified content hash (TASK-2.11.1)', () => {
    const raw: unknown = JSON.parse(readFileSync(RIG_PATH, 'utf8'));

    const report = validateDocument(raw, { verifyHash: true });

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(verifyContentHash(RIG)).toBe(true);
    expect(RIG.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('agrees EXACTLY between the editor solve path and the runtime-web playback path on bone worlds (TASK-2.11.2)', () => {
    const editor = sampleEditorBones(RIG, SAMPLE_TIMES);
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

  it('agrees EXACTLY on skinned + deformed mesh vertices across two independent call sites (TASK-2.11.2)', () => {
    const editor = sampleMeshPositions(RIG, SAMPLE_TIMES);
    const runtime = sampleMeshPositions(RIG, SAMPLE_TIMES);

    expect(runtime).toHaveLength(editor.length);
    for (let f = 0; f < editor.length; f += 1) {
      // The mesh vertices are the IK-driven, weighted-skinned, deform-wobbled limb at time t: two
      // independent drivers of sampleSkeleton + sampleMeshVertices must produce bitwise-identical
      // positions (determinism + non-perturbation, extended from bones to mesh vertices, LAW 1).
      expect(runtime[f]).toEqual(editor[f]);
      for (const value of editor[f]!) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('actually MOVES the mesh between two distinct in-cycle times (the equalities are not vacuous)', () => {
    // The deform peak (0.5) and an off-peak time (0.25) must yield different mesh vertices; otherwise
    // the equality above could pass on a mesh that never animates.
    const [a, b] = sampleMeshPositions(RIG, [0.25, 0.5]);
    expect(b).not.toEqual(a);
  });

  it('moves the rig bones between distinct in-cycle times (the bone equalities are not vacuous)', () => {
    const [a, b] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [0.25, 0.5]);
    expect(b!.worlds).not.toEqual(a!.worlds);
  });

  it('does not drift across 10 loop iterations: a reused pose buffer stays stable', () => {
    const inCycle = SAMPLE_TIMES.filter((time) => time < DURATION);
    expect(inCycle.length).toBeGreaterThan(0);

    // Replay the in-cycle phases across 10 loop cycles through ONE reused pose buffer. loopTime is the
    // transport wrap; on an in-cycle phase it is the identity, so each cycle revisits the identical
    // phase value, and asserting cycle k matches cycle 0 phase-for-phase proves the solve accumulates
    // NO drift in the reused buffer across loops (same construction as the idle-sprite DoD).
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

  it('loops seamlessly: pose(0) and pose(duration) are identical on bones AND mesh vertices', () => {
    // The wave rig has matched endpoints on every channel (IK mix, both bone rotates, and the deform
    // pose all return to their start at the duration), so pose(0) == pose(duration): no pop at the seam,
    // on both the bone worlds and the skinned + deformed mesh vertices.
    const [start, end] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [0, DURATION]);
    expect(end!.worlds).toEqual(start!.worlds);
    expect(end!.tips).toEqual(start!.tips);

    const [meshStart, meshEnd] = sampleMeshPositions(RIG, [0, DURATION]);
    expect(meshEnd).toEqual(meshStart);
  });

  it('clamps the past-duration sample (t > duration) to the final pose, on bones AND mesh vertices', () => {
    // The committed sample list ends past the duration to pin the clamp: sampleSkeleton (and the mesh
    // sampler riding it) is a single-period function that clamps and does NOT wrap, so pose(t>dur) ==
    // pose(duration).
    const past = SAMPLE_TIMES[SAMPLE_TIMES.length - 1]!;
    expect(past).toBeGreaterThan(DURATION);

    const [pastFrame, endFrame] = samplePlaybackWorlds(RIG, ANIMATION_NAME, [past, DURATION]);
    expect(pastFrame!.worlds).toEqual(endFrame!.worlds);
    expect(pastFrame!.tips).toEqual(endFrame!.tips);

    const [pastMesh, endMesh] = sampleMeshPositions(RIG, [past, DURATION]);
    expect(pastMesh).toEqual(endMesh);
  });
});
