import { describe, expect, it } from 'vitest';
import {
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
    expect(isAllowedChannel('app:malicious')).toBe(false);
  });

  it('accepts a file:save request carrying a document and rejects a malformed one', () => {
    expect(
      validateWith(fileSaveRequestSchema, { document: { any: 'shape' } }, 'IPC_BAD_REQUEST').ok,
    ).toBe(true);
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

  it('accepts opened and canceled file:open responses', () => {
    expect(
      validateWith(
        fileOpenResponseSchema,
        { status: 'opened', name: 'rig.json', document: { a: 1 } },
        'IPC_BAD_RESPONSE',
      ).ok,
    ).toBe(true);
    expect(
      validateWith(fileOpenResponseSchema, { status: 'canceled' }, 'IPC_BAD_RESPONSE').ok,
    ).toBe(true);
    expect(validateWith(fileOpenResponseSchema, { status: 'opened' }, 'IPC_BAD_RESPONSE').ok).toBe(
      false,
    );
  });
});
