import { describe, expect, it } from 'vitest';
import { importSpineSkel } from '../src/index';
import type { SpineImportErrorCode } from '../src/types';
import { SkelWriter, encodeSkel, type SkelModel } from './fixtures/skel-encoder';

// Malformed-binary negatives (PP-A5 slice 2): a corrupt .skel must fail LOUDLY with a typed error, never
// crash, hang, or return a bad document. Buffers are hand-built with the test encoder / raw writer per the
// published spec, never from a real export (clean-room, LAW 4 / PP-A5).

// Build a .skel with a valid 4.x header and shared string table, then append arbitrary section bytes.
function buildSkel(opts: {
  version?: string;
  nonessential?: boolean;
  table?: string[];
  body?: (w: SkelWriter) => void;
}): Uint8Array {
  const w = new SkelWriter();
  w.string('hash');
  w.string(opts.version ?? '4.1.24');
  w.float(0);
  w.float(0);
  w.float(0);
  w.float(0);
  w.bool(opts.nonessential ?? false);
  if (opts.nonessential) {
    w.float(30);
    w.string('');
    w.string('');
  }
  const table = opts.table ?? [];
  w.varint(table.length, true);
  for (const s of table) w.string(s);
  opts.body?.(w);
  return w.toBytes();
}

// Write one complete root bone (index 0): name, 8 floats, transform byte, skin-required flag.
function writeRootBone(w: SkelWriter): void {
  w.string('root');
  for (let i = 0; i < 8; i += 1) w.float(0);
  w.byte(0);
  w.bool(false);
}

function firstError(bytes: Uint8Array): SpineImportErrorCode {
  const result = importSpineSkel(bytes);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.errors.length).toBeGreaterThan(0);
  return result.errors[0]!.code;
}

describe('importSpineSkel malformed-binary negatives', () => {
  it('rejects a truncated buffer with SPINE_BINARY_TRUNCATED', () => {
    const full = encodeSkel({ version: '4.1.24', bones: [{ name: 'root' }] });
    expect(firstError(full.subarray(0, full.length - 3))).toBe('SPINE_BINARY_TRUNCATED');
  });

  it('rejects an empty buffer without throwing', () => {
    expect(firstError(new Uint8Array(0))).toBe('SPINE_BINARY_TRUNCATED');
  });

  it('rejects an unsupported major version with SPINE_VERSION_UNSUPPORTED', () => {
    expect(firstError(buildSkel({ version: '3.8.99', body: (w) => w.varint(0, true) }))).toBe(
      'SPINE_VERSION_UNSUPPORTED',
    );
  });

  it('rejects a missing (null) version with SPINE_VERSION_MISSING', () => {
    const w = new SkelWriter();
    w.string('hash');
    w.string(null); // no version
    expect(firstError(w.toBytes())).toBe('SPINE_VERSION_MISSING');
  });

  it('rejects an out-of-range string-table reference with SPINE_BINARY_INVALID', () => {
    const bytes = buildSkel({
      table: [], // empty table
      body: (w) => {
        w.varint(1, true); // bones count
        writeRootBone(w);
        w.varint(1, true); // slots count
        w.string('slot');
        w.varint(0, true); // bone index 0 (valid)
        w.int32(0xffffffff | 0); // color
        w.int32(-1); // no dark
        w.varint(9, true); // attachment ref index 9 into an empty table
      },
    });
    expect(firstError(bytes)).toBe('SPINE_BINARY_INVALID');
  });

  it('rejects an out-of-range bone index with SPINE_BINARY_INVALID', () => {
    const bytes = buildSkel({
      body: (w) => {
        w.varint(1, true); // one bone (root)
        writeRootBone(w);
        w.varint(1, true); // slots count
        w.string('slot');
        w.varint(5, true); // bone index 5 does not exist
      },
    });
    expect(firstError(bytes)).toBe('SPINE_BINARY_INVALID');
  });

  it('rejects an unknown enum constant with SPINE_BINARY_INVALID', () => {
    const bytes = buildSkel({
      body: (w) => {
        w.varint(1, true); // one bone
        w.string('root');
        for (let i = 0; i < 8; i += 1) w.float(0);
        w.byte(99); // invalid transform mode constant
      },
    });
    expect(firstError(bytes)).toBe('SPINE_BINARY_INVALID');
  });

  it('rejects an absurd (overflowing) count with SPINE_BINARY_INVALID', () => {
    const bytes = buildSkel({ body: (w) => w.varint(-1, true) }); // bone count decodes to 0xFFFFFFFF
    expect(firstError(bytes)).toBe('SPINE_BINARY_INVALID');
  });

  it('rejects a non-binary input value with SPINE_BINARY_INVALID', () => {
    const result = importSpineSkel('not bytes' as unknown as Uint8Array);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('SPINE_BINARY_INVALID');
  });

  it('surfaces a decoded-but-format-invalid document as SPINE_DOCUMENT_INVALID', () => {
    // A single keyframe at time 0 yields a zero-duration animation, which the format rejects
    // (ANIM_DURATION). The binary decodes cleanly; the shared pipeline fails it loudly.
    const model: SkelModel = {
      version: '4.1.24',
      bones: [{ name: 'root' }, { name: 'bone1', parent: 'root' }],
      slots: [{ name: 'slot1', bone: 'bone1', attachment: 'region1' }],
      skins: [
        {
          name: 'default',
          slots: [{ slot: 'slot1', attachments: [{ placeholder: 'region1', type: 'region' }] }],
        },
      ],
      animations: [{ name: 'idle', bones: [{ bone: 'bone1', rotate: [{ time: 0, angle: 0 }] }] }],
    };
    const result = importSpineSkel(encodeSkel(model));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some(
        (e) => e.code === 'SPINE_DOCUMENT_INVALID' && e.detail?.['formatCode'] === 'ANIM_DURATION',
      ),
    ).toBe(true);
  });

  it('never throws and always returns a typed failure for random garbage (fuzz)', () => {
    let seed = 0x1234abcd;
    const rand = (): number => {
      // A tiny deterministic LCG so the fuzz corpus is reproducible.
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const length = rand() % 256;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) bytes[i] = rand() & 0xff;
      const result = importSpineSkel(bytes);
      // A random buffer is never a valid 4.x skeleton; the contract is a typed failure, never a throw.
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('never throws for any truncation of a valid buffer', () => {
    const full = encodeSkel({
      version: '4.1.24',
      bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
      slots: [{ name: 's', bone: 'root', attachment: 'r' }],
      skins: [
        {
          name: 'default',
          slots: [{ slot: 's', attachments: [{ placeholder: 'r', type: 'region' }] }],
        },
      ],
    });
    for (let cut = 0; cut < full.length; cut += 1) {
      const result = importSpineSkel(full.subarray(0, cut));
      expect(result.ok).toBe(false);
    }
    expect(importSpineSkel(full).ok).toBe(true);
  });
});
