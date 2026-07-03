import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/concurrency';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('mapWithConcurrency', () => {
  it('never exceeds the limit and preserves input order', async () => {
    const limit = 8;
    const total = 40;
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await mapWithConcurrency(
      Array.from({ length: total }, (_unused, i) => i),
      limit,
      async (item) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(3);
        inFlight -= 1;
        return item * 2;
      },
    );

    expect(maxInFlight).toBeLessThanOrEqual(limit);
    // The pool saturates: with more items than the limit, exactly `limit` run concurrently.
    expect(maxInFlight).toBe(limit);
    expect(results).toEqual(Array.from({ length: total }, (_unused, i) => i * 2));
  });

  it('processes fewer items than the limit without spinning up extra workers', async () => {
    let maxInFlight = 0;
    let inFlight = 0;

    await mapWithConcurrency([1, 2, 3], 8, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await delay(1);
      inFlight -= 1;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('returns an empty array for empty input', async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
  });

  it('rejects a non-positive limit', async () => {
    await expect(mapWithConcurrency([1], 0, async (n) => n)).rejects.toMatchObject({
      code: 'ATLAS_INVALID_CONFIG',
    });
  });
});
