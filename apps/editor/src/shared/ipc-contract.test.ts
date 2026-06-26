import { describe, expect, it } from 'vitest';
import {
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
    expect(isAllowedChannel('app:malicious')).toBe(false);
  });
});
