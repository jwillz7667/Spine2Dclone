import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import type { SymbolId } from '@marionette/format/slot';
import { validateSpinResult } from '../src/validate';
import type { SpinResult } from '../src/types';

// WP-4.1 acceptance (phase-4 section 5.5): validateSpinResult gates engine output on receipt with
// shape + bounds checks and the STRUCTURAL forward-cascade and cumulative consistency checks, while
// keeping totalWin AUTHORITATIVE (no money recomputation). Every malformation is a typed error with a
// JSON path; nothing throws and nothing returns null.

const S = (s: string): SymbolId => symbolId(s);

// A non-cascade 5x3 (cols=5, rows=3) board filled with one symbol; the landing board IS the final board.
function uniformBoard(rows: number, cols: number, sym: string): SymbolId[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => S(sym)));
}

function baseWin(overrides: Partial<SpinResult> = {}): SpinResult {
  const grid = uniformBoard(3, 5, 'A');
  return {
    spinId: 'spin-1',
    bet: 100,
    initialGrid: grid,
    grid,
    wins: [
      {
        symbol: S('A'),
        positions: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        amount: 50,
      },
    ],
    totalWin: 50,
    features: [],
    ...overrides,
  };
}

const SIZE_5x3 = { rows: 3, cols: 5 };

describe('validateSpinResult (WP-4.1)', () => {
  it('a well-formed non-cascade result validates ok and deep-equals the parsed input', () => {
    const result = baseWin();
    const out = validateSpinResult(result, SIZE_5x3);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual(result);
  });

  it('an out-of-bounds WinLine cell yields a typed outOfBounds error with the path', () => {
    const result = baseWin({ wins: [{ symbol: S('A'), positions: [[0, 9]], amount: 10 }] });
    const out = validateSpinResult(result, SIZE_5x3);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('outOfBounds');
      expect(out.error.path).toBe('/wins/0/positions/0');
    }
  });

  it('a non-cascade result with initialGrid !== grid is rejected; equal validates', () => {
    const grid = uniformBoard(3, 5, 'A');
    const other = uniformBoard(3, 5, 'B');
    const bad = validateSpinResult(baseWin({ initialGrid: other, grid }), SIZE_5x3);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('nonCascadeBoardMismatch');
    expect(validateSpinResult(baseWin(), SIZE_5x3).ok).toBe(true);
  });

  it('the default build performs NO totalWin sum check (totalWin is authoritative)', () => {
    // wins sum to 50 but totalWin is 100 (a real engine differs from a naive sum via global multipliers).
    const result = baseWin({
      wins: [{ symbol: S('A'), positions: [[0, 0]], amount: 50 }],
      totalWin: 100,
    });
    expect(validateSpinResult(result, SIZE_5x3).ok).toBe(true);
  });

  it('an unknown FeatureEvent.type is accepted but a malformed data shape is rejected', () => {
    const okFeature = baseWin({
      features: [{ type: 'someBrandNewFeature', data: { count: 3 } }],
    });
    expect(validateSpinResult(okFeature, SIZE_5x3).ok).toBe(true);

    // A nested-object data value is not a scalar / number-array, so the closed data record rejects it.
    const badData = { ...baseWin(), features: [{ type: 'x', data: { nested: { a: 1 } } }] };
    const out = validateSpinResult(badData, SIZE_5x3);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('schema');
  });

  describe('cascade structural checks', () => {
    // A 2x2 cascade: remove [1,0], refill col 0 with [E] at the top. Survivors fall; the forward board is
    // [[E,B],[A,D]]. cumulativeWin ends on totalWin.
    function cascade(overrides: Partial<SpinResult> = {}): SpinResult {
      return {
        spinId: 'spin-casc',
        bet: 100,
        initialGrid: [
          [S('A'), S('B')],
          [S('C'), S('D')],
        ],
        grid: [
          [S('E'), S('B')],
          [S('A'), S('D')],
        ],
        wins: [{ symbol: S('C'), positions: [[1, 0]], amount: 100 }],
        totalWin: 100,
        features: [],
        cascades: [
          {
            removed: [[1, 0]],
            refill: [{ col: 0, symbols: [S('E')] }],
            stepWin: 100,
            cumulativeWin: 100,
          },
        ],
        ...overrides,
      };
    }
    const SIZE_2x2 = { rows: 2, cols: 2 };

    it('a consistent forward cascade validates ok', () => {
      expect(validateSpinResult(cascade(), SIZE_2x2).ok).toBe(true);
    });

    it('a forward application that does NOT reach grid is rejected with cascadeInconsistent + step index', () => {
      const out = validateSpinResult(
        cascade({
          grid: [
            [S('Z'), S('B')],
            [S('A'), S('D')],
          ],
        }),
        SIZE_2x2,
      );
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.code).toBe('cascadeInconsistent');
        expect(out.error.stepIndex).toBe(0);
      }
    });

    it('a refill that does not fill the emptied cells is rejected (cascadeInconsistent)', () => {
      const out = validateSpinResult(
        cascade({
          cascades: [
            {
              removed: [[1, 0]],
              refill: [{ col: 0, symbols: [] }],
              stepWin: 100,
              cumulativeWin: 100,
            },
          ],
        }),
        SIZE_2x2,
      );
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.code).toBe('cascadeInconsistent');
    });

    it('cascades whose last cumulativeWin !== totalWin are rejected (cumulativeInconsistent)', () => {
      const out = validateSpinResult(cascade({ totalWin: 999 }), SIZE_2x2);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.code).toBe('cumulativeInconsistent');
    });

    it('a decreasing cumulativeWin across steps is rejected (cumulativeInconsistent)', () => {
      // A forward-CONSISTENT two-step cascade (so the placement check passes) whose second cumulative is
      // lower than the first: step0 removes [1,0] -> [[E,B],[A,D]], step1 removes [0,0] -> [[F,B],[A,D]].
      const two = cascade({
        grid: [
          [S('F'), S('B')],
          [S('A'), S('D')],
        ],
        totalWin: 50,
        cascades: [
          {
            removed: [[1, 0]],
            refill: [{ col: 0, symbols: [S('E')] }],
            stepWin: 80,
            cumulativeWin: 80,
          },
          {
            removed: [[0, 0]],
            refill: [{ col: 0, symbols: [S('F')] }],
            stepWin: 0,
            cumulativeWin: 50,
          },
        ],
      });
      const out = validateSpinResult(two, SIZE_2x2);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.code).toBe('cumulativeInconsistent');
    });
  });

  it('a board with the wrong dimensions is rejected (dimensionMismatch)', () => {
    const out = validateSpinResult(baseWin({ grid: uniformBoard(2, 5, 'A') }), SIZE_5x3);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('dimensionMismatch');
  });

  it('a malformed shape (negative bet) is a typed schema error with a path', () => {
    const out = validateSpinResult({ ...baseWin(), bet: -1 }, SIZE_5x3);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.code).toBe('schema');
      expect(out.error.path).toContain('bet');
    }
  });
});
