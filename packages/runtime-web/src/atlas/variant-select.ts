// The NORMATIVE compressed-texture variant SELECTION algorithm (phase-5 WP-5.2, TASK-5.2.8, DECISION-5.2.b).
// Given the platform's STATIC GPU capability set, it selects which compressed target to transcode/decode
// to (or the canonical PNG fallback). It is shared by web, Unity, and Godot: this is the reference
// implementation (the web consumer), and the native loaders mirror it function-for-function so every
// runtime selects the SAME variant on the same device. It reads ONLY the static GPU capability set, NEVER
// frame rate or wall-clock, so the same device yields the same variant every run. Textures are not solve
// inputs (Law 1 is untouched), but the determinism discipline still applies: selection is a pure function.
//
// This module is PURE (no PixiJS, no GL context): the actual transcode/decode of the chosen variant, and
// reading the live capability set from a WebGL context, happen at the GL edge (the remainder of WP-5.2.8,
// which needs a context and is not exercised headlessly). The capability MAPPING from WebGL extension
// names is pure and is tested here; only `gl.getSupportedExtensions()` itself is at the edge.

// The compressed GPU targets the atlas pipeline can transcode/pre-bake to (phase-5 section 4.1
// compressionTargets; 'astc6x6' is the authored ASTC block size, exposed here as the 'astc' family).
export type CompressedTextureTarget = 'astc' | 'bc7' | 'etc2';

// The selected variant: a compressed target, or the canonical PNG (AtlasPage.file) fallback.
export type TextureVariant = CompressedTextureTarget | 'png';

// The STATIC GPU capability set the selector reads. Each flag is whether the device/context supports that
// compressed family. Derived once from the GPU/context capabilities, never from runtime measurements.
export interface GpuCapabilities {
  readonly astc: boolean;
  readonly bc7: boolean;
  readonly etc2: boolean;
}

// The NORMATIVE selection order (phase-5 WP-5.2): ASTC first (iOS/Metal, Android GLES3+/Vulkan, desktop
// WebGL via WEBGL_compressed_texture_astc), else BC7 (desktop DX/Vulkan/Metal, WebGL EXT_texture_compression_bptc),
// else ETC2 (mobile GLES3 without ASTC), else the canonical PNG. Total and deterministic: every capability
// set maps to exactly one variant.
export function selectTextureVariant(capabilities: GpuCapabilities): TextureVariant {
  if (capabilities.astc) return 'astc';
  if (capabilities.bc7) return 'bc7';
  if (capabilities.etc2) return 'etc2';
  return 'png';
}

// The WebGL extension names that signal each compressed family (the web mapping of the capability set).
// Both the WEBGL_ and the WEBKIT_WEBGL_ vendor-prefixed forms are recognized for older contexts.
const ASTC_EXTENSIONS: readonly string[] = [
  'WEBGL_compressed_texture_astc',
  'WEBKIT_WEBGL_compressed_texture_astc',
];
const BC7_EXTENSIONS: readonly string[] = ['EXT_texture_compression_bptc'];
const ETC2_EXTENSIONS: readonly string[] = [
  'WEBGL_compressed_texture_etc',
  'WEBKIT_WEBGL_compressed_texture_etc',
];

// Map a WebGL context's supported-extension list to the static GpuCapabilities. Pure: the caller passes
// `gl.getSupportedExtensions()` (or a mock); this function does no GL work, so it is fully headless-testable.
export function gpuCapabilitiesFromExtensions(supportedExtensions: readonly string[]): GpuCapabilities {
  const supported = new Set(supportedExtensions);
  const anyOf = (names: readonly string[]): boolean => names.some((name) => supported.has(name));
  return {
    astc: anyOf(ASTC_EXTENSIONS),
    bc7: anyOf(BC7_EXTENSIONS),
    etc2: anyOf(ETC2_EXTENSIONS),
  };
}
