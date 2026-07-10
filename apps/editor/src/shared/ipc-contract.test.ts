import { describe, expect, it } from 'vitest';
import {
  atlasImportGridRequestSchema,
  atlasImportImagesRequestSchema,
  atlasImportPremadeRequestSchema,
  atlasImportRequestSchema,
  atlasImportResponseSchema,
  exportAtlasRequestSchema,
  exportAtlasResponseSchema,
  exportCancelRequestSchema,
  exportMediaRequestSchema,
  exportMediaResponseSchema,
  exportProfileSaveRequestSchema,
  exportProgressSchema,
  exportProjectRequestSchema,
  exportWriteVideoRequestSchema,
  fileOpenResponseSchema,
  fileSaveRequestSchema,
  fileSaveResponseSchema,
  getVersionRequestSchema,
  getVersionResponseSchema,
  gridSpecSchema,
  IpcChannel,
  isAllowedChannel,
  isMenuActionId,
  layeredImportResponseSchema,
  mediaExportOptionsSchema,
  spineImportResponseSchema,
  validateWith,
} from './ipc-contract';

describe('ipc-contract validation', () => {
  it('accepts a valid getVersion response', () => {
    const result = validateWith(getVersionResponseSchema, { version: '1.2.3' }, 'IPC_BAD_RESPONSE');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.version).toBe('1.2.3');
  });

  it('rejects a malformed response with a typed error and no throw', () => {
    const result = validateWith(getVersionResponseSchema, { version: 123 }, 'IPC_BAD_RESPONSE');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('IPC_BAD_RESPONSE');
  });

  it('rejects unknown extra keys (strict schema)', () => {
    const result = validateWith(
      getVersionResponseSchema,
      { version: '1.0.0', extra: true },
      'IPC_BAD_RESPONSE',
    );
    expect(result.ok).toBe(false);
  });

  it('accepts the empty (undefined) getVersion request payload', () => {
    const result = validateWith(getVersionRequestSchema, undefined, 'IPC_BAD_REQUEST');
    expect(result.ok).toBe(true);
  });

  it('allowlists known channels and rejects unknown ones', () => {
    expect(isAllowedChannel(IpcChannel.getVersion)).toBe(true);
    expect(isAllowedChannel(IpcChannel.fileSave)).toBe(true);
    expect(isAllowedChannel(IpcChannel.fileOpen)).toBe(true);
    expect(isAllowedChannel(IpcChannel.atlasImport)).toBe(true);
    expect(isAllowedChannel('atlas:import')).toBe(true);
    expect(isAllowedChannel('app:malicious')).toBe(false);
  });

  it('accepts a file:save request carrying a document and page bytes, rejects a malformed one', () => {
    expect(
      validateWith(
        fileSaveRequestSchema,
        { document: { any: 'shape' }, pages: [{ file: 'p0.png', data: new Uint8Array([1]) }] },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    // pages is required (an empty array when no atlas is loaded); omitting it is malformed.
    expect(validateWith(fileSaveRequestSchema, { document: {} }, 'IPC_BAD_REQUEST').ok).toBe(false);
    const bad = validateWith(fileSaveRequestSchema, { wrongKey: 1 }, 'IPC_BAD_REQUEST');
    expect(bad.ok).toBe(false);
  });

  it('accepts saved and canceled file:save responses, rejects an unknown status', () => {
    expect(
      validateWith(fileSaveResponseSchema, { status: 'saved', path: '/x.json' }, 'IPC_BAD_RESPONSE')
        .ok,
    ).toBe(true);
    expect(
      validateWith(fileSaveResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    expect(validateWith(fileSaveResponseSchema, { status: 'saved' }, 'IPC_BAD_RESPONSE').ok).toBe(
      false,
    );
    expect(validateWith(fileSaveResponseSchema, { status: 'bogus' }, 'IPC_BAD_RESPONSE').ok).toBe(
      false,
    );
  });

  it('accepts opened and canceled file:open responses, opened carrying page bytes', () => {
    expect(
      validateWith(
        fileOpenResponseSchema,
        {
          status: 'opened',
          name: 'rig.json',
          document: { a: 1 },
          pages: [{ file: 'p0.png', data: new Uint8Array([137, 80, 78, 71]) }],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(fileOpenResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    // pages is required on an opened response (empty when the project has no restorable textures).
    expect(
      validateWith(
        fileOpenResponseSchema,
        { status: 'opened', name: 'rig.json', document: { a: 1 } },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('accepts an atlas:importImages request of named byte blobs and rejects malformed ones', () => {
    expect(
      validateWith(
        atlasImportImagesRequestSchema,
        { images: [{ name: 'arm.png', data: new Uint8Array([137, 80, 78, 71]) }] },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    // An empty set is valid (nothing to pack); the renderer guards against sending it.
    expect(validateWith(atlasImportImagesRequestSchema, { images: [] }, 'IPC_BAD_REQUEST').ok).toBe(
      true,
    );
    // Non-byte data and a missing name are rejected at the boundary.
    expect(
      validateWith(
        atlasImportImagesRequestSchema,
        { images: [{ name: 'arm.png', data: 'not-bytes' }] },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
    expect(
      validateWith(
        atlasImportImagesRequestSchema,
        { images: [{ data: new Uint8Array([1]) }] },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
  });

  it('accepts the empty (undefined) atlas:import request and rejects any payload', () => {
    expect(validateWith(atlasImportRequestSchema, undefined, 'IPC_BAD_REQUEST').ok).toBe(true);
    expect(validateWith(atlasImportRequestSchema, {}, 'IPC_BAD_REQUEST').ok).toBe(false);
    expect(validateWith(atlasImportRequestSchema, '/etc/passwd', 'IPC_BAD_REQUEST').ok).toBe(false);
  });

  it('accepts imported and canceled atlas:import responses, rejects an unknown status', () => {
    expect(
      validateWith(
        atlasImportResponseSchema,
        { status: 'imported', atlas: { pages: [] }, pages: [] },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(atlasImportResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    expect(
      validateWith(atlasImportResponseSchema, { status: 'bogus' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(false);
    expect(
      validateWith(
        atlasImportResponseSchema,
        { status: 'imported', atlas: { pages: [] }, pages: [], extra: true },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('accepts an imported response carrying page bytes as a Uint8Array', () => {
    const result = validateWith(
      atlasImportResponseSchema,
      {
        status: 'imported',
        atlas: { pages: [{ file: 'atlas-0.png', regions: [] }] },
        pages: [{ file: 'atlas-0.png', data: new Uint8Array([137, 80, 78, 71]) }],
      },
      'IPC_BAD_RESPONSE',
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.data.status === 'imported') {
      expect(result.data.pages[0]?.data).toBeInstanceOf(Uint8Array);
    }
  });

  it('rejects an imported response missing pages or with non-byte page data', () => {
    expect(
      validateWith(
        atlasImportResponseSchema,
        { status: 'imported', atlas: { pages: [] } },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
    expect(
      validateWith(
        atlasImportResponseSchema,
        { status: 'imported', atlas: { pages: [] }, pages: [{ file: 'a.png', data: 'not-bytes' }] },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('allowlists the spine:import channel and the file:importSpine menu action (PP-A5)', () => {
    expect(isAllowedChannel(IpcChannel.spineImport)).toBe(true);
    expect(isAllowedChannel('spine:import')).toBe(true);
    expect(isMenuActionId('file:importSpine')).toBe(true);
    expect(isMenuActionId('file:importAlien')).toBe(false);
  });

  it('accepts imported, failed, and canceled spine:import responses, rejects an unknown status', () => {
    expect(
      validateWith(
        spineImportResponseSchema,
        {
          status: 'imported',
          name: 'hero',
          document: { anything: true },
          warnings: [
            { feature: 'atlas-synthesized', path: '', why: 'placeholder atlas synthesized' },
          ],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(
        spineImportResponseSchema,
        {
          status: 'failed',
          errors: [{ code: 'SPINE_VERSION_UNSUPPORTED', path: '/skeleton/spine', message: 'nope' }],
          warnings: [],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(spineImportResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    expect(
      validateWith(spineImportResponseSchema, { status: 'exploded' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(false);
  });

  it('rejects an imported spine:import response missing its name or warnings (strict schema)', () => {
    expect(
      validateWith(
        spineImportResponseSchema,
        { status: 'imported', document: {}, warnings: [] },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
    expect(
      validateWith(
        spineImportResponseSchema,
        { status: 'imported', name: 'hero', document: {} },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('allowlists the export channels and the file:export menu action', () => {
    expect(isAllowedChannel(IpcChannel.exportProject)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportMedia)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportWriteVideo)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportProfileLoad)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportProfileSave)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportAtlas)).toBe(true);
    expect(isAllowedChannel('export:atlas')).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportProgress)).toBe(true);
    expect(isAllowedChannel(IpcChannel.exportCancel)).toBe(true);
    expect(isMenuActionId('file:export')).toBe(true);
  });

  it('gates the export:atlas request by the full profile schema and validates its response', () => {
    const profile = {
      exportProfileVersion: '1.0.0',
      atlasExport: {
        maxPageSize: 2048,
        padding: 2,
        allowRotation: true,
        blendBinning: true,
        textureTransport: 'uastc-ktx2',
        compressionTargets: ['astc6x6', 'bc7', 'etc2'],
        premultipliedAlpha: true,
        scaleVariants: [1, 0.5, 0.25],
      },
      particleProfiles: {
        mobile: { maxLiveParticles: 600, ambientQualityTier: 'medium' },
        desktop: { maxLiveParticles: 2000, ambientQualityTier: 'high' },
      },
      coldStartBudgets: {
        unityIosNativeMs: 1500,
        webWarmFirstFrameMs: 1500,
        webColdInteractiveMs: 4000,
      },
    };
    expect(validateWith(exportAtlasRequestSchema, { profile }, 'IPC_BAD_REQUEST').ok).toBe(true);
    // An empty profile is malformed (the schema gate is the full exportProfileSchema).
    expect(validateWith(exportAtlasRequestSchema, { profile: {} }, 'IPC_BAD_REQUEST').ok).toBe(
      false,
    );

    expect(
      validateWith(
        exportAtlasResponseSchema,
        {
          status: 'exported',
          outputDir: '/out',
          pageFiles: ['atlas-0.png', '@0.5x/atlas-0.png'],
          manifestFile: 'atlas-targets.json',
          diagnostics: [
            { code: 'ATLAS_COMPRESSION_UNSUPPORTED', target: 'bc7', message: 'no encoder' },
          ],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(exportAtlasResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    // An empty pageFiles array is malformed on an exported response (at least the canonical page exists).
    expect(
      validateWith(
        exportAtlasResponseSchema,
        {
          status: 'exported',
          outputDir: '/out',
          pageFiles: [],
          manifestFile: 'atlas-targets.json',
          diagnostics: [],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
    // An unknown diagnostic code is rejected.
    expect(
      validateWith(
        exportAtlasResponseSchema,
        {
          status: 'exported',
          outputDir: '/out',
          pageFiles: ['atlas-0.png'],
          manifestFile: 'atlas-targets.json',
          diagnostics: [{ code: 'SOMETHING_ELSE', target: 'bc7', message: 'x' }],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('accepts a valid export:project request and rejects an unknown format', () => {
    expect(
      validateWith(
        exportProjectRequestSchema,
        { document: { any: 'shape' }, format: 'mrnt' },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(exportProjectRequestSchema, { document: {}, format: 'svg' }, 'IPC_BAD_REQUEST')
        .ok,
    ).toBe(false);
  });

  it('accepts valid media export options and rejects out-of-range fps / dimensions', () => {
    const valid = {
      medium: 'gif',
      animation: 'idle',
      fps: 24,
      width: 512,
      height: 512,
      from: { frame: 0 },
      to: { seconds: 2 },
      background: { r: 0, g: 0, b: 0, a: 1 },
      gif: { palette: 'global', loopCount: 0, alphaThreshold: 0.5 },
    };
    expect(validateWith(mediaExportOptionsSchema, valid, 'IPC_BAD_REQUEST').ok).toBe(true);
    // setup pose is a null animation.
    expect(
      validateWith(
        mediaExportOptionsSchema,
        { medium: 'apng', animation: null, fps: 30, width: 64, height: 64, background: null },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    // fps above the 120 cap is rejected.
    expect(
      validateWith(
        mediaExportOptionsSchema,
        { medium: 'gif', animation: 'idle', fps: 240, width: 64, height: 64, background: null },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
    // a zero dimension is rejected.
    expect(
      validateWith(
        mediaExportOptionsSchema,
        { medium: 'gif', animation: 'idle', fps: 24, width: 0, height: 64, background: null },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
  });

  it('accepts a valid export:media request and rejects a missing jobId', () => {
    const options = {
      medium: 'png-sequence',
      animation: 'idle',
      fps: 24,
      width: 128,
      height: 128,
      to: { frame: 10 },
      background: null,
    };
    expect(
      validateWith(
        exportMediaRequestSchema,
        { jobId: 'job-1', document: {}, pages: [], options },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(
        exportMediaRequestSchema,
        { document: {}, pages: [], options },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
  });

  it('accepts saved (with non-empty paths) and canceled export:media responses', () => {
    expect(
      validateWith(
        exportMediaResponseSchema,
        { status: 'saved', paths: ['/a/frame_0000.png'], frameCount: 1 },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(exportMediaResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    // an empty paths array is malformed on a saved response.
    expect(
      validateWith(
        exportMediaResponseSchema,
        { status: 'saved', paths: [], frameCount: 1 },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(false);
  });

  it('validates the progress, cancel, write-video, and profile-save schemas', () => {
    expect(
      validateWith(exportProgressSchema, { jobId: 'j', completed: 3, total: 10 }, 'IPC_BAD_REQUEST')
        .ok,
    ).toBe(true);
    expect(validateWith(exportCancelRequestSchema, { jobId: 'j' }, 'IPC_BAD_REQUEST').ok).toBe(
      true,
    );
    expect(
      validateWith(
        exportWriteVideoRequestSchema,
        { data: new Uint8Array([1, 2]), container: 'webm', defaultName: 'clip.webm' },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    // an unknown container is rejected.
    expect(
      validateWith(
        exportWriteVideoRequestSchema,
        { data: new Uint8Array([1]), container: 'mov', defaultName: 'clip.mov' },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
    // the profile-save request is gated by the full exportProfileSchema (an empty object is malformed).
    expect(
      validateWith(exportProfileSaveRequestSchema, { profile: {} }, 'IPC_BAD_REQUEST').ok,
    ).toBe(false);
  });

  it('allowlists the pre-made and grid atlas channels and their menu actions (PP-D5)', () => {
    expect(isAllowedChannel(IpcChannel.atlasImportPremade)).toBe(true);
    expect(isAllowedChannel('atlas:importPremade')).toBe(true);
    expect(isAllowedChannel(IpcChannel.atlasImportGrid)).toBe(true);
    expect(isAllowedChannel('atlas:importGrid')).toBe(true);
    expect(isMenuActionId('file:importAtlas')).toBe(true);
    expect(isMenuActionId('file:importGrid')).toBe(true);
  });

  it('accepts the empty pre-made atlas request and rejects a payload', () => {
    expect(validateWith(atlasImportPremadeRequestSchema, undefined, 'IPC_BAD_REQUEST').ok).toBe(
      true,
    );
    expect(validateWith(atlasImportPremadeRequestSchema, {}, 'IPC_BAD_REQUEST').ok).toBe(false);
  });

  it('validates the grid-slice spec (cell and grid modes), rejecting non-positive or unknown modes', () => {
    expect(
      validateWith(
        gridSpecSchema,
        { mode: 'cell', cellWidth: 32, cellHeight: 32 },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(gridSpecSchema, { mode: 'grid', columns: 4, rows: 4 }, 'IPC_BAD_REQUEST').ok,
    ).toBe(true);
    expect(
      validateWith(gridSpecSchema, { mode: 'grid', columns: 0, rows: 4 }, 'IPC_BAD_REQUEST').ok,
    ).toBe(false);
    expect(
      validateWith(
        gridSpecSchema,
        { mode: 'cell', cellWidth: 32.5, cellHeight: 32 },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
    expect(validateWith(gridSpecSchema, { mode: 'diagonal' }, 'IPC_BAD_REQUEST').ok).toBe(false);
  });

  it('allowlists the layered:import channel and the file:importLayered menu action (PP-D5)', () => {
    expect(isAllowedChannel(IpcChannel.layeredImport)).toBe(true);
    expect(isAllowedChannel('layered:import')).toBe(true);
    expect(isMenuActionId('file:importLayered')).toBe(true);
  });

  it('accepts imported, failed, and canceled layered:import responses, rejects an unknown status', () => {
    expect(
      validateWith(
        layeredImportResponseSchema,
        {
          status: 'imported',
          name: 'hero',
          document: { anything: true },
          pages: [{ file: 'atlas-0.png', data: new Uint8Array([1]) }],
          diagnostics: [{ feature: 'non-raster-layer', layer: 'levels', why: 'no raster' }],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(
        layeredImportResponseSchema,
        {
          status: 'failed',
          errors: [{ code: 'ORA_NO_STACK', path: '', message: 'no stack.xml' }],
          diagnostics: [],
        },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(layeredImportResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    expect(
      validateWith(layeredImportResponseSchema, { status: 'kaboom' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(false);
  });

  it('accepts a grid-import request with image bytes and a spec, rejects a malformed one', () => {
    expect(
      validateWith(
        atlasImportGridRequestSchema,
        {
          image: { name: 'sheet.png', data: new Uint8Array([1]) },
          grid: { mode: 'grid', columns: 2, rows: 2 },
        },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(
        atlasImportGridRequestSchema,
        {
          image: { name: '', data: new Uint8Array([1]) },
          grid: { mode: 'grid', columns: 2, rows: 2 },
        },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
    expect(
      validateWith(
        atlasImportGridRequestSchema,
        { image: { name: 'sheet.png', data: 'nope' }, grid: { mode: 'grid', columns: 2, rows: 2 } },
        'IPC_BAD_REQUEST',
      ).ok,
    ).toBe(false);
  });
});
