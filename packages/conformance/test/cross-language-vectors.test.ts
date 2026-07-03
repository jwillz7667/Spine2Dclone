import { describe, expect, it } from 'vitest';
import { hash32, makePrng, nextU32, spinSeed } from '@marionette/runtime-core';
import { crc32 } from '@marionette/format';
import { LANDED_RIG_IDS } from '../src/registry';
import { readBytes, rigBinPath } from '../src/io';
import golden from '../src/cross-language/seed-prng-crc-vectors.json';

// WP-5.5 cross-language seed / PRNG / CRC equivalence (phase-5 TASK-5.5.7). This is the TS side of the
// cross-language anchor: it REGENERATES every integer in the committed golden from runtime-core / format
// (the oracle) and asserts the committed values still match, so the corpus can never silently drift from
// the implementation. The native runtimes (C#, GDScript) load the SAME committed JSON and assert their
// outputs equal it; that job is deferred (it needs the engines), but the corpus and its TS-correctness
// proof exist now, so the native runtimes have a fixed target the moment they are built.

describe('cross-language seed/PRNG/CRC vectors (WP-5.5, TASK-5.5.7)', () => {
  it('spinSeed matches the golden for every spinId (G5.8 derivation)', () => {
    for (const [spinId, expected] of Object.entries(golden.spinSeed)) {
      if (spinId.startsWith('_')) continue;
      expect(spinSeed(spinId)).toBe(expected);
    }
  });

  it('hash32 matches the golden for every committed pair', () => {
    for (const [pair, expected] of Object.entries(golden.hash32)) {
      if (pair.startsWith('_')) continue;
      const [a, b] = pair.split(',').map((n) => Number(n));
      expect(hash32(a!, b!)).toBe(expected);
    }
  });

  it('instanceSeed = hash32(triggerSeed, layerIndex), with triggerSeed = hash32(spinSeed(spinId), 0)', () => {
    for (const s of golden.instanceSeed.samples) {
      const triggerSeed = hash32(spinSeed(s.spinId), 0);
      expect(triggerSeed).toBe(s.triggerSeed);
      expect(hash32(triggerSeed, s.layerIndex)).toBe(s.instanceSeed);
    }
  });

  it('the mulberry32 nextU32 stream matches the golden for the seed derived from a spinId', () => {
    expect(hash32(spinSeed('spin-base-win'), 0)).toBe(golden.mulberry32.seed);
    const state = makePrng(golden.mulberry32.seed);
    const produced: number[] = [];
    for (let i = 0; i < golden.mulberry32.nextU32_first16.length; i += 1)
      produced.push(nextU32(state));
    expect(produced).toEqual(golden.mulberry32.nextU32_first16);
  });

  it('the CRC-32/ISO-HDLC check vector matches the golden (and the published 0xCBF43926)', () => {
    const value = crc32(new TextEncoder().encode('123456789'));
    expect(value).toBe(golden.crc32.check_123456789);
    expect(value).toBe(0xcbf43926);
  });

  it('crc32 over each committed twin body equals the golden AND the trailer the decoder must match', () => {
    for (const rigId of LANDED_RIG_IDS) {
      const bytes = readBytes(rigBinPath(rigId));
      const bodyCrc = crc32(bytes.subarray(0, bytes.length - 4));
      // matches the committed golden
      expect(bodyCrc, `golden crc for ${rigId}`).toBe(
        golden.crc32.twinBody[rigId as keyof typeof golden.crc32.twinBody],
      );
      // and equals the 4-byte little-endian trailer actually stored in the twin (decoder equivalence)
      const t = bytes.length - 4;
      const trailer =
        (bytes[t]! | (bytes[t + 1]! << 8) | (bytes[t + 2]! << 16) | (bytes[t + 3]! << 24)) >>> 0;
      expect(bodyCrc).toBe(trailer);
    }
  });
});
