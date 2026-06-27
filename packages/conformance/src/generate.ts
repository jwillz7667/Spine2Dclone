import process from 'node:process';
import { join } from 'node:path';
import { buildFixture } from './build-fixture';
import { validateRig } from './schema/rig';
import { validateSampleSpec } from './schema/sample-spec';
import { validateFixture } from './schema/fixture';
import type { Fixture, FixtureSample, Affine } from './schema/fixture';
import { LANDED_RIG_IDS } from './registry';
import {
  fixturePath,
  LOCK_PATH,
  readJson,
  readText,
  REPO_ROOT,
  rigPath,
  sha256Hex,
  specPath,
  writeText,
} from './io';

// The skeletal fixture generator CLI (conformance-and-ci.md A.6, WP-V.2). It loads each landed rig +
// sample-spec, runs the canonical solve via runtime-core (the pure build-fixture.ts), writes the
// deterministic fixture JSON, and rewrites the .fixtures.lock manifest. It is the only producer of
// skeletal fixtures, and it is a pure function of (rig, sample-spec, runtime-core): no clock, no
// random, so re-running it on the same toolchain yields a byte-identical tree (the CI drift gate runs
// this then `git diff --exit-code`).
//
// Run on the pinned toolchain only: `nvm use $(cat .node-version) && pnpm --filter @marionette/conformance generate`.

// Thrown before anything is written when the running Node is not the pinned generation toolchain
// (A.7, WP-V.17). The fixtures store V8-computed cos/sin/long-sum f64 results as shortest
// round-trippable JSON, and the lock gate is an EXACT git diff, so a Node/V8 change can flip the last
// ULP and fail the gate on a PR with zero intended behavior change. Pinning the toolchain is the fix.
class ToolchainMismatchError extends Error {
  override readonly name = 'ToolchainMismatchError';
  constructor(pinned: string, actual: string) {
    super(
      `conformance fixtures must be generated on the pinned Node ${pinned}, but this process is ${actual}. ` +
        `Run \`nvm use ${pinned}\` (or volta) and re-run. The pin is in .node-version (A.7); a bump is a ` +
        `behavior-change PR that regenerates fixtures under the A.6 review gate.`,
    );
  }
}

// The pinned Node version, read from the repo-root .node-version (A.7). The same id is recorded in the
// lock and every fixture `toolchain` field as node-<version>-v8.
function pinnedNodeVersion(): string {
  return readText(join(REPO_ROOT, '.node-version')).trim();
}

function assertPinnedToolchain(pinned: string): void {
  const actual = process.version.replace(/^v/, '');
  if (actual !== pinned) throw new ToolchainMismatchError(pinned, process.version);
}

// runtime-core's package version, for the fixture coreVersion provenance (A.3, not compared). Read
// without an unknown member access on `any`: narrow the parsed JSON before reading `version`.
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
  throw new Error('could not read runtime-core package version for fixture provenance');
}

// Deterministic JSON serialization (A.3). Floats use JavaScript shortest round-trippable form
// (JSON.stringify of a number), so the JSON re-parses to the exact same f64. Affines are emitted as
// compact single-line arrays so a diff reads one bone per line; the rest is two-space indented.
function num(value: number): string {
  return JSON.stringify(value);
}

function str(value: string): string {
  return JSON.stringify(value);
}

function serializeAffine(affine: Affine): string {
  return `[${affine.map(num).join(', ')}]`;
}

function serializeSample(sample: FixtureSample, indent: string): string {
  const i2 = `${indent}  `;
  const i3 = `${i2}  `;
  const boneLines = Object.entries(sample.bones).map(
    ([name, affine]) => `${i3}${str(name)}: ${serializeAffine(affine)}`,
  );
  return [
    `${indent}{`,
    `${i2}"time": ${num(sample.time)},`,
    `${i2}"animation": ${str(sample.animation)},`,
    `${i2}"loop": ${sample.loop ? 'true' : 'false'},`,
    `${i2}"bones": {`,
    boneLines.join(',\n'),
    `${i2}}`,
    `${indent}}`,
  ].join('\n');
}

function serializeFixture(fixture: Fixture): string {
  const i1 = '  ';
  const samples = fixture.samples.map((sample) => serializeSample(sample, `${i1}  `)).join(',\n');
  return [
    '{',
    `${i1}"rigId": ${str(fixture.rigId)},`,
    `${i1}"rigHash": ${str(fixture.rigHash)},`,
    `${i1}"specHash": ${str(fixture.specHash)},`,
    `${i1}"coreVersion": ${str(fixture.coreVersion)},`,
    `${i1}"toolchain": ${str(fixture.toolchain)},`,
    `${i1}"generatedBy": ${str(fixture.generatedBy)},`,
    `${i1}"samples": [`,
    samples,
    `${i1}]`,
    '}',
    '',
  ].join('\n');
}

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function serializeLock(lock: LockManifest): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function main(): void {
  const pinned = pinnedNodeVersion();
  // Fail loud, before any fixture is written (A.7).
  assertPinnedToolchain(pinned);

  const toolchain = `node-${pinned}-v8`;
  const core = coreVersion();
  const lockFiles: Record<string, string> = {};

  for (const rigId of LANDED_RIG_IDS) {
    const rigText = readText(rigPath(rigId));
    const rigHash = `sha256:${sha256Hex(rigText)}`;
    const document = validateRig(JSON.parse(rigText));

    const specText = readText(specPath(rigId));
    const specHash = `sha256:${sha256Hex(specText)}`;
    const spec = validateSampleSpec(JSON.parse(specText));
    if (spec.rigId !== rigId) {
      throw new Error(`sample-spec rigId "${spec.rigId}" does not match rig "${rigId}"`);
    }

    const fixture = buildFixture(document, spec, {
      rigId,
      rigHash,
      specHash,
      coreVersion: core,
      toolchain,
      generatedBy: 'generate.ts',
    });
    // Belt-and-suspenders: the producer validates its own output against the fixture schema (Law 3).
    validateFixture(fixture);

    const fixtureText = serializeFixture(fixture);
    writeText(fixturePath(rigId), fixtureText);

    lockFiles[`rigs/${rigId}.json`] = sha256Hex(rigText);
    lockFiles[`sample-spec/${rigId}.sample-spec.json`] = sha256Hex(specText);
    lockFiles[`fixtures/${rigId}.fixture.json`] = sha256Hex(fixtureText);

    process.stdout.write(
      `generated fixtures/${rigId}.fixture.json (${fixture.samples.length} samples)\n`,
    );
  }

  // Sort the manifest keys so the lock is order-stable regardless of iteration order (A.6).
  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(lockFiles).sort()) sortedFiles[key] = lockFiles[key]!;
  writeText(LOCK_PATH, serializeLock({ toolchain, files: sortedFiles }));
  process.stdout.write('updated fixtures/.fixtures.lock\n');
}

main();
