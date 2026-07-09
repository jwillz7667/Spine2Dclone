// Two-color (light + dark) tint, a.k.a. "tint black". Derived from FIRST PRINCIPLES (Law 4): this math is
// NOT copied from any Spine source. It is the EXACT twin of packages/render-preview/src/two-color.ts; the
// two definitions are kept character-for-character identical so the CPU preview rasterizer and this GPU
// renderer shade a two-color slot the same way. A slot may carry two tint colors: a LIGHT color that
// multiplies the texel (the classic single-color tint) and a DARK color that fills the texel's SHADOW
// term. Reading the texel's own value per channel as a light/dark ratio, the output STRAIGHT-alpha color
// per channel c in {r, g, b} is:
//
//     out_c = texel_c * light_c + (1 - texel_c) * dark_c
//
// and the alpha is unchanged by the dark term:
//
//     out_a = texel_a * light_a
//
// Intuition: where the texel is bright (texel_c -> 1) the light color dominates (out_c -> light_c); where
// the texel is dark (texel_c -> 0) the dark color shows through (out_c -> dark_c). With dark == 0 this
// collapses to the single-color path out_c = texel_c * light_c EXACTLY. The dark color's ALPHA is inert
// (ADR-0009 section 4.3, "the runtime ignores it"), so this function never reads dark.a.
//
// On the GPU this exact formula lives in the fragment program (two-color-shader.ts); the CPU function here
// is the shared REFERENCE the parity vectors assert against (packages/runtime-web/test/two-color.test.ts
// pins the same numbers as the render-preview suite), and it is what the headless describe() snapshot uses
// to report a slot's resolved tint. `light` is the resolved LIGHT color (slot color x attachment color);
// `dark` is the resolved DARK color (pose.slotDarkColor rgb, no attachment factor). Both are straight-alpha.

export interface StraightColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export function combineTwoColor(
  texel: StraightColor,
  light: StraightColor,
  dark: StraightColor,
): StraightColor {
  return {
    r: texel.r * light.r + (1 - texel.r) * dark.r,
    g: texel.g * light.g + (1 - texel.g) * dark.g,
    b: texel.b * light.b + (1 - texel.b) * dark.b,
    a: texel.a,
  };
}
