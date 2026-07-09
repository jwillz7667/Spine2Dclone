import type { Color } from './color';

// Two-color (light + dark) tint, a.k.a. "tint black". Derived from FIRST PRINCIPLES (Law 4): this math is
// NOT copied from any Spine source. A slot may carry two tint colors: a LIGHT color that multiplies the
// texel (the classic single-color tint) and a DARK color that fills the texel's SHADOW term. Reading the
// texel's own value per channel as a light/dark ratio, the output STRAIGHT-alpha color per channel
// c in {r, g, b} is:
//
//     out_c = texel_c * light_c + (1 - texel_c) * dark_c
//
// and the alpha is unchanged by the dark term:
//
//     out_a = texel_a * light_a
//
// Intuition: where the texel is bright (texel_c -> 1) the light color dominates (out_c -> light_c); where
// the texel is dark (texel_c -> 0) the dark color shows through (out_c -> dark_c). With dark == 0 this
// collapses to the single-color path out_c = texel_c * light_c EXACTLY, so a slot with no dark color
// (pose.slotHasDarkColor == 0) is byte-identical to the pre-two-color renderer. The dark color's ALPHA is
// inert (ADR-0009 section 4.3, "the alpha channel is inert for two-color tinting; the runtime ignores
// it"), so this function never reads dark.a.
//
// Both `light` and `dark` are STRAIGHT-alpha here; premultiplication (if any) happens DOWNSTREAM at
// composite time (raster.ts premultiplies by srcAlpha). This is the single shared definition that the CPU
// rasterizer (render-preview, this file) and the GPU shader (runtime-web scene/two-color.ts) implement
// IDENTICALLY, so a two-color pixel the AI authoring loop previews here equals what the shipped renderer
// draws. The parity contract is the shared numeric vectors both packages' unit tests assert.
//
// `light` is the resolved LIGHT color (slot color x attachment color); `dark` is the resolved DARK color
// (pose.slotDarkColor, no attachment-side factor: attachments carry only one `color`). Only rgb of `dark`
// is read. The returned color's alpha equals the texel alpha (the caller folds the item alpha in as
// srcAlpha, exactly as the single-color path does).
export function combineTwoColor(texel: Color, light: Color, dark: Color): Color {
  return {
    r: texel.r * light.r + (1 - texel.r) * dark.r,
    g: texel.g * light.g + (1 - texel.g) * dark.g,
    b: texel.b * light.b + (1 - texel.b) * dark.b,
    a: texel.a,
  };
}
