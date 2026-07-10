import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BinaryDecodeError, crc32, decodeBinary, encodeBinary, parseDocument } from '../src/index';
import type { SkeletonDocument } from '../src/types';
import { FormatValidationError } from '../src/validate/errors';

// WP-5.1 binary codec (phase-5 section 6.1). Locks the load-bearing guarantees: deterministic encode
// (TASK-5.1.1), JSON to binary to JSON deep-equal losslessness (TASK-5.1.2), binary to decode to
// re-encode byte identity for canonical bytes (TASK-5.1.3), typed errors on every malformed-byte shape
// (TASK-5.1.5), and the pinned CRC-32/ISO-HDLC check vector (TASK-5.1.8). The committed binary rig twins
// and cross-loader solve parity (TASK-5.1.4/5.1.6) live in the conformance package (they need the rig
// corpus and runtime-web); here the codec is gated inside its owning package against the committed format
// fixtures (real, valid documents) plus a derived value-kind-coverage document.

const FIXTURE_DIR = join(__dirname, 'fixtures');

function loadFixture(name: string): SkeletonDocument {
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf-8')) as unknown;
  // verifyHash:false: we round-trip the structure, not the content hash (runtimes treat hash as opaque).
  return parseDocument(raw, { verifyHash: false });
}

// A valid document derived from the minimal fixture, mutated to exercise every value kind the codec
// special-cases: a NEGATIVE integer, a non-integer FLOAT, a NULL (Bone.parent on the root), nested
// objects/arrays, the animations MAP, repeated strings the table dedups, and a NON-ASCII map key.
function valueCoverageDoc(): SkeletonDocument {
  const doc = loadFixture('minimal.json');
  const clone = JSON.parse(JSON.stringify(doc)) as SkeletonDocument;
  clone.bones[0]!.x = -12; // negative integer
  clone.bones[0]!.y = 3.5; // non-integer float
  clone.animations['wave-é'] = {
    duration: 0.5,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    path: {},
    physics: {},
    deform: {},
    drawOrder: [],
    events: [],
  };
  return parseDocument(clone, { verifyHash: false });
}

const ROUND_TRIP_FIXTURES = ['minimal.json', 'phase1-complete.json'] as const;

