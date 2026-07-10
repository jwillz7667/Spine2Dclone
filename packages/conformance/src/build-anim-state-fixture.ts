import {
  applyAnimationState,
  buildPose,
  clearTrack,
  crossfadeTo,
  makeAnimationState,
  MAT2X3_STRIDE,
  queueAnimation,
  setAnimation,
  updateAnimationState,
} from '@marionette/runtime-core';
import type { AnimationState, Pose, TrackEntry } from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';
import type {
  AnimStateAffine,
  AnimStateFixture,
  AnimStateFixtureSample,
} from './schema/anim-state-fixture';
import type { AnimStateScenario } from './schema/anim-state-scenario';

// The pure anim-state fixture builder (ADR-0005 conformance family, INV-2). It imports
// @marionette/runtime-core (AnimationState) and @marionette/format types ONLY: no filesystem, no clock, no
// random. It replays a validated scenario through AnimationState and captures the solved pose at every
// `capture` op, so the fixture is a pure function of (rig, scenario, runtime-core). generate-anim-state.ts
// wraps this with file I/O and provenance.

export interface AnimStateProvenance {
  readonly scenarioId: string;
  readonly rigId: string;
  readonly scenarioHash: string;
  readonly rigHash: string;
  readonly coreVersion: string;
  readonly toolchain: string;
  readonly generatedBy: string;
}

function readAffine(world: Float64Array, boneIndex: number): AnimStateAffine {
  const o = boneIndex * MAT2X3_STRIDE;
  return [world[o]!, world[o + 1]!, world[o + 2]!, world[o + 3]!, world[o + 4]!, world[o + 5]!];
}

// Capture the current solved pose: every bone's world affine (document order) and every slot's active
// attachment name. The pose must have just been solved by applyAnimationState.
function captureSample(
  pose: Pose,
  index: number,
  time: number,
  label?: string,
): AnimStateFixtureSample {
  const bones: Record<string, AnimStateAffine> = {};
  for (let i = 0; i < pose.boneNames.length; i += 1) {
    bones[pose.boneNames[i]!] = readAffine(pose.world, i);
  }
  const slots: Record<string, string | null> = {};
  for (let i = 0; i < pose.slotNames.length; i += 1) {
    slots[pose.slotNames[i]!] = pose.slotAttachment[i] ?? null;
  }
  return label === undefined ? { index, time, bones, slots } : { index, time, label, bones, slots };
}

// Apply an op's author-configurable fields (alpha, additive) onto the returned entry handle.
function configureEntry(
  entry: TrackEntry,
  op: { readonly additive?: boolean | undefined; readonly alpha?: number | undefined },
): void {
  if (op.additive !== undefined) entry.additive = op.additive;
  if (op.alpha !== undefined) entry.alpha = op.alpha;
}

// Replay the scenario against a fresh AnimationState + pose, capturing the solved pose at every capture op.
export function buildAnimStateSamples(
  document: SkeletonDocument,
  scenario: AnimStateScenario,
): AnimStateFixtureSample[] {
  const pose = buildPose(document);
  const state: AnimationState = makeAnimationState(document);
  const samples: AnimStateFixtureSample[] = [];
  let time = 0;
  let captureIndex = 0;
  // The active skin for skin-scoped constraints (ADR-0011 section 4), set by a `setSkin` op. null leaves only
  // the always-active 'default' skin active, so every existing scenario (which never sets a skin) captures
  // exactly as before, byte-identical.
  let activeSkin: string | null = null;

  for (const op of scenario.ops) {
    switch (op.op) {
      case 'set': {
        const entry = setAnimation(state, op.track, op.animation, op.loop);
        configureEntry(entry, op);
        break;
      }
      case 'crossfade': {
        const entry = crossfadeTo(state, op.track, op.animation, op.loop, op.mixDuration);
        configureEntry(entry, op);
        break;
      }
      case 'queue': {
        queueAnimation(state, op.track, op.animation, op.loop, op.delay);
        break;
      }
      case 'clear': {
        clearTrack(state, op.track);
        break;
      }
      case 'advance': {
        updateAnimationState(state, op.dt);
        time += op.dt;
        break;
      }
      case 'setSkin': {
        activeSkin = op.skin;
        break;
      }
      case 'capture': {
        applyAnimationState(state, pose, activeSkin);
        samples.push(captureSample(pose, captureIndex, time, op.label));
        captureIndex += 1;
        break;
      }
    }
  }

  return samples;
}

export function buildAnimStateFixture(
  document: SkeletonDocument,
  scenario: AnimStateScenario,
  provenance: AnimStateProvenance,
): AnimStateFixture {
  return {
    scenarioId: provenance.scenarioId,
    rigId: provenance.rigId,
    scenarioHash: provenance.scenarioHash,
    rigHash: provenance.rigHash,
    coreVersion: provenance.coreVersion,
    toolchain: provenance.toolchain,
    generatedBy: provenance.generatedBy,
    samples: buildAnimStateSamples(document, scenario),
  };
}
