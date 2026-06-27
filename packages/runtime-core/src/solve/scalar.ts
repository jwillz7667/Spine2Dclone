// Scalar helpers shared by the constraint solvers (ADR-0003). Module-internal: they are an
// implementation detail of the IK/transform/channel primitives and are NOT part of the runtime-core
// barrel. NO PixiJS, NO DOM, deterministic (no clock/RNG): this is platform-agnostic solve math.

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

// Wrap a degree delta into (-180, 180] so an angular blend always takes the short way around. IK
// blends a bone's current local rotation toward the solved one; without wrapping, a difference near
// +/-180 degrees would spin the bone the long way and an interpolated mix would swing wildly.
export function wrapDegrees(deg: number): number {
  let wrapped = deg % 360;
  if (wrapped > 180) {
    wrapped -= 360;
  } else if (wrapped <= -180) {
    wrapped += 360;
  }
  return wrapped;
}
