import process from 'node:process';
import { join } from 'node:path';
import { buildAnimStateFixture } from './build-anim-state-fixture';
import { validateRig } from './schema/rig';
import { validateAnimStateScenario } from './schema/anim-state-scenario';
import { validateAnimStateFixture } from './schema/anim-state-fixture';
import type { AnimStateFixture } from './schema/anim-state-fixture';
import { LANDED_ANIM_STATE_IDS, type AnimStateId } from './registry';
import {
  ANIM_STATE_LOCK_PATH,
  animStateFixturePath,
  animStateRigPath,
  animStateScenarioPath,
  readJson,
  readText,
  REPO_ROOT,
  sha256Hex,
  writeText,
} from './io';

// The AnimationState (anim-state) fixture generator CLI (ADR-0005 conformance family, conformance-and-ci.md
// A.6). It is the PARALLEL of generate.ts / generate-effects.ts: it loads each landed scenario + its rig,
// replays it through runtime-core's AnimationState (the pure build-anim-state-fixture.ts), writes the
// deterministic fixture JSON, and rewrites the .anim-state-fixtures.lock manifest. It is a pure function of
// (rig, scenario, runtime-core): no clock, no random, so re-running it on the same toolchain yields a
// byte-identical tree (the CI drift gate runs this then `git diff --exit-code`). It does NOT touch the
// skeleton, effects, or slot corpora.
//
// Run on the pinned toolchain: `nvm use $(cat .node-version) && pnpm --filter @marionette/conformance generate:anim-state`.
// Off-pin: set CONFORMANCE_ALLOW_UNPINNED=1. Fixtures are still stamped with the PINNED toolchain id; the
// tolerance-based anim-state test is Node-agnostic and passes, but the byte-exact lock is re-run on the
// pinned Node before it is authoritative (A.7), exactly as for the other tracks.

class ToolchainMismatchError extends Error {
  override readonly name = 'ToolchainMismatchError';
  constructor(pinned: string, actual: string) {
    super(
      `anim-state conformance fixtures must be generated on the pinned Node ${pinned}, but this ` +
        `process is ${actual}. Run \`nvm use ${pinned}\` and re-run, or set CONFORMANCE_ALLOW_UNPINNED=1 ` +
        `for an off-pin dev box (the byte-exact lock is then re-run on the pinned Node before it is ` +
        `authoritative).`,
    );
  }
}

function pinnedNodeVersion(): string {
  return readText(join(REPO_ROOT, '.node-version')).trim();
}

function assertPinnedToolchain(pinned: string): void {
  const actual = process.version.replace(/^v/, '');
  if (actual === pinned) return;
  if (process.env.CONFORMANCE_ALLOW_UNPINNED === '1') {
    process.stderr.write(
      `WARNING: generating anim-state conformance fixtures on Node ${process.version}, not the pinned ` +
        `${pinned}. Float results may differ by a few ULPs (within the A.5 tolerance, so the tests pass), ` +
        `but the byte-exact lock is NOT authoritative until regenerated on the pinned Node (A.7).\n`,
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
  throw new Error('could not read runtime-core package version for anim-state fixture provenance');
}

// Deterministic, pretty JSON (shortest round-trippable floats via JSON.stringify, so the re-parse is the
// exact same f64). Two-space indent, matching the effects/slot serializers; the anim-state-fixtures dir is
// prettier-ignored (the lock gate is a byte-exact diff), so this serializer owns their exact bytes.
function serializeFixture(fixture: AnimStateFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function serializeLock(lock: LockManifest): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function parseTargets(): readonly AnimStateId[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return LANDED_ANIM_STATE_IDS;
  const landed = new Set<string>(LANDED_ANIM_STATE_IDS);
  for (const arg of args) {
    if (!landed.has(arg)) {
      throw new Error(
        `"${arg}" is not a landed anim-state scenario id (landed: ${LANDED_ANIM_STATE_IDS.join(', ')})`,
      );
    }
  }
  return args as AnimStateId[];
}

function readExistingLockFiles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readText(ANIM_STATE_LOCK_PATH));
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
  const partial = targets.length !== LANDED_ANIM_STATE_IDS.length;
  const toolchain = `node-${pinned}-v8`;
  const core = coreVersion();
  const lockFiles: Record<string, string> = partial ? readExistingLockFiles() : {};
  // The shared rig hash is recorded once (a single rig backs every scenario).
  const rigTextByPath = new Map<string, string>();

  for (const scenarioId of targets) {
    const scenarioText = readText(animStateScenarioPath(scenarioId));
    const scenarioHash = `sha256:${sha256Hex(scenarioText)}`;
    const scenario = validateAnimStateScenario(JSON.parse(scenarioText));

    const rigPath = animStateRigPath(scenario.rigId);
    let rigText = rigTextByPath.get(rigPath);
    if (rigText === undefined) {
      rigText = readText(rigPath);
      rigTextByPath.set(rigPath, rigText);
    }
    const rigHash = `sha256:${sha256Hex(rigText)}`;
    const document = validateRig(JSON.parse(rigText));

    const fixture = buildAnimStateFixture(document, scenario, {
      scenarioId,
      rigId: scenario.rigId,
      scenarioHash,
      rigHash,
      coreVersion: core,
      toolchain,
      generatedBy: 'generate-anim-state.ts',
    });
    // Belt-and-suspenders: the producer validates its own output against the fixture schema (Law 3).
    validateAnimStateFixture(fixture);

    const fixtureText = serializeFixture(fixture);
    writeText(animStateFixturePath(scenarioId), fixtureText);

    lockFiles[`anim-state-rigs/${scenario.rigId}.json`] = sha256Hex(rigText);
    lockFiles[`anim-state-scenarios/${scenarioId}.scenario.json`] = sha256Hex(scenarioText);
    lockFiles[`anim-state-fixtures/${scenarioId}.fixture.json`] = sha256Hex(fixtureText);

    process.stdout.write(
      `generated anim-state-fixtures/${scenarioId}.fixture.json (${fixture.samples.length} samples)\n`,
    );
  }

  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(lockFiles).sort()) sortedFiles[key] = lockFiles[key]!;
  writeText(ANIM_STATE_LOCK_PATH, serializeLock({ toolchain, files: sortedFiles }));
  process.stdout.write('updated anim-state-fixtures/.anim-state-fixtures.lock\n');
}

main();
