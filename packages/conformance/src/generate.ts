import process from 'node:process';
import { join } from 'node:path';
import { encodeBinary } from '@marionette/format';
import { buildFixture } from './build-fixture';
import { validateRig } from './schema/rig';
import { validateSampleSpec } from './schema/sample-spec';
import { validateFixture } from './schema/fixture';
import type { Affine, FiredEventRecord, Fixture, FixtureSample } from './schema/fixture';
import { LANDED_RIG_IDS, type RigId } from './registry';
import {
  fixturePath,
  LOCK_PATH,
  readJson,
  readText,
  REPO_ROOT,
  rigBinPath,
  rigPath,
  sha256Hex,
  sha256HexBytes,
  specPath,
  writeBytes,
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

// Enforce the pinned toolchain, UNLESS CONFORMANCE_ALLOW_UNPINNED is set (an explicit, loud opt-in for
// regenerating on a non-pinned dev box where the true pinned Node is unavailable). When overridden, the
// fixtures are still stamped with the PINNED toolchain id (the canonical target): the tolerance-based
// conformance tests are Node-agnostic and pass, but the BYTE-EXACT lock gate must be re-run on the real
// pinned Node before it is authoritative. The override never silently hides a mismatch (it warns).
function assertPinnedToolchain(pinned: string): void {
  const actual = process.version.replace(/^v/, '');
  if (actual === pinned) return;
  if (process.env.CONFORMANCE_ALLOW_UNPINNED === '1') {
    process.stderr.write(
      `WARNING: generating conformance fixtures on Node ${process.version}, not the pinned ${pinned}. ` +
        `Float results may differ by a few ULPs (within the A.5 tolerance, so the tests pass), but the ` +
        `byte-exact lock is NOT authoritative until regenerated on the pinned Node (A.7).\n`,
    );
    return;
  }
  throw new ToolchainMismatchError(pinned, process.version);
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

// One mesh-vertices entry on a single line: the triple plus a compact positions array, so a diff reads
// one mesh per line (matching the one-bone-per-line affine convention).
function serializeMesh(mesh: NonNullable<FixtureSample['meshes']>[number], indent: string): string {
  const positions = `[${mesh.positions.map(num).join(', ')}]`;
  return `${indent}{ "skin": ${str(mesh.skin)}, "slot": ${str(mesh.slot)}, "attachment": ${str(mesh.attachment)}, "positions": ${positions} }`;
}

// One slot-state entry on a single line: the slot name, its blend mode, and a compact color array, so
// a diff reads one slot per line (matching the one-mesh-per-line convention).
function serializeSlot(slot: NonNullable<FixtureSample['slots']>[number], indent: string): string {
  const color = `[${slot.color.map(num).join(', ')}]`;
  const dark = slot.dark !== undefined ? `, "dark": [${slot.dark.map(num).join(', ')}]` : '';
  return `${indent}{ "slot": ${str(slot.slot)}, "blendMode": ${str(slot.blendMode)}, "color": ${color}${dark} }`;
}

function serializeSample(sample: FixtureSample, indent: string): string {
  const i2 = `${indent}  `;
  const i3 = `${i2}  `;
  const boneLines = Object.entries(sample.bones).map(
    ([name, affine]) => `${i3}${str(name)}: ${serializeAffine(affine)}`,
  );
  // Each JSON member is one self-contained block (no trailing comma); the commas that separate members
  // come from the `,\n` join, so appending an optional member (meshes, slots) never disturbs the bytes
  // of a fixture that lacks it. `bones` is always present; `meshes` then `slots` follow when captured.
  const members = [`${i2}"bones": {\n${boneLines.join(',\n')}\n${i2}}`];
  if (sample.meshes !== undefined && sample.meshes.length > 0) {
    const meshLines = sample.meshes.map((mesh) => serializeMesh(mesh, i3));
    members.push(`${i2}"meshes": [\n${meshLines.join(',\n')}\n${i2}]`);
  }
  if (sample.slots !== undefined && sample.slots.length > 0) {
    const slotLines = sample.slots.map((slot) => serializeSlot(slot, i3));
    members.push(`${i2}"slots": [\n${slotLines.join(',\n')}\n${i2}]`);
  }
  // The resolved render order as a compact single-line integer array (PP-B4). Present only when captured;
  // omitting it otherwise keeps every pre-PP-B4 fixture byte-identical.
  if (sample.drawOrder !== undefined) {
    members.push(`${i2}"drawOrder": [${sample.drawOrder.map(num).join(', ')}]`);
  }
  // The resolved sequence frame per slot, one entry per line (matching the one-per-line convention). Present
  // only when captured (rig-sequences); omitting it keeps every non-sequence fixture byte-identical.
  if (sample.sequences !== undefined && sample.sequences.length > 0) {
    const seqLines = sample.sequences.map(
      (s) => `${i3}{ "slot": ${str(s.slot)}, "frame": ${num(s.frame)} }`,
    );
    members.push(`${i2}"sequences": [\n${seqLines.join(',\n')}\n${i2}]`);
  }
  return [
    `${indent}{`,
    `${i2}"time": ${num(sample.time)},`,
    `${i2}"animation": ${str(sample.animation)},`,
    `${i2}"loop": ${sample.loop ? 'true' : 'false'},`,
    members.join(',\n'),
    `${indent}}`,
  ].join('\n');
}

// One fired-event record on a single line (PP-B4): name, fire time, and each present payload member in a
// fixed order, so a diff reads one event per line (matching the one-per-line convention of the other lanes).
function serializeFiredEvent(event: FiredEventRecord, indent: string): string {
  const parts = [`"name": ${str(event.name)}`, `"time": ${num(event.time)}`];
  if (event.int !== undefined) parts.push(`"int": ${num(event.int)}`);
  if (event.float !== undefined) parts.push(`"float": ${num(event.float)}`);
  if (event.string !== undefined) parts.push(`"string": ${str(event.string)}`);
  return `${indent}{ ${parts.join(', ')} }`;
}

function serializeFixture(fixture: Fixture): string {
  const i1 = '  ';
  const samples = fixture.samples.map((sample) => serializeSample(sample, `${i1}  `)).join(',\n');
  const lines = [
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
  ];
  // The fired-event log is emitted as a trailing member only when present (rigs with an eventStep), so a
  // fixture without events keeps its exact prior bytes (the closing `]` of samples gains no trailing comma).
  if (fixture.events !== undefined) {
    lines[lines.length - 1] = `${i1}],`;
    const eventLines = fixture.events.map((event) => serializeFiredEvent(event, `${i1}  `));
    lines.push(`${i1}"events": [`, eventLines.join(',\n'), `${i1}]`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function serializeLock(lock: LockManifest): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

// Parse optional rig-id arguments. With no args the generator rewrites EVERY landed rig (full lock
// rewrite, the canonical determinism run). With args it regenerates ONLY those rigs and MERGES their
// entries into the existing lock, leaving other rigs' fixtures and lock entries untouched, so a targeted
// regeneration (e.g. of newly-landed rigs) never disturbs an already-committed fixture. Each arg must be a
// landed rig id.
function parseTargetRigs(): readonly RigId[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return LANDED_RIG_IDS;
  const landed = new Set<string>(LANDED_RIG_IDS);
  for (const arg of args) {
    if (!landed.has(arg)) {
      throw new Error(`"${arg}" is not a landed rig id (landed: ${LANDED_RIG_IDS.join(', ')})`);
    }
  }
  return args as RigId[];
}

// Read the existing lock's file map (for a targeted, merge-preserving regeneration). Empty when absent.
function readExistingLockFiles(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readText(LOCK_PATH));
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
  // Fail loud, before any fixture is written (A.7), unless explicitly overridden for an off-pin dev box.
  assertPinnedToolchain(pinned);

  const targets = parseTargetRigs();
  const partial = targets.length !== LANDED_RIG_IDS.length;
  const toolchain = `node-${pinned}-v8`;
  const core = coreVersion();
  // A partial run preserves the other rigs' lock entries; a full run starts from an empty manifest.
  const lockFiles: Record<string, string> = partial ? readExistingLockFiles() : {};

  for (const rigId of targets) {
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

    // The committed binary rig twin (phase-5 WP-5.1, TASK-5.1.6): the MRNT encoding of THIS validated
    // rig, the file the native runtimes load in conformance. encodeBinary is pure and deterministic, so
    // regenerating yields zero diff; the twin bytes are toolchain-independent (a byte re-encoding of the
    // rig's authored numbers), unlike the V8-sensitive solve fixtures above.
    const twin = encodeBinary(document);
    writeBytes(rigBinPath(rigId), twin);

    lockFiles[`rigs/${rigId}.json`] = sha256Hex(rigText);
    lockFiles[`rigs/${rigId}.bin`] = sha256HexBytes(twin);
    lockFiles[`sample-spec/${rigId}.sample-spec.json`] = sha256Hex(specText);
    lockFiles[`fixtures/${rigId}.fixture.json`] = sha256Hex(fixtureText);

    process.stdout.write(
      `generated fixtures/${rigId}.fixture.json (${fixture.samples.length} samples) + rigs/${rigId}.bin (${twin.length} bytes)\n`,
    );
  }

  // Sort the manifest keys so the lock is order-stable regardless of iteration order (A.6).
  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(lockFiles).sort()) sortedFiles[key] = lockFiles[key]!;
  writeText(LOCK_PATH, serializeLock({ toolchain, files: sortedFiles }));
  process.stdout.write('updated fixtures/.fixtures.lock\n');
}

main();
