import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { SkeletonDocument } from '@marionette/format/types';
import type { EffectsDocument } from '@marionette/format/effects-types';
import type { GridSize, SpinResult } from '@marionette/math-bridge';
import type { SlotScene } from '@marionette/format/slot-types';
import { validateRig } from './schema/rig';
import { validateSampleSpec } from './schema/sample-spec';
import { validateFixture } from './schema/fixture';
import { validateEffectsRig } from './schema/effects-rig';
import { validateEffectsSampleSpec } from './schema/effects-sample-spec';
import { validateEffectsFixture } from './schema/effects-fixture';
import { validateSlotSpin } from './schema/slot-spin';
import { validateSlotSceneValue } from './schema/slot-scene';
import { validateSlotSampleSpec } from './schema/slot-sample-spec';
import { validateSlotFixture } from './schema/slot-fixture';
import type { SampleSpec } from './schema/sample-spec';
import type { Fixture } from './schema/fixture';
import type { EffectsSampleSpec } from './schema/effects-sample-spec';
import type { EffectsFixture } from './schema/effects-fixture';
import type { SlotSampleSpec } from './schema/slot-sample-spec';
import type { SlotFixture } from './schema/slot-fixture';

// Filesystem plumbing for the conformance corpus: path resolution, validating loaders, deterministic
// writers, and the sha256 used by the .fixtures.lock manifest. This is the only module in the package
// that touches the filesystem; the pure builder (build-fixture.ts) and the compare engine never do.
// The loaders validate on read (Law 3), so a malformed committed artifact fails loudly rather than
// flowing a bad value into a comparison.

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

// src -> packages/conformance -> packages -> repo root.
export const REPO_ROOT = join(SRC_DIR, '..', '..', '..');

export function rigPath(rigId: string): string {
  return join(SRC_DIR, 'rigs', `${rigId}.json`);
}

// The committed binary rig TWIN (phase-5 WP-5.1, TASK-5.1.6): the MRNT encoding of the JSON rig, beside
// it under rigs/<rigId>.bin. These are the files the native runtimes load in conformance (WP-5.3/5.4),
// proving the shipping binary load path, not just JSON. Unlike the solve fixtures (which store
// V8-computed cos/sin as shortest round-trippable JSON and so are toolchain-pinned), the twin bytes are
// a pure byte re-encoding of the rig's authored literal numbers, so they are toolchain-INDEPENDENT and
// byte-exact on any Node.
export function rigBinPath(rigId: string): string {
  return join(SRC_DIR, 'rigs', `${rigId}.bin`);
}

export function specPath(rigId: string): string {
  return join(SRC_DIR, 'sample-spec', `${rigId}.sample-spec.json`);
}

export function fixturePath(rigId: string): string {
  return join(SRC_DIR, 'fixtures', `${rigId}.fixture.json`);
}

// The drift-tripwire manifest path (A.6). A dotfile so it sits beside the fixtures it locks.
export const LOCK_PATH = join(SRC_DIR, 'fixtures', '.fixtures.lock');

export function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

export function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

export function readBytes(path: string): Uint8Array {
  return readFileSync(path);
}

// Lowercase-hex sha256 of a UTF-8 string. Used for the file hashes in .fixtures.lock and the
// rigHash/specHash provenance fields. Deterministic and content-addressed (A.6).
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// Lowercase-hex sha256 of raw bytes. Used for the binary rig twin entry in .fixtures.lock (A.6); the
// twin is binary, so it is hashed over its bytes, not as UTF-8 text.
export function sha256HexBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadRig(rigId: string): SkeletonDocument {
  return validateRig(readJson(rigPath(rigId)));
}

export function loadSampleSpec(rigId: string): SampleSpec {
  return validateSampleSpec(readJson(specPath(rigId)));
}

export function loadFixture(rigId: string): Fixture {
  return validateFixture(readJson(fixturePath(rigId)));
}

// --- Effects (particle) conformance corpus (phase-3-vfx-particles.md WP-3.10) ---
// A PARALLEL track to the skeleton corpus above. Effects rigs are full EffectsDocuments under
// effects-rigs/, sample-specs under effects-sample-spec/, and committed particle fixtures under
// effects-fixtures/ with their own .effects-fixtures.lock manifest. The skeleton paths are untouched.

export function effectsRigPath(effectId: string): string {
  return join(SRC_DIR, 'effects-rigs', `${effectId}.fx.json`);
}

export function effectsSpecPath(effectId: string): string {
  return join(SRC_DIR, 'effects-sample-spec', `${effectId}.sample-spec.json`);
}

