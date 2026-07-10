import { decodeBinary, parseDocument } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import { buildProjectExport } from './project-export-build';
import { validSpinDocument } from './export-fixtures';

// Unit tests for the pure project-export builder (the dialog + filesystem wrapper is the thin Electron
// seam, not exercised here). The builder validates + migrates the document to the current format version,
// so the round-trip target is the canonical validated form (parseDocument), and an invalid or tampered
// document is rejected loudly before any bytes are produced (LAW 3: validate-on-export).

// The canonical (validated + migrated to current) form of the fixture, which is what the builder encodes.
function canonicalDocument(): Record<string, unknown> {
  return parseDocument(validSpinDocument(), { verifyHash: false }) as unknown as Record<
    string,
    unknown
  >;
}

describe('buildProjectExport', () => {
  it('encodes the canonical document as MRNT binary that decodes back to it', () => {
    const canonical = canonicalDocument();

    const result = buildProjectExport(validSpinDocument(), 'mrnt');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.ext).toBe('mrnt');
    expect(result.artifact.defaultName).toBe('export-spin.mrnt');
    expect(decodeBinary(result.artifact.bytes)).toEqual(canonical);
  });

  it('encodes the canonical document as pretty JSON that parses back to it', () => {
    const canonical = canonicalDocument();

    const result = buildProjectExport(validSpinDocument(), 'json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.artifact.ext).toBe('json');
    expect(result.artifact.defaultName).toBe('export-spin.json');
    const text = new TextDecoder().decode(result.artifact.bytes);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseDocument(JSON.parse(text), { verifyHash: true })).toEqual(canonical);
  });

  it('rejects a document that fails format validation with a typed failure', () => {
    const result = buildProjectExport({ not: 'a document' }, 'mrnt');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('failed validation');
  });

  it('rejects a current-version document whose stored hash does not match its content (tamper)', () => {
    const tampered = { ...canonicalDocument(), name: 'tampered' };

    const result = buildProjectExport(tampered, 'json');

    expect(result.ok).toBe(false);
  });
});
