// Transport time mapping (phase-1-bone-puppet.md TASK-1.4.7). runtime-core's sampleSkeleton is a pure
// SINGLE-PERIOD function on [0, duration] that clamps and does NOT wrap; looping is the transport's
// job. loopTime folds an elapsed playback time into one period [0, duration) so the caller can sample a
// looping animation. It is negative-safe (the double modulo handles a scrub before zero), allocation-
// free, and free of any wall clock, so it is deterministic and reusable by the editor transport and a
// standalone player alike.
//
// duration <= 0 carries no period to wrap into, so the only defined sample time is 0 (this also avoids
// the modulo-by-zero NaN). A SEAMLESS loop additionally requires matched endpoints in the authored
// animation (first keyframe value == last per channel); loopTime guarantees only the time folding,
// not pop-freeness (TASK-1.4.7).
export function loopTime(elapsed: number, duration: number): number {
  if (duration <= 0) return 0;
  return ((elapsed % duration) + duration) % duration;
}
