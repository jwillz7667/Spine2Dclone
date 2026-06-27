import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getRotationDeg, getTranslation } from '../src';
import { serializeGolden, solveGolden } from './golden-fixture';
import { worldOf } from './rig';

// WP-0.4 golden drift guard: the committed Phase-0 world-transform fixture must re-derive byte-for-byte
// from the current code. A compose-order or multiply-order change shifts the serialized affines, so
// this test fails (the deliberate, reviewed regeneration is `pnpm gen:golden`). The committed file is
// the frozen seed Phase 1 builds its conformance harness on.
const committed = readFileSync(
  new URL('./golden/phase0-world-transform.json', import.meta.url),
  'utf8',
);

describe('phase-0 world-transform golden', () => {
  it('re-derives byte-for-byte from runtime-core', () => {
    expect(serializeGolden(solveGolden())).toBe(committed);
  });

  it('encodes the expected child placement (not a vacuous self-compare)', () => {
    const child = worldOf(solveGolden(), 'child');
    const [tx, ty] = getTranslation(child);
    expect(tx).toBeCloseTo(0, 9);
    expect(ty).toBeCloseTo(100, 9);
    expect(getRotationDeg(child)).toBeCloseTo(90, 9);
  });
});
