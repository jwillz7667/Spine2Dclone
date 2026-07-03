import { AtlasError } from './errors';

// Bounded-concurrency map. A fixed-size worker pool pulls from a shared cursor, so at most `limit`
// invocations of `worker` are ever in flight regardless of how the promises settle (the cap is a
// structural invariant, not a timing accident). Results preserve input order. This is the single
// fan-out primitive the service uses; no code path here ever does an unbounded Promise.all.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new AtlasError(
      'ATLAS_INVALID_CONFIG',
      `concurrency limit must be a positive integer, received ${limit}`,
    );
  }

  const results = new Array<R>(items.length);
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (cursor < items.length) {
      // Read-then-advance is atomic in single-threaded JS (no await between the two statements), so
      // two workers never claim the same index.
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue; // unreachable for dense inputs; satisfies noUncheckedIndexedAccess
      results[index] = await worker(item, index);
    }
  };

  const poolSize = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => runWorker()));
  return results;
}
