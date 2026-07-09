import { describe, expect, it } from 'vitest';
import {
  atlasImportImagesRequestSchema,
  atlasImportRequestSchema,
  atlasImportResponseSchema,
  fileOpenResponseSchema,
  fileSaveRequestSchema,
  fileSaveResponseSchema,
  getVersionRequestSchema,
  getVersionResponseSchema,
  IpcChannel,
  isAllowedChannel,
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
    expect(
      validateWith(atlasImportImagesRequestSchema, { images: [] }, 'IPC_BAD_REQUEST').ok,
    ).toBe(true);
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
});
