import { encodePng } from '@marionette/atlas-pack';
import { validateDocument } from '@marionette/format';
import { zipSync, strToU8 } from 'fflate';
import { writePsd, type Psd } from 'ag-psd';
import { describe, expect, it } from 'vitest';
import { projectLayeredFile } from './layered-project';

// End-to-end tests for the electron-free layered-import orchestration (PP-D5): bytes in, a typed response
// out. It runs the real parse -> pack -> build -> validate pipeline for both PSD and ORA fixtures built in
// code, and covers the failure branches (no usable layers, a corrupt ORA). The success document is the same
// one the renderer would load, so validateDocument is asserted here too.

function opaquePixels(
  width: number,
  height: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width, height };
}

function buildPsd(): Uint8Array {
  const psd: Psd = {
    width: 48,
    height: 48,
    children: [
      { name: 'bg', left: 0, top: 0, right: 48, bottom: 48, imageData: opaquePixels(48, 48) },
      { name: 'dot', left: 10, top: 10, right: 26, bottom: 26, imageData: opaquePixels(16, 16) },
    ],
  } as unknown as Psd;
  return new Uint8Array(writePsd(psd, { generateThumbnail: false }));
}

function opaquePng(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return new Uint8Array(encodePng({ width, height, rgba }));
}

function buildOra(): Uint8Array {
  return zipSync({
    mimetype: strToU8('image/openraster'),
    'stack.xml': strToU8(
      '<image w="48" h="48"><stack><layer name="dot" src="data/dot.png" x="10" y="10"/></stack></image>',
    ),
    'data/dot.png': opaquePng(16, 16),
  });
}

describe('projectLayeredFile', () => {
  it('projects a PSD into a validated rig with an atlas and page bytes', () => {
    const response = projectLayeredFile(buildPsd(), 'hero', 'psd');
    expect(response.status).toBe('imported');
    if (response.status !== 'imported') return;

    expect(response.name).toBe('hero');
    expect(response.pages.length).toBeGreaterThan(0);
    const report = validateDocument(response.document);
    expect(report.ok).toBe(true);
    if (!report.ok || report.document === null) return;
    expect(report.document.slots).toHaveLength(2);
  });

  it('projects an ORA into a validated rig', () => {
    const response = projectLayeredFile(buildOra(), 'creature', 'ora');
    expect(response.status).toBe('imported');
    if (response.status !== 'imported') return;
    expect(validateDocument(response.document).ok).toBe(true);
  });

  it('fails with LAYERED_NO_LAYERS when the file has no usable raster layers', () => {
    const emptyOra = zipSync({
      mimetype: strToU8('image/openraster'),
      'stack.xml': strToU8('<image w="8" h="8"><stack></stack></image>'),
    });
    const response = projectLayeredFile(emptyOra, 'empty', 'ora');
    expect(response.status).toBe('failed');
    if (response.status !== 'failed') return;
    expect(response.errors[0]?.code).toBe('LAYERED_NO_LAYERS');
  });

  it('fails with a typed code when the ORA is not a zip', () => {
    const response = projectLayeredFile(new Uint8Array([9, 9, 9]), 'broken', 'ora');
    expect(response.status).toBe('failed');
    if (response.status !== 'failed') return;
    expect(response.errors[0]?.code).toBe('ORA_NOT_A_ZIP');
  });
});
