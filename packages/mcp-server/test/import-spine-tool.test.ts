import { describe, expect, it } from 'vitest';
import { McpToolError, SessionRegistry, TOOLS, type FileStore, type ToolDeps } from '../src';

// Functional tests for the PP-A5 import.spineProject MCP tool: it converts a user-owned exported Spine
// project (a .json or a .skel binary) through the clean-room importer and opens it as an editable session.
// The .skel buffer here is hand-built from the published binary format spec (never a real export), so the
// test stays clean-room (LAW 4 / PP-A5).

const importTool = TOOLS.find((tool) => tool.name === 'import.spineProject');
if (importTool === undefined) throw new Error('import.spineProject tool is not registered');

// A file store backed by two maps the test can seed directly.
function seededFiles(text: Record<string, string>, bytes: Record<string, Uint8Array>): FileStore {
  return {
    read: async (path) => {
      const value = text[path];
      if (value === undefined) throw new Error(`no text file ${path}`);
      return value;
    },
    write: async () => undefined,
    readBinary: async (path) => {
      const value = bytes[path];
      if (value === undefined) throw new Error(`no binary file ${path}`);
      return value;
    },
    writeBinary: async () => undefined,
    listDir: async () => [],
  };
}

function deps(files: FileStore): ToolDeps {
  return { sessions: new SessionRegistry(), files };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

// A minimal valid Spine JSON (one root bone, one region-attachment slot). Converting it synthesizes a
// placeholder atlas region, so the importer reports one atlas-synthesized warning.
const spineJson = {
  skeleton: { spine: '4.1.24' },
  bones: [{ name: 'root' }, { name: 'arm', parent: 'root' }],
  slots: [{ name: 'body', bone: 'root', attachment: 'skin' }],
  skins: [
    { name: 'default', attachments: { body: { skin: { type: 'region', width: 16, height: 16 } } } },
  ],
};

// A tiny byte writer that mirrors the published .skel primitive encodings, used to hand-build a minimal
// binary skeleton (one root bone, no slots/skins/animations) for the binary-dispatch test.
class MiniSkel {
  private readonly out: number[] = [];
  private readonly view = new DataView(new ArrayBuffer(4));
  byte(v: number): this {
    this.out.push(v & 0xff);
    return this;
  }
  varint(v: number): this {
    let value = v >>> 0;
    for (;;) {
      const b = value & 0x7f;
      value >>>= 7;
      if (value === 0) return this.byte(b);
      this.byte(b | 0x80);
    }
  }
  float(v: number): this {
    this.view.setFloat32(0, v, false);
    return this.byte(this.view.getUint8(0))
      .byte(this.view.getUint8(1))
      .byte(this.view.getUint8(2))
      .byte(this.view.getUint8(3));
  }
  str(s: string): this {
    const bytes = new TextEncoder().encode(s);
    this.varint(bytes.length + 1);
    for (const b of bytes) this.byte(b);
    return this;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

function minimalSkel(version = '4.1.24'): Uint8Array {
  const w = new MiniSkel();
  w.str('hash').str(version);
  w.float(0).float(0).float(0).float(0); // x, y, width, height
  w.byte(0); // nonessential = false
  w.varint(0); // string table count
  w.varint(1); // bone count
  w.str('root');
  w.float(0).float(0).float(0).float(1).float(1).float(0).float(0).float(0); // rotation,x,y,scaleX,scaleY,shearX,shearY,length
  w.byte(0); // transform mode normal
  w.byte(0); // skin required
  w.varint(0); // slots
  w.varint(0); // ik
  w.varint(0); // transform
  w.varint(0); // path
  w.varint(0); // default skin: 0 slots
  w.varint(0); // 0 additional skins
  w.varint(0); // events
  w.varint(0); // animations
  return w.bytes();
}

describe('import.spineProject tool', () => {
  it('imports a Spine .json project, opens an editable session, and reports a summary + warnings', async () => {
    const d = deps(seededFiles({ '/rig.json': JSON.stringify(spineJson) }, {}));
    const result = asRecord(await importTool.handler(d, { path: '/rig.json', name: 'imported' }));

    expect(result['format']).toBe('json');
    expect(result['name']).toBe('imported');
    expect(result['summary']).toMatchObject({ bones: 2, slots: 1, skins: 1, animations: 0 });
    const warnings = result['warnings'] as Array<{ feature: string }>;
    expect(warnings.some((w) => w.feature === 'atlas-synthesized')).toBe(true);

    // The imported document is a live, editable session: bone.rotate drives a command on it.
    const documentId = result['documentId'] as string;
    await expect(importTool.handler(d, { path: '/rig.json' })).resolves.toBeDefined();
    expect(d.sessions.get(documentId)).toBeDefined();
  });

  it('imports a Spine .skel binary project through the same clean-room pipeline', async () => {
    const d = deps(seededFiles({}, { '/rig.skel': minimalSkel() }));
    const result = asRecord(await importTool.handler(d, { path: '/rig.skel' }));

    expect(result['format']).toBe('skel');
    expect(result['summary']).toMatchObject({ bones: 1, slots: 0 });
    expect(result['documentId']).toBeTypeOf('string');
  });

  it('rejects a missing file with FILE_READ_ERROR', async () => {
    const d = deps(seededFiles({}, {}));
    await expect(importTool.handler(d, { path: '/missing.json' })).rejects.toBeInstanceOf(
      McpToolError,
    );
    await expect(importTool.handler(d, { path: '/missing.json' })).rejects.toMatchObject({
      code: 'FILE_READ_ERROR',
    });
  });

  it('rejects non-JSON content with INVALID_JSON', async () => {
    const d = deps(seededFiles({ '/bad.json': 'not json {' }, {}));
    await expect(importTool.handler(d, { path: '/bad.json' })).rejects.toMatchObject({
      code: 'INVALID_JSON',
    });
  });

  it('surfaces an unsupported Spine version as SPINE_IMPORT_FAILED with the typed importer errors', async () => {
    const d = deps(
      seededFiles(
        {
          '/old.json': JSON.stringify({ skeleton: { spine: '3.8.99' }, bones: [{ name: 'root' }] }),
        },
        {},
      ),
    );
    await expect(importTool.handler(d, { path: '/old.json' })).rejects.toMatchObject({
      code: 'SPINE_IMPORT_FAILED',
    });
    await importTool.handler(d, { path: '/old.json' }).catch((error: unknown) => {
      const detail = (error as McpToolError).detail as { errors: Array<{ code: string }> };
      expect(detail.errors.some((e) => e.code === 'SPINE_VERSION_UNSUPPORTED')).toBe(true);
    });
  });

  it('surfaces a malformed .skel binary as SPINE_IMPORT_FAILED', async () => {
    const d = deps(seededFiles({}, { '/truncated.skel': minimalSkel().subarray(0, 12) }));
    await expect(importTool.handler(d, { path: '/truncated.skel' })).rejects.toMatchObject({
      code: 'SPINE_IMPORT_FAILED',
    });
  });
});
