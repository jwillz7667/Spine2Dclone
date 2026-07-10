import { AtlasError } from './errors';

// Premultiplied-alpha (PMA) page transform (phase-5 WP-5.2, TASK-5.2.5). A page emitted with PMA has each
// colour channel pre-multiplied by its own alpha, so a runtime composites additive/screen/normal blends
// with the SAME premultiplied equations across web, Unity, and Godot (the FIXED PMA policy the plan
// documents). This is a PURE pixel transform run at pack time on the fully composited page: it shells out
// to nothing and contains no clock or RNG, so a premultiplied page is as deterministic as the straight one.
//
// ROUNDING IS PINNED (do not "improve" it without a fixture regen): out_c = round(c * a / 255), where
// round is round-half-up (Math.round, ties toward +Infinity). Both renderers and the native runtimes must
// unpremultiply with the inverse of exactly this rule for the PMA-aware texture epsilon to hold; the
// premultiply/unpremultiply round-trip is therefore lossy at low alpha (unavoidable in 8-bit PMA) and the
// decode checks account for that with the PMA-aware epsilon, never exact equality.

// Premultiply one RGBA byte value against alpha with the pinned round-half-up rule.
function premultiplyChannel(channel: number, alpha: number): number {
  return Math.round((channel * alpha) / 255);
}

// Premultiply a row-major RGBA buffer in place is avoided: callers own their pixels, so this returns a
// fresh premultiplied buffer and never mutates the input (matching decodePng's copy-out contract). Alpha
// is unchanged; a fully opaque pixel (alpha 255) is returned byte-identical, and a fully transparent pixel
// collapses to (0,0,0,0).
export function premultiplyRgba(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new AtlasError(
      'ATLAS_DIMENSION_MISMATCH',
      `RGBA length ${rgba.length} does not match ${width}x${height} (expected ${expected})`,
    );
  }
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    out[i] = premultiplyChannel(rgba[i]!, a);
    out[i + 1] = premultiplyChannel(rgba[i + 1]!, a);
    out[i + 2] = premultiplyChannel(rgba[i + 2]!, a);
    out[i + 3] = a;
  }
  return out;
}
