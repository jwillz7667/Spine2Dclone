// Pure onion-skin ghost derivation (PP-D3): the set of sample times and opacities for the ghost frames drawn
// before and after the playhead. No PixiJS, no DOM: this is the unit-tested logic the viewport overlay renders
// over. The overlay pools display objects and samples each ghost pose through the shared runtime-web view, so
// this module owns only the WHICH-frames-and-how-faint decision, never any allocation-per-frame rendering.

export interface OnionSkinSettings {
  readonly enabled: boolean;
  readonly before: number; // ghost count before the playhead (>= 0)
  readonly after: number; // ghost count after the playhead (>= 0)
  readonly frameStep: number; // spacing in FRAMES between adjacent ghosts (>= 1)
  readonly opacity: number; // opacity of the NEAREST ghost, in (0, 1]
  readonly falloff: number; // per-step opacity multiplier, in (0, 1]
}

export interface OnionGhost {
  readonly time: number; // sample time in seconds, within [0, duration]
  readonly side: 'before' | 'after';
  readonly step: number; // 1 for the nearest ghost, increasing away from the playhead
  readonly opacity: number; // in (0, 1]
}

// A hard cap on ghosts per side so a mis-set count never fans out unboundedly (backpressure: the overlay
// pools one display tree per ghost, and the solve runs per ghost per frame).
export const MAX_GHOSTS_PER_SIDE = 16;

// Below this the ghost would be invisible, so it is dropped rather than solved and drawn for nothing.
const MIN_VISIBLE_OPACITY = 0.02;

// Fold an elapsed time into one period [0, duration). Mirrors runtime-web's loopTime (kept inline so this pure
// module needs no PixiJS-bearing import); negative-safe via the double modulo. duration <= 0 has no period.
function wrap(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return ((time % duration) + duration) % duration;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_GHOSTS_PER_SIDE, Math.floor(n));
}

// Derive the ordered ghost list for the current playhead. When `loop` is set the sample times wrap into
// [0, duration) so ghosts near a loop boundary show the wrapped frames; otherwise a ghost whose time falls
// outside [0, duration] is dropped (no clamping, which would stack ghosts on the endpoints). Opacity is
// nearest-first: opacity * falloff^(step-1), and ghosts fainter than a small threshold are dropped. The list
// is ordered farthest-first within each side (so a painter's-order renderer draws the nearest ghost last, on
// top), before-side then after-side. Returns [] when disabled, when there is no period, or when both counts
// are zero.
export function deriveOnionGhosts(
  settings: OnionSkinSettings,
  playhead: number,
  fps: number,
  duration: number,
  loop: boolean,
): OnionGhost[] {
  if (!settings.enabled || duration <= 0 || fps <= 0) return [];

  const before = clampCount(settings.before);
  const after = clampCount(settings.after);
  const stepSeconds = Math.max(1, Math.floor(settings.frameStep)) / fps || 0;
  if (stepSeconds <= 0 || (before === 0 && after === 0)) return [];

  const ghosts: OnionGhost[] = [];
  collectSide(ghosts, 'before', before, -1, playhead, stepSeconds, duration, loop, settings);
  collectSide(ghosts, 'after', after, 1, playhead, stepSeconds, duration, loop, settings);
  return ghosts;
}

function collectSide(
  out: OnionGhost[],
  side: 'before' | 'after',
  count: number,
  direction: -1 | 1,
  playhead: number,
  stepSeconds: number,
  duration: number,
  loop: boolean,
  settings: OnionSkinSettings,
): void {
  // Farthest-first so the nearest ghost is appended (and drawn) last.
  for (let step = count; step >= 1; step -= 1) {
    const opacity = settings.opacity * Math.pow(settings.falloff, step - 1);
    if (opacity < MIN_VISIBLE_OPACITY) continue;
    const raw = playhead + direction * step * stepSeconds;
    if (loop) {
      out.push({ time: wrap(raw, duration), side, step, opacity });
    } else if (raw >= 0 && raw <= duration) {
      out.push({ time: raw, side, step, opacity });
    }
  }
}
