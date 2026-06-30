import { describe, expect, it } from 'vitest';
import {
  gpuCapabilitiesFromExtensions,
  selectTextureVariant,
} from '../src/atlas/variant-select';
import type { GpuCapabilities } from '../src/atlas/variant-select';

// WP-5.2 TASK-5.2.8 (the non-GL part): the NORMATIVE texture-variant selector returns the EXPECTED target
// for each branch (ASTC, BC7, ETC2, PNG) given a mocked capability set, and the WebGL extension mapping
// derives the capability set deterministically. The GPU transcode/decode is the GL-edge remainder.

function caps(partial: Partial<GpuCapabilities>): GpuCapabilities {
  return { astc: false, bc7: false, etc2: false, ...partial };
}

describe('texture-variant selection (WP-5.2, TASK-5.2.8)', () => {
  it('selects ASTC when ASTC is supported (highest priority)', () => {
    expect(selectTextureVariant(caps({ astc: true }))).toBe('astc');
    // ASTC wins even when BC7 and ETC2 are also present.
    expect(selectTextureVariant(caps({ astc: true, bc7: true, etc2: true }))).toBe('astc');
  });

  it('selects BC7 when ASTC is absent but BC7 is supported', () => {
    expect(selectTextureVariant(caps({ bc7: true }))).toBe('bc7');
    expect(selectTextureVariant(caps({ bc7: true, etc2: true }))).toBe('bc7');
  });

  it('selects ETC2 when only ETC2 is supported', () => {
    expect(selectTextureVariant(caps({ etc2: true }))).toBe('etc2');
  });

  it('falls back to PNG when no compressed family is supported', () => {
    expect(selectTextureVariant(caps({}))).toBe('png');
  });

  it('is deterministic and total (the same capabilities always yield the same variant)', () => {
    const c = caps({ bc7: true });
    expect(selectTextureVariant(c)).toBe(selectTextureVariant(c));
  });

  describe('gpuCapabilitiesFromExtensions (WebGL extension mapping)', () => {
    it('maps the ASTC extension (and its vendor-prefixed form)', () => {
      expect(gpuCapabilitiesFromExtensions(['WEBGL_compressed_texture_astc']).astc).toBe(true);
      expect(gpuCapabilitiesFromExtensions(['WEBKIT_WEBGL_compressed_texture_astc']).astc).toBe(true);
    });

    it('maps the BC7 (BPTC) extension', () => {
      const c = gpuCapabilitiesFromExtensions(['EXT_texture_compression_bptc']);
      expect(c.bc7).toBe(true);
      expect(c.astc).toBe(false);
    });

    it('maps the ETC2 extension', () => {
      expect(gpuCapabilitiesFromExtensions(['WEBGL_compressed_texture_etc']).etc2).toBe(true);
    });

    it('reports no capabilities for an empty or unrelated extension list', () => {
      expect(gpuCapabilitiesFromExtensions([])).toEqual({ astc: false, bc7: false, etc2: false });
      expect(gpuCapabilitiesFromExtensions(['OES_vertex_array_object'])).toEqual({
        astc: false,
        bc7: false,
        etc2: false,
      });
    });

    it('end-to-end: a desktop WebGL context with only BPTC selects BC7', () => {
      const c = gpuCapabilitiesFromExtensions(['EXT_texture_compression_bptc', 'OES_texture_float']);
      expect(selectTextureVariant(c)).toBe('bc7');
    });

    it('end-to-end: a mobile GLES3 context with ASTC selects ASTC', () => {
      const c = gpuCapabilitiesFromExtensions([
        'WEBGL_compressed_texture_astc',
        'WEBGL_compressed_texture_etc',
      ]);
      expect(selectTextureVariant(c)).toBe('astc');
    });
  });
});
