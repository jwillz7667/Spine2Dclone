import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';

// The two-color (light + dark) tint as a PixiJS v8 Filter (PP-C8). This is the thin GL adapter for the pure
// two-color math (two-color.ts): the fragment program implements the SAME formula the CPU rasterizer in
// render-preview implements, so a two-color slot shades identically in the preview and the shipped renderer.
//
// Why a Filter (not a per-Mesh custom shader): a Filter applies uniformly to ANY display object (the pooled
// region Sprite AND the Mesh attachments), so one mechanism covers both attachment kinds without a second
// region path or a Sprite-shader workaround (v8 Sprites take no custom shader). The affected display is
// drawn with tint = white and alpha = 1 (raw texel), and this filter does the ENTIRE two-color tint from its
// uniforms, so the object's own tint/alpha never double-applies.
//
// PMA handling: a filter's `uTexture` input is PREMULTIPLIED alpha (Pixi renders the object to a texture
// first). The two-color formula is defined on STRAIGHT color, so the fragment un-premultiplies the sampled
// texel (rgb / a), applies out = texel*light + (1 - texel)*dark on the straight color, folds the light
// alpha (out_a = texel_a * light_a), then re-premultiplies for the framebuffer. `uLight`/`uDark` are vec4:
// uLight = (slot x attachment color) rgb + alpha; uDark = slot dark color rgb (alpha 1, inert per ADR-0009
// 4.3, never read). With uDark.rgb == 0 the fragment collapses to the single-color premultiplied path.
//
// NOTE (repo convention, CLAUDE.md): the actual pixel output needs a WebGL/WebGPU context and is NOT
// exercised in the headless test container. Its correctness is covered by the pure-math parity test
// (two-color.test.ts, the same vectors as render-preview) plus the structural describe() wiring test; the
// GLSL/WGSL below is kept minimal and mirrors Pixi's own AlphaFilter shape so it is reviewable by eye.

const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uLight;
uniform vec4 uDark;

void main(void)
{
    vec4 tex = texture(uTexture, vTextureCoord);
    // Un-premultiply to straight color; a fully transparent texel has no defined straight color, so use 0.
    vec3 straight = tex.a > 0.0 ? tex.rgb / tex.a : vec3(0.0);
    vec3 outStraight = straight * uLight.rgb + (vec3(1.0) - straight) * uDark.rgb;
    float outAlpha = tex.a * uLight.a;
    finalColor = vec4(outStraight * outAlpha, outAlpha);
}
`;

const wgsl = /* wgsl */ `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

struct TwoColorUniforms {
  uLight:vec4<f32>,
  uDark:vec4<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler : sampler;
@group(1) @binding(0) var<uniform> twoColor : TwoColorUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv : vec2<f32>
};

fn filterVertexPosition(aPosition:vec2<f32>) -> vec4<f32>
{
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0*gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

fn filterTextureCoord( aPosition:vec2<f32> ) -> vec2<f32>
{
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition : vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let tex = textureSample(uTexture, uSampler, uv);
  var straight = vec3<f32>(0.0);
  if (tex.a > 0.0) { straight = tex.rgb / tex.a; }
  let outStraight = straight * twoColor.uLight.rgb + (vec3<f32>(1.0) - straight) * twoColor.uDark.rgb;
  let outAlpha = tex.a * twoColor.uLight.a;
  return vec4<f32>(outStraight * outAlpha, outAlpha);
}
`;

// A two-color tint filter with mutable uLight / uDark vec4 uniforms. One instance per dark-color slot; the
// uniform values are updated in place each frame (allocation-free) via updateTwoColorFilter.
export class TwoColorFilter extends Filter {
  constructor() {
    const glProgram = GlProgram.from({ vertex, fragment, name: 'two-color-filter' });
    const gpuProgram = GpuProgram.from({
      vertex: { source: wgsl, entryPoint: 'mainVertex' },
      fragment: { source: wgsl, entryPoint: 'mainFragment' },
    });
    const twoColorUniforms = new UniformGroup({
      uLight: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' },
      uDark: { value: new Float32Array([0, 0, 0, 1]), type: 'vec4<f32>' },
    });
    super({ glProgram, gpuProgram, resources: { twoColorUniforms } });
  }
}

// Write the resolved light and dark colors into the filter's uniform arrays in place (no allocation). rgb
// are straight [0, 1]; `lightA` is the resolved slot x attachment alpha. Dark alpha is inert (fixed at 1).
export function updateTwoColorFilter(
  filter: TwoColorFilter,
  lightR: number,
  lightG: number,
  lightB: number,
  lightA: number,
  darkR: number,
  darkG: number,
  darkB: number,
): void {
  const uniforms = filter.resources.twoColorUniforms.uniforms as {
    uLight: Float32Array;
    uDark: Float32Array;
  };
  uniforms.uLight[0] = lightR;
  uniforms.uLight[1] = lightG;
  uniforms.uLight[2] = lightB;
  uniforms.uLight[3] = lightA;
  uniforms.uDark[0] = darkR;
  uniforms.uDark[1] = darkG;
  uniforms.uDark[2] = darkB;
  uniforms.uDark[3] = 1;
}
