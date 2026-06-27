import {
  buildPose,
  MAT2X3_STRIDE,
  sampleSkeleton,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import type { SkeletonDocument } from '@marionette/format/types';

// Headless playback sampling (phase-1-bone-puppet.md TASK-1.10.4). This drives the SAME runtime-core
// symbol the on-screen player drives: SkeletonView.syncAnimated samples sampleSkeleton into a pose and
// reads bone world matrices out of pose.world; this harness samples sampleSkeleton into a pose and
// reads the SAME pose.world the SAME way, with NO PixiJS and NO GL/render context, so it runs in plain
// Node/Vitest. It is the primitive WP-1.13 builds editor-vs-runtime parity on.
//
// What this proves and does NOT prove: because it calls the identical solve symbol, agreement here is
// determinism (same document + same time => identical transforms) and non-perturbation across the
// headless/GL boundary (the player and this harness cannot diverge while sharing sampleSkeleton). It is
// NOT a cross-implementation correctness check; the runtime-core-vs-Unity/Godot question is the
// conformance suite's job in a later phase, against committed fixtures.
//
// The document MUST already be validated (the caller validates on load), exactly as syncAnimated trusts
// a typed SkeletonDocument: per-sample re-validation is not a sane cost and the solve relies on the
// parent-precedes-child ordering the validator guarantees.

// One sampled frame: the bone world transforms at `time`, in document bone order.
export interface SampledFrame {
  readonly time: number;
  // One world affine [a, b, c, d, tx, ty] per bone, document bone order, read straight out of
  // pose.world exactly as SkeletonView.renderFromPose reads it (boneIndex * MAT2X3_STRIDE).
  readonly worlds: readonly Mat2x3[];
  // The bone's far endpoint, local (length, 0), mapped to world space, per bone, document order. A
  // cheap derived positional probe for WP-1.13 parity: it is a pure function of `worlds` and the bone
  // length (the same length the player draws the bone to), so it adds convenience, not information.
  readonly tips: readonly (readonly [number, number])[];
}

// Sample `animationName` at each time in `times` and return the bone world transforms per frame. The
// pose is built ONCE for the document and reused across every time (no per-frame pose allocation); each
// frame's `worlds`/`tips` are freshly read out, which is the harness's actual output, not solve scratch.
// `times` are single-period times in [0, duration]; sampleSkeleton clamps outside it and does NOT wrap
// (map elapsed time through loopTime first for a looping sample). Throws AnimationNotFoundError, exactly
// as sampleSkeleton does, for an unknown animation name.
export function samplePlaybackWorlds(
  document: SkeletonDocument,
  animationName: string,
  times: readonly number[],
): SampledFrame[] {
  const pose = buildPose(document);
  const boneCount = document.bones.length;
  const world = pose.world;

  const frames: SampledFrame[] = [];
  for (const time of times) {
    sampleSkeleton(document, animationName, time, pose);

    const worlds: Mat2x3[] = [];
    const tips: (readonly [number, number])[] = [];
    for (let i = 0; i < boneCount; i += 1) {
      const base = i * MAT2X3_STRIDE;
      const affine: Mat2x3 = [
        world[base]!,
        world[base + 1]!,
        world[base + 2]!,
        world[base + 3]!,
        world[base + 4]!,
        world[base + 5]!,
      ];
      worlds.push(affine);
      tips.push(transformPoint(affine, document.bones[i]!.length, 0));
    }
    frames.push({ time, worlds, tips });
  }
  return frames;
}
