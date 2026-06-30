import { describe, expect, it } from 'vitest';
import { decodeBinary, encodeBinary } from '@marionette/format';
import { LANDED_RIG_IDS } from '../src/registry';
import { validateRig } from '../src/schema/rig';
import { buildFixtureSamples } from '../src/build-fixture';
import {
  loadRig,
  loadSampleSpec,
  LOCK_PATH,
  readBytes,
  readJson,
  readText,
  rigBinPath,
  rigPath,
  sha256HexBytes,
} from '../src/io';

// WP-5.1 committed binary rig twins (phase-5 TASK-5.1.4 / TASK-5.1.6). For every landed rig there is a
// committed rigs/<rigId>.bin: the MRNT encoding of the JSON rig, the file the native runtimes load in
// conformance (WP-5.3/5.4), proving the shipping binary load path. This suite gates the twins on disk:
// each decodes back to the JSON rig (round-trip through the COMMITTED bytes), re-encodes byte-identically
// (determinism / the twin is current, regenerate-twice yields zero diff), solves identically through the
// binary loader (cross-loader parity: the binary path does not perturb the solve), and matches its
// .fixtures.lock hash (the drift tripwire covers the twin too).

interface LockManifest {
  readonly toolchain: string;
  readonly files: Record<string, string>;
}

function loadLockFiles(): Record<string, string> {
  const parsed = readJson(LOCK_PATH) as LockManifest;
  return parsed.files;
}

describe('binary rig twins (WP-5.1)', () => {
  it('every landed rig has a committed binary twin', () => {
    const lock = loadLockFiles();
    for (const rigId of LANDED_RIG_IDS) {
      expect(lock[`rigs/${rigId}.bin`], `lock entry for rigs/${rigId}.bin`).toBeTypeOf('string');
    }
  });

  it.each(LANDED_RIG_IDS)(
    '%s: the committed twin decodes back to the JSON rig (round-trip through committed bytes)',
    (rigId) => {
      const jsonRig = loadRig(rigId); // validated SkeletonDocument from rigs/<rigId>.json
      const twin = readBytes(rigBinPath(rigId)); // the committed .bin on disk
      // The binary path is validated by the SAME validator (Law 3, section 6.1.2): validateRig is
      // parseDocument under the hood, so a structurally-decodable but invalid twin would fail loudly.
      const decoded = validateRig(decodeBinary(twin));
      expect(decoded).toEqual(jsonRig);
    },
  );

  it.each(LANDED_RIG_IDS)(
    '%s: re-encoding the JSON rig reproduces the committed twin byte-for-byte (determinism)',
    (rigId) => {
      const jsonRig = loadRig(rigId);
      const committed = readBytes(rigBinPath(rigId));
      const reencoded = encodeBinary(jsonRig);
      expect(Buffer.from(reencoded).equals(Buffer.from(committed))).toBe(true);
    },
  );

  it.each(LANDED_RIG_IDS)(
    '%s: solves identically whether loaded from JSON or from the binary twin (cross-loader parity)',
    (rigId) => {
      const spec = loadSampleSpec(rigId);
      const fromJson = buildFixtureSamples(loadRig(rigId), spec);
      const fromBinary = buildFixtureSamples(validateRig(decodeBinary(readBytes(rigBinPath(rigId)))), spec);
      // The solve output is integer-exact-equal (same document, same code path); the binary loader is
      // proven not to perturb the solve.
      expect(fromBinary).toEqual(fromJson);
    },
  );

  it.each(LANDED_RIG_IDS)('%s: the committed twin matches its .fixtures.lock hash', (rigId) => {
    const lock = loadLockFiles();
    expect(sha256HexBytes(readBytes(rigBinPath(rigId)))).toBe(lock[`rigs/${rigId}.bin`]);
  });

  it('the JSON rig hash in the lock still matches (the twin entry did not disturb existing entries)', () => {
    const lock = loadLockFiles();
    for (const rigId of LANDED_RIG_IDS) {
      const sha = sha256HexBytes(new TextEncoder().encode(readText(rigPath(rigId))));
      expect(sha).toBe(lock[`rigs/${rigId}.json`]);
    }
  });
});
