import process from 'node:process';
import { join } from 'node:path';
import { buildSlotFixture } from './build-slot-fixture';
import { validateSlotSpin } from './schema/slot-spin';
import { validateSlotSceneValue } from './schema/slot-scene';
import { validateSlotSampleSpec } from './schema/slot-sample-spec';
import { validateSlotFixture } from './schema/slot-fixture';
import type { SlotFixture } from './schema/slot-fixture';
import { LANDED_SLOT_PAIR_IDS, SLOT_PAIRS, type SlotPairId } from './registry';
import {
  SLOT_LOCK_PATH,
  readJson,
  readText,
  REPO_ROOT,
  sha256Hex,
  slotFixturePath,
  slotScenePath,
  slotSpecPath,
  slotSpinPath,
  writeText,
} from './io';

// The slot golden-playback fixture generator CLI (phase-4-slot-composer.md WP-4.13, conformance-and-ci.md
// A.6). It is the PARALLEL of generate.ts / generate-effects.ts: it loads each landed (spin, scene) pair plus
// its sample-spec, runs the deterministic slot sequencer via runtime-core (the pure build-slot-fixture.ts),
// writes the timeline + rollup-sample golden JSON, and rewrites the .slot.fixtures.lock manifest. It is a
// pure function of (spin, scene, sample-spec, runtime-core): no clock, no random, so re-running it on the same
// toolchain yields a byte-identical tree (the CI drift gate runs this then `git diff --exit-code`). It does
// NOT touch the skeleton or effects generators or their committed fixtures.
//
// Run on the pinned toolchain: `nvm use $(cat .node-version) && pnpm --filter @marionette/conformance generate:slot`.
// Off-pin: set CONFORMANCE_ALLOW_UNPINNED=1. The slot data is ALL integer-ms + integer-unit + closed enums
// (no floats), so the byte-exact lock is Node-agnostic in practice; the pin discipline mirrors the other
// tracks for one consistent generation contract.

class ToolchainMismatchError extends Error {
  override readonly name = 'ToolchainMismatchError';
  constructor(pinned: string, actual: string) {
    super(
      `slot conformance fixtures must be generated on the pinned Node ${pinned}, but this process ` +
        `is ${actual}. Run \`nvm use ${pinned}\` and re-run, or set CONFORMANCE_ALLOW_UNPINNED=1 for an ` +
        `off-pin dev box (the slot data is integer-only, so the byte-exact lock is Node-agnostic).`,
    );
  }
}

function pinnedNodeVersion(): string {
  return readText(join(REPO_ROOT, '.node-version')).trim();
}

// Enforce the pinned toolchain UNLESS CONFORMANCE_ALLOW_UNPINNED=1 (the same loud opt-in the other generators
// use). When overridden, fixtures are stamped with the PINNED toolchain id.
function assertPinnedToolchain(pinned: string): void {
  const actual = process.version.replace(/^v/, '');
  if (actual === pinned) return;
  if (process.env.CONFORMANCE_ALLOW_UNPINNED === '1') {
    process.stderr.write(
      `WARNING: generating slot conformance fixtures on Node ${process.version}, not the pinned ` +
        `${pinned}. The slot timeline + rollup data is integer-only, so the bytes are Node-agnostic; the ` +
        `fixtures are stamped with the pinned toolchain id (A.7).\n`,
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
  throw new Error('could not read runtime-core package version for slot fixture provenance');
}

// Deterministic, pretty JSON for the fixture. Two-space indent, mirroring the manifest. The slot fixtures
// live under slot/expected and are prettier-ignored (the lock gate is a byte-exact diff), so this serializer
// owns their exact bytes.
function serializeFixture(fixture: SlotFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function serializeLock(lock: LockManifest): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

// Parse optional pair-id arguments. With no args the generator rewrites EVERY landed pair (full lock
// rewrite). With args it regenerates ONLY those and MERGES their entries into the existing lock.
function parseTargets(): readonly SlotPairId[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return LANDED_SLOT_PAIR_IDS;
  const landed = new Set<string>(LANDED_SLOT_PAIR_IDS);
  for (const arg of args) {
    if (!landed.has(arg)) {
      throw new Error(
        `"${arg}" is not a landed slot pair id (landed: ${LANDED_SLOT_PAIR_IDS.join(', ')})`,
      );
    }
  }
  return args as SlotPairId[];
}

function readExistingLockFiles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readText(SLOT_LOCK_PATH));
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
  const partial = targets.length !== LANDED_SLOT_PAIR_IDS.length;
  const toolchain = `node-${pinned}-v8`;
  const core = coreVersion();
  const lockFiles: Record<string, string> = partial ? readExistingLockFiles() : {};

  for (const pairId of targets) {
    const pair = SLOT_PAIRS[pairId]!;

    const spinText = readText(slotSpinPath(pair.spinId));
    const spinHash = `sha256:${sha256Hex(spinText)}`;
    const result = validateSlotSpin(JSON.parse(spinText), pair.gridSize);

    const sceneText = readText(slotScenePath(pair.sceneId));
    const sceneHash = `sha256:${sha256Hex(sceneText)}`;
    const scene = validateSlotSceneValue(JSON.parse(sceneText));

    const specText = readText(slotSpecPath(pairId));
    const specHash = `sha256:${sha256Hex(specText)}`;
    const spec = validateSlotSampleSpec(JSON.parse(specText));

    const fixture = buildSlotFixture(result, scene, spec.sampleMs, {
      pairId,
      sceneId: pair.sceneId,
      spinHash,
      sceneHash,
      specHash,
      coreVersion: core,
      toolchain,
      generatedBy: 'generate-slot.ts',
    });
    // Belt-and-suspenders: the producer validates its own output against the fixture schema (Law 3).
    validateSlotFixture(fixture);

    const fixtureText = serializeFixture(fixture);
    writeText(slotFixturePath(pairId), fixtureText);

    lockFiles[`spins/${pair.spinId}.spin.json`] = sha256Hex(spinText);
    lockFiles[`scenes/${pair.sceneId}.slotscene.json`] = sha256Hex(sceneText);
    lockFiles[`sample-spec/${pairId}.sample-spec.json`] = sha256Hex(specText);
    lockFiles[`expected/${pairId}.timeline.json`] = sha256Hex(fixtureText);

    process.stdout.write(
      `generated slot/expected/${pairId}.timeline.json (${fixture.timeline.directives.length} directives, ${fixture.rollups.length} rollup track(s))\n`,
    );
  }

  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(lockFiles).sort()) sortedFiles[key] = lockFiles[key]!;
  writeText(SLOT_LOCK_PATH, serializeLock({ toolchain, files: sortedFiles }));
  process.stdout.write('updated slot/expected/.slot.fixtures.lock\n');
}

main();
