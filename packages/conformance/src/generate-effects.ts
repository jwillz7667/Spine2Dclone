import process from 'node:process';
import { join } from 'node:path';
import { buildEffectsFixture } from './build-effects-fixture';
import { validateEffectsRig } from './schema/effects-rig';
import { validateEffectsSampleSpec } from './schema/effects-sample-spec';
import { validateEffectsFixture } from './schema/effects-fixture';
import type { EffectsFixture } from './schema/effects-fixture';
import { LANDED_EFFECT_IDS, type EffectId } from './registry';
import {
  EFFECTS_LOCK_PATH,
  effectsFixturePath,
  effectsRigPath,
  effectsSpecPath,
  readJson,
  readText,
  REPO_ROOT,
  sha256Hex,
  writeText,
} from './io';

// The particle (effects) fixture generator CLI (phase-3-vfx-particles.md WP-3.10, conformance-and-ci.md
// A.6). It is the PARALLEL of generate.ts: it loads each landed effect rig + sample-spec, runs the
// canonical effects solve via runtime-core (the pure build-effects-fixture.ts), writes the deterministic
// fixture JSON, and rewrites the .effects-fixtures.lock manifest. It is a pure function of (effects rig,
// sample-spec, runtime-core): no clock, no random beyond the seeded PRNG, so re-running it on the same
// toolchain yields a byte-identical tree (the CI drift gate runs this then `git diff --exit-code`). It
// does NOT touch the skeleton generator or the six Phase 2 skeleton fixtures.
//
// Run on the pinned toolchain: `nvm use $(cat .node-version) && pnpm --filter @marionette/conformance generate:effects`.
// Off-pin (this box is Node 22.22.2, not the pinned 22.13.1): set CONFORMANCE_ALLOW_UNPINNED=1. The
// fixtures are still stamped with the PINNED toolchain id; the tolerance-based effects-conformance test
// is Node-agnostic and passes, but the byte-exact lock is re-run on the pinned Node before it is
// authoritative (A.7), exactly as for the skeleton track.

class ToolchainMismatchError extends Error {
  override readonly name = 'ToolchainMismatchError';
  constructor(pinned: string, actual: string) {
    super(
      `effects conformance fixtures must be generated on the pinned Node ${pinned}, but this process ` +
        `is ${actual}. Run \`nvm use ${pinned}\` and re-run, or set CONFORMANCE_ALLOW_UNPINNED=1 for an ` +
        `off-pin dev box (the byte-exact lock is then re-run on the pinned Node before it is authoritative).`,
    );
  }
}

function pinnedNodeVersion(): string {
  return readText(join(REPO_ROOT, '.node-version')).trim();
}

// Enforce the pinned toolchain UNLESS CONFORMANCE_ALLOW_UNPINNED=1 (the same loud opt-in generate.ts
// uses). When overridden, fixtures are stamped with the PINNED toolchain id; only the byte-exact lock
// gate is non-authoritative until re-run on the real pinned Node.
function assertPinnedToolchain(pinned: string): void {
  const actual = process.version.replace(/^v/, '');
  if (actual === pinned) return;
  if (process.env.CONFORMANCE_ALLOW_UNPINNED === '1') {
    process.stderr.write(
      `WARNING: generating effects conformance fixtures on Node ${process.version}, not the pinned ` +
        `${pinned}. Float results may differ by a few ULPs (within the A.5 tolerance, so the tests ` +
        `pass), but the byte-exact lock is NOT authoritative until regenerated on the pinned Node (A.7).\n`,
    );
    return;
  }
  throw new ToolchainMismatchError(pinned, process.version);
}

function coreVersion(): string {
  const parsed: unknown = readJson(join(REPO_ROOT, 'packages', 'runtime-core', 'package.json'));
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    typeof parsed.version === 'string'
  ) {
    return `runtime-core@${parsed.version}`;
  }
  throw new Error('could not read runtime-core package version for effects fixture provenance');
}

// Deterministic, pretty JSON for the fixture (shortest round-trippable floats via JSON.stringify, so the
// re-parse is the exact same f64). Two-space indent, mirroring the manifest. The effects fixtures live
// under src/effects-fixtures and are prettier-ignored (the lock gate is a byte-exact diff), so this
// serializer owns their exact bytes.
function serializeFixture(fixture: EffectsFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function serializeLock(lock: LockManifest): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

// Parse optional effect-id arguments. With no args the generator rewrites EVERY landed effect (full lock
// rewrite). With args it regenerates ONLY those and MERGES their entries into the existing lock.
function parseTargets(): readonly EffectId[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return LANDED_EFFECT_IDS;
  const landed = new Set<string>(LANDED_EFFECT_IDS);
  for (const arg of args) {
    if (!landed.has(arg)) {
      throw new Error(
        `"${arg}" is not a landed effect id (landed: ${LANDED_EFFECT_IDS.join(', ')})`,
      );
    }
  }
  return args as EffectId[];
}

function readExistingLockFiles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readText(EFFECTS_LOCK_PATH));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'files' in parsed &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
    ) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed.files)) {
        if (typeof value === 'string') out[key] = value;
      }
      return out;
    }
  } catch {
    // No existing lock (first generation); start empty.
  }
  return {};
}

function main(): void {
  const pinned = pinnedNodeVersion();
  assertPinnedToolchain(pinned);

  const targets = parseTargets();
  const partial = targets.length !== LANDED_EFFECT_IDS.length;
  const toolchain = `node-${pinned}-v8`;
  const core = coreVersion();
  const lockFiles: Record<string, string> = partial ? readExistingLockFiles() : {};

  for (const effectId of targets) {
    const rigText = readText(effectsRigPath(effectId));
    const rigHash = `sha256:${sha256Hex(rigText)}`;
    const document = validateEffectsRig(JSON.parse(rigText));

    const specText = readText(effectsSpecPath(effectId));
    const specHash = `sha256:${sha256Hex(specText)}`;
    const spec = validateEffectsSampleSpec(JSON.parse(specText));

    const fixture = buildEffectsFixture(document, spec, {
      effectId,
      rigHash,
      specHash,
      coreVersion: core,
      toolchain,
      generatedBy: 'generate-effects.ts',
    });
    // Belt-and-suspenders: the producer validates its own output against the fixture schema (Law 3).
    validateEffectsFixture(fixture);

    const fixtureText = serializeFixture(fixture);
    writeText(effectsFixturePath(effectId), fixtureText);

    lockFiles[`effects-rigs/${effectId}.fx.json`] = sha256Hex(rigText);
    lockFiles[`effects-sample-spec/${effectId}.sample-spec.json`] = sha256Hex(specText);
    lockFiles[`effects-fixtures/${effectId}.fixture.json`] = sha256Hex(fixtureText);

    process.stdout.write(
      `generated effects-fixtures/${effectId}.fixture.json (${fixture.samples.length} samples)\n`,
    );
  }

  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(lockFiles).sort()) sortedFiles[key] = lockFiles[key]!;
  writeText(EFFECTS_LOCK_PATH, serializeLock({ toolchain, files: sortedFiles }));
  process.stdout.write('updated effects-fixtures/.effects-fixtures.lock\n');
}

main();
