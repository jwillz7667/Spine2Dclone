import { describe, expect, it } from 'vitest';
import { convertSpineProject, type SpineFileContents } from './spine-import-convert';

// Unit tests for the pure conversion + response mapping of the Import Spine Project handler (the dialog +
// filesystem wrapper is not exercised here; this is the testable core). The .skel buffer is hand-built
// from the published binary format spec, never a real export (clean-room posture, LAW 4 / PP-A5).

// A minimal valid Spine JSON: one root bone plus a region-attachment slot. Converting it synthesizes a
// placeholder atlas region, so the importer reports one atlas-synthesized warning.
const spineJson = JSON.stringify({
  skeleton: { spine: '4.1.24' },
  bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
  slots: [{ name: 'body', bone: 'root', attachment: 'skin' }],
  skins: [
    { name: 'default', attachments: { body: { skin: { type: 'region', width: 16, height: 16 } } } },
  ],
});

// A tiny .skel byte writer per the published primitive encodings (a minimal one-root-bone skeleton).
function minimalSkel(version = '4.1.24'): Uint8Array {
  const out: number[] = [];
  const view = new DataView(new ArrayBuffer(4));
  const varint = (v: number): void => {
    let value = v >>> 0;
    for (;;) {
      const b = value & 0x7f;
      value >>>= 7;
      if (value === 0) {
        out.push(b);
        return;
      }
      out.push(b | 0x80);
    }
  };
  const float = (v: number): void => {
    view.setFloat32(0, v, false);
    for (let i = 0; i < 4; i += 1) out.push(view.getUint8(i));
  };
  const str = (s: string): void => {
    const bytes = new TextEncoder().encode(s);
    varint(bytes.length + 1);
    for (const b of bytes) out.push(b);
  };
  str('hash');
  str(version);
  float(0);
  float(0);
  float(0);
  float(0);
  out.push(0); // nonessential = false
  varint(0); // string table
  varint(1); // bones
  str('root');
  float(0);
  float(0);
  float(0);
  float(1);
  float(1);
  float(0);
  float(0);
  float(0);
  out.push(0); // transform mode
  out.push(0); // skin required
  for (let i = 0; i < 6; i += 1) varint(0); // slots, ik, transform, path, default-skin slots, extra skins
  varint(0); // events
  varint(0); // animations
  return Uint8Array.from(out);
}

function jsonContents(text: string): SpineFileContents {
  return { kind: 'json', text };
}

describe('convertSpineProject', () => {
  it('imports a Spine .json project, deriving the name from the path and reporting warnings', () => {
    const response = convertSpineProject('/projects/hero.json', jsonContents(spineJson));
    expect(response.status).toBe('imported');
    if (response.status !== 'imported') return;
    expect(response.name).toBe('hero');
    expect(response.warnings.some((w) => w.feature === 'atlas-synthesized')).toBe(true);
    // The document is present and opaque at this boundary (the renderer re-validates on load).
    expect(response.document).toBeDefined();
  });

  it('imports a Spine .skel binary project through the same pipeline', () => {
    const response = convertSpineProject('/projects/hero.skel', {
      kind: 'skel',
      bytes: minimalSkel(),
    });
    expect(response.status).toBe('imported');
    if (response.status !== 'imported') return;
    expect(response.name).toBe('hero');
  });

  it('maps an unsupported Spine version to a failed response with the typed importer error', () => {
    const response = convertSpineProject(
      '/old.json',
      jsonContents(JSON.stringify({ skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }] })),
    );
    expect(response.status).toBe('failed');
    if (response.status !== 'failed') return;
    expect(response.errors.some((e) => e.code === 'SPINE_VERSION_UNSUPPORTED')).toBe(true);
  });

  it('maps invalid JSON to a failed response with SPINE_INVALID_JSON', () => {
    const response = convertSpineProject('/bad.json', jsonContents('not json {'));
    expect(response.status).toBe('failed');
    if (response.status !== 'failed') return;
    expect(response.errors[0]?.code).toBe('SPINE_INVALID_JSON');
  });

  it('maps a malformed .skel binary to a failed response with a typed binary error', () => {
    const truncated = minimalSkel().subarray(0, 10);
    const response = convertSpineProject('/truncated.skel', { kind: 'skel', bytes: truncated });
    expect(response.status).toBe('failed');
    if (response.status !== 'failed') return;
    expect(response.errors.some((e) => e.code === 'SPINE_BINARY_TRUNCATED')).toBe(true);
  });
});
