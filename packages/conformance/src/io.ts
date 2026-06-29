import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { SkeletonDocument } from '@marionette/format/types';
import type { EffectsDocument } from '@marionette/format/effects-types';
import { validateRig } from './schema/rig';
import { validateSampleSpec } from './schema/sample-spec';
import { validateFixture } from './schema/fixture';
import { validateEffectsRig } from './schema/effects-rig';
import { validateEffectsSampleSpec } from './schema/effects-sample-spec';
import { validateEffectsFixture } from './schema/effects-fixture';
import type { SampleSpec } from './schema/sample-spec';
import type { Fixture } from './schema/fixture';
import type { EffectsSampleSpec } from './schema/effects-sample-spec';
import type { EffectsFixture } from './schema/effects-fixture';

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

// Lowercase-hex sha256 of a UTF-8 string. Used for the file hashes in .fixtures.lock and the
// rigHash/specHash provenance fields. Deterministic and content-addressed (A.6).
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
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
