import type { EffectBundle } from '@marionette/format/types';
import { hash32 } from './prng';
import type { EffectAnchor } from './anchor';

// Bundle expansion (phase-3-vfx-particles.md section 8.7, WP-3.4): an EffectBundle is a PRESENTATION-ONLY
// ordered list of effects, each with a relative startOffset, an anchorRole the caller resolves, and a
// seedSalt mixed into the per-item seed. It encodes NO win logic, NO grid, NO outcome (LAW 5). This is
// the pure expansion the EffectSystem.triggerBundle uses, factored out so the timing/seed math is
// testable without the system. PixiJS-free, math-bridge-free.

// One expanded bundle item: the effect to trigger, the absolute scene-clock start time
// (bundleStart + item.startOffset), the resolved anchor, and the per-item seed hash32(baseSeed, salt).
export interface ExpandedBundleItem {
  readonly effect: string;
  readonly startTime: number;
  readonly anchor: EffectAnchor;
  readonly seed: number;
}

// A default world-origin anchor used when an item's anchorRole is absent from the supplied map. The
// caller should provide all roles; this keeps a partial map from crashing a presentation pass.
const DEFAULT_ANCHOR: EffectAnchor = { space: 'world', x: 0, y: 0, rotation: 0 };

// Expand a bundle into its ordered trigger items (section 8.7). For each item: startTime =
// bundleStartTime + item.startOffset; anchor = anchors[item.anchorRole] (or the world origin); seed =
// hash32(baseSeed, item.seedSalt). Allocates the result array once (a trigger-time call, not the
// per-frame hot path), so allocation here is acceptable.
export function expandBundle(
  bundle: EffectBundle,
  baseSeed: number,
  anchors: Readonly<Record<string, EffectAnchor>>,
  bundleStartTime: number,
): ExpandedBundleItem[] {
  const out: ExpandedBundleItem[] = [];
  for (const item of bundle.items) {
    out.push({
      effect: item.effect,
      startTime: bundleStartTime + item.startOffset,
      anchor: anchors[item.anchorRole] ?? DEFAULT_ANCHOR,
      seed: hash32(baseSeed, item.seedSalt) >>> 0,
    });
  }
  return out;
}