export function effectsFixturePath(effectId: string): string {
  return join(SRC_DIR, 'effects-fixtures', `${effectId}.fixture.json`);
}

// The effects drift-tripwire manifest path (A.6), a dotfile beside the effects fixtures it locks.
export const EFFECTS_LOCK_PATH = join(SRC_DIR, 'effects-fixtures', '.effects-fixtures.lock');

export function loadEffectsRig(effectId: string): EffectsDocument {
  return validateEffectsRig(readJson(effectsRigPath(effectId)));
}

export function loadEffectsSampleSpec(effectId: string): EffectsSampleSpec {
  return validateEffectsSampleSpec(readJson(effectsSpecPath(effectId)));
}

export function loadEffectsFixture(effectId: string): EffectsFixture {
  return validateEffectsFixture(readJson(effectsFixturePath(effectId)));
}

// --- Slot golden-playback conformance corpus (phase-4-slot-composer.md WP-4.13) ---
// A THIRD PARALLEL track to the skeleton + effects corpora. Committed SpinResult inputs are under
// slot/spins/, authored SlotScene values under slot/scenes/, per-pair sample-specs under slot/sample-spec/,
// and committed timeline goldens under slot/expected/ with their own .slot.fixtures.lock manifest. The
// skeleton and effects paths are untouched.

export function slotSpinPath(spinId: string): string {
  return join(SRC_DIR, 'slot', 'spins', `${spinId}.spin.json`);
}

export function slotScenePath(sceneId: string): string {
  return join(SRC_DIR, 'slot', 'scenes', `${sceneId}.slotscene.json`);
}

export function slotSpecPath(pairId: string): string {
  return join(SRC_DIR, 'slot', 'sample-spec', `${pairId}.sample-spec.json`);
}

export function slotFixturePath(pairId: string): string {
  return join(SRC_DIR, 'slot', 'expected', `${pairId}.timeline.json`);
}

// The slot drift-tripwire manifest path (A.6), a dotfile beside the slot timeline goldens it locks.
export const SLOT_LOCK_PATH = join(SRC_DIR, 'slot', 'expected', '.slot.fixtures.lock');

export function loadSlotSpin(spinId: string, gridSize: GridSize): SpinResult {
  return validateSlotSpin(readJson(slotSpinPath(spinId)), gridSize);
}

export function loadSlotScene(sceneId: string): SlotScene {
  return validateSlotSceneValue(readJson(slotScenePath(sceneId)));
}

export function loadSlotSampleSpec(pairId: string): SlotSampleSpec {
  return validateSlotSampleSpec(readJson(slotSpecPath(pairId)));
}

export function loadSlotFixture(pairId: string): SlotFixture {
  return validateSlotFixture(readJson(slotFixturePath(pairId)));
}

// --- Particle perf baseline (phase-3-vfx-particles.md WP-3.9, TASK-3.9.4/3.9.5) ---
// The single committed source of the caps/budget/tier perf thresholds. The perf gate
// (phase3-perf-gates.test.ts) and the DoD acceptance harness (phase3-acceptance.ts) both read it from
// here, so a perf bound lives in exactly one reviewed artifact (perf/baseline.json), never as a magic
// number duplicated across tests. The values are CONSERVATIVE DEFAULTS; device-tier tuning is Phase 5.

export interface PerfBaseline {
  readonly note: string;
  readonly maxLiveParticles: number;
  readonly referenceTier: 'low' | 'medium' | 'high';
  readonly qualityTierScale: Readonly<Record<'low' | 'medium' | 'high', number>>;
  readonly acceptanceRun: { readonly frames: number; readonly simulationDt: number };
  readonly perFrameStepHeapBudgetBytes: number;
  readonly perFrameStepHeapBudgetFrames: number;
}

// src -> packages/conformance, then into perf/.
export const PERF_BASELINE_PATH = join(SRC_DIR, '..', 'perf', 'baseline.json');

// Read the committed perf baseline. A narrow runtime check keeps a malformed baseline from silently
// feeding NaN thresholds into a gate (Law 3 fail-loud, applied to the perf artifact).
export function loadPerfBaseline(): PerfBaseline {
  const raw = readJson(PERF_BASELINE_PATH) as Partial<PerfBaseline>;
  const tier = raw.qualityTierScale;
  if (
    typeof raw.maxLiveParticles !== 'number' ||
    typeof raw.perFrameStepHeapBudgetBytes !== 'number' ||
    tier === undefined ||
    typeof tier.low !== 'number' ||
    typeof tier.medium !== 'number' ||
    typeof tier.high !== 'number'
  ) {
    throw new Error('perf/baseline.json is malformed (missing a required numeric threshold)');
  }
  return raw as PerfBaseline;
}
