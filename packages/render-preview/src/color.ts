// Straight-alpha RGBA color in [0, 1] per channel (the format's color range, schema/color.ts). This is
// the working color type for the CPU rasterizer: atlas texels are decoded into it, slot/attachment tint
// multiplies it, and the framebuffer composites it. It is intentionally a plain value type (no methods)
// so every math site is explicit and the fixed operation order stays visible (determinism contract).

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

// Fully transparent black: the default framebuffer background when a caller supplies none.
export const TRANSPARENT: Color = { r: 0, g: 0, b: 0, a: 0 };

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Quantize a [0, 1] channel to an 8-bit sample. Rounds half toward +Infinity (Math.round), pinned so
// the byte output is identical on every platform. The caller clamps to [0, 1] first (compositing may
// overshoot for additive), so this only quantizes.
export function to8Bit(channel: number): number {
  return Math.round(clamp01(channel) * 255);
}