describe('MRNT binary codec (WP-5.1)', () => {
  it('encodes the MRNT magic, containerVersion, and lossless flag in the header', () => {
    const bytes = encodeBinary(loadFixture('minimal.json'));
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x4d, 0x52, 0x4e, 0x54]); // "MRNT"
    expect(bytes[4]).toBe(1); // containerVersion
    expect(bytes[5]).toBe(1); // flags: bit0 lossless float64 set, reserved bits 0
  });

  it('encodes the same document to byte-identical output (TASK-5.1.1 determinism)', () => {
    const doc = loadFixture('phase1-complete.json');
    expect(encodeBinary(doc)).toEqual(encodeBinary(doc));
  });

  it('is independent of object key insertion order (sorted-key determinism)', () => {
    // Two independent parses of the same source, one with keys re-serialized in reverse, encode
    // identically because the codec sorts object keys. This is what makes committed twins reproducible
    // regardless of how the JSON was authored.
    const a = loadFixture('minimal.json');
    const reversed = JSON.parse(JSON.stringify(a)) as SkeletonDocument;
    // Reverse the bone field order via a fresh object to prove key order does not change the bytes.
    reversed.bones = reversed.bones.map((b) => {
      const entries = Object.entries(b).reverse();
      return Object.fromEntries(entries) as unknown as (typeof reversed.bones)[number];
    });
    expect(encodeBinary(parseDocument(reversed, { verifyHash: false }))).toEqual(encodeBinary(a));
  });

  it.each(ROUND_TRIP_FIXTURES)(
    'round-trips %s JSON to binary to JSON deep-equal (TASK-5.1.2 lossless)',
    (name) => {
      const doc = loadFixture(name);
      expect(decodeBinary(encodeBinary(doc))).toEqual(doc);
    },
  );

  it('preserves negative integers, floats, null, and non-ASCII keys exactly', () => {
    const doc = valueCoverageDoc();
    const decoded = decodeBinary(encodeBinary(doc));
    expect(decoded).toEqual(doc);
    expect(decoded.bones[0]!.x).toBe(-12);
    expect(decoded.bones[0]!.y).toBe(3.5);
    expect(decoded.bones[0]!.parent).toBeNull();
    expect(Object.keys(decoded.animations)).toContain('wave-é');
  });

  it.each(ROUND_TRIP_FIXTURES)(
    're-encodes decoded canonical bytes of %s byte-for-byte (TASK-5.1.3 decoder fidelity)',
    (name) => {
      const bytes = encodeBinary(loadFixture(name));
      expect(encodeBinary(decodeBinary(bytes))).toEqual(bytes);
    },
  );

  it('the binary path is validated by the SAME section-6 validator (Law 3, section 6.1.2)', () => {
    // A decoded document still passes through (and can be rejected by) validateDocument: the binary path
    // does not get a weaker validator. Encode a structurally-decodable but semantically-invalid document
    // (a slot referencing a missing bone) and assert parseDocument throws the SAME FormatValidationError.
    const broken = JSON.parse(JSON.stringify(loadFixture('minimal.json'))) as SkeletonDocument;
    broken.slots[0]!.bone = 'no-such-bone';
    const decoded = decodeBinary(encodeBinary(broken));
    expect(() => parseDocument(decoded, { verifyHash: false })).toThrow(FormatValidationError);
  });

  describe('malformed input fails with a typed BinaryDecodeError (TASK-5.1.5)', () => {
    it('bad magic', () => {
      const bytes = encodeBinary(loadFixture('minimal.json'));
      bytes[0] = 0x00;
      expect(() => decodeBinary(bytes)).toThrowError(expect.objectContaining({ code: 'badMagic' }));
    });

    it('corrupt body (crc mismatch)', () => {
      const bytes = encodeBinary(loadFixture('minimal.json'));
      bytes[12] ^= 0xff; // flip a byte inside the body
      try {
        decodeBinary(bytes);
        throw new Error('expected decode to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(BinaryDecodeError);
        expect((err as BinaryDecodeError).code).toBe('crcMismatch');
      }
    });

    it('truncated buffer', () => {
      const bytes = encodeBinary(loadFixture('minimal.json'));
      expect(() => decodeBinary(bytes.subarray(0, 6))).toThrowError(
        expect.objectContaining({ code: expect.stringMatching(/truncated|crcMismatch/) }),
      );
    });

    it('unsupported containerVersion', () => {
      const bytes = encodeBinary(loadFixture('minimal.json'));
      bytes[4] = 99; // tamper containerVersion, then fix the CRC so the version check is reached
      rewriteCrc(bytes);
      expect(() => decodeBinary(bytes)).toThrowError(
        expect.objectContaining({ code: 'unsupportedContainerVersion' }),
      );
    });

    it('bad flags (reserved bit set)', () => {
      const bytes = encodeBinary(loadFixture('minimal.json'));
      bytes[5] = 0x03; // bit1 reserved set
      rewriteCrc(bytes);
      expect(() => decodeBinary(bytes)).toThrowError(
        expect.objectContaining({ code: 'malformed' }),
      );
    });

    it('empty buffer', () => {
      expect(() => decodeBinary(new Uint8Array(0))).toThrowError(
        expect.objectContaining({ code: 'truncated' }),
      );
    });
  });

  it('pins the CRC-32/ISO-HDLC check vector (TASK-5.1.8)', () => {
    expect(crc32(new TextEncoder().encode('123456789')) >>> 0).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0)) >>> 0).toBe(0); // CRC of empty input
  });
});

// Recompute and rewrite the trailer CRC over the (possibly tampered) body, so a test can reach a check
// that runs AFTER the CRC gate (the CRC is verified first by design).
function rewriteCrc(bytes: Uint8Array): void {
  const crc = crc32(bytes.subarray(0, bytes.length - 4)) >>> 0;
  bytes[bytes.length - 4] = crc & 0xff;
  bytes[bytes.length - 3] = (crc >>> 8) & 0xff;
  bytes[bytes.length - 2] = (crc >>> 16) & 0xff;
  bytes[bytes.length - 1] = (crc >>> 24) & 0xff;
}
