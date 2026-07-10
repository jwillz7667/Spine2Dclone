import { describe, expect, it } from 'vitest';
import { SkelReader } from '../src/binary/reader';
import { decodeSkel } from '../src/binary/decode-skel';
import { importSpineSkel } from '../src/index';
import { SkelWriter, encodeSkel, type SkelModel } from './fixtures/skel-encoder';

// Byte-level unit tests for the .skel primitive reader and the section decoder. Every buffer is built BY
// HAND with the test encoder (which writes bytes per the published binary format spec), never from a real
// Spine export (clean-room posture, LAW 4 / PP-A5).

function reader(build: (w: SkelWriter) => void): SkelReader {
  const w = new SkelWriter();
  build(w);
  return new SkelReader(w.toBytes());
}

describe('SkelReader primitives', () => {
  it('round-trips unsigned varints across the 1 to 5 byte boundaries', () => {
    const values = [0, 1, 127, 128, 300, 16383, 16384, 2097151, 2097152, 0x7fffffff];
    const r = reader((w) => values.forEach((v) => w.varint(v, true)));
    for (const v of values) expect(r.count('/x', 'value')).toBe(v);
  });

  it('round-trips signed (zigzag) varints including negatives', () => {
    const values = [0, -1, 1, -2, 2, -64, 63, -1000, 1000, -2147483648, 2147483647];
    const r = reader((w) => values.forEach((v) => w.varint(v, false)));
    for (const v of values) expect(r.varint('/x', false, 'value')).toBe(v);
  });

  it('reads big-endian int, short and IEEE-754 floats', () => {
    const r = reader((w) => {
      w.int32(-1);
      w.int32(0x01020304);
      w.short(0xbeef);
      w.float(1.5);
      w.float(-0.25);
    });
    expect(r.int32('/x')).toBe(-1);
    expect(r.int32('/x')).toBe(0x01020304);
    expect(r.short('/x')).toBe(0xbeef);
    expect(r.float('/x')).toBeCloseTo(1.5, 6);
    expect(r.float('/x')).toBeCloseTo(-0.25, 6);
  });

  it('reads inline strings: null, empty, and UTF-8', () => {
    const r = reader((w) => {
      w.string(null);
      w.string('');
      w.string('héllo');
    });
    expect(r.string('/x')).toBeNull();
    expect(r.string('/x')).toBe('');
    expect(r.string('/x')).toBe('héllo');
  });

  it('resolves colors to the shared hex forms the converter parses', () => {
    const r = reader((w) => {
      w.colorRgba('ff8800cc');
      w.colorDark('112233');
      w.colorDark(null);
    });
    expect(r.colorRgba('/x')).toBe('ff8800cc');
    expect(r.colorDark('/x')).toBe('112233');
    expect(r.colorDark('/x')).toBeNull();
  });

  it('reads signed bytes (bend direction sentinel)', () => {
    const r = reader((w) => {
      w.sbyte(1);
      w.sbyte(-1);
    });
    expect(r.sbyte('/x')).toBe(1);
    expect(r.sbyte('/x')).toBe(-1);
  });
});

// A comprehensive model touching every section, used by the structural decode assertions below.
const richModel: SkelModel = {
  version: '4.1.24',
  nonessential: true,
  fps: 24,
  images: './art/',
  bones: [
    { name: 'root' },
    { name: 'arm', parent: 'root', x: 40, rotation: 15 },
    { name: 'target', parent: 'root', x: 80 },
    { name: 'pathbone', parent: 'root' },
  ],
  slots: [
    { name: 'body', bone: 'arm', color: 'ff0000ff', dark: '223344', attachment: 'skin', blend: 2 },
    { name: 'pathslot', bone: 'root', attachment: 'thepath' },
  ],
  ik: [
    {
      name: 'ik1',
      order: 0,
      bones: ['arm'],
      target: 'target',
      mix: 0.75,
      bendPositive: false,
      softness: 3,
      stretch: true,
    },
  ],
  transform: [
    {
      name: 'tc1',
      order: 1,
      bone: 'arm',
      target: 'target',
      rotateMix: 1,
      translateMix: 0.5,
      scaleMix: 0.25,
      shearMix: 0,
      rotation: 10,
      x: 4,
    },
  ],
  path: [
    {
      name: 'pc1',
      order: 2,
      bones: ['pathbone'],
      target: 'pathslot',
      positionMode: 1,
      spacingMode: 0,
      rotateMode: 2,
      rotateMix: 1,
      translateMix: 1,
    },
  ],
  skins: [
    {
      name: 'default',
      slots: [
        {
          slot: 'body',
          attachments: [
            {
              placeholder: 'skin',
              type: 'mesh',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              vertices: [0, 0, 64, 0, 64, 64, 0, 64],
              hull: 4,
              width: 64,
              height: 64,
            },
          ],
        },
        {
          slot: 'pathslot',
          attachments: [
            {
              placeholder: 'thepath',
              type: 'path',
              closed: false,
              constantSpeed: true,
              vertexCount: 4,
              vertices: [0, 0, 10, 0, 20, 0, 30, 0],
              lengths: [30],
            },
          ],
        },
      ],
    },
  ],
  events: [{ name: 'boom', int: 3, audio: 'sfx/boom.ogg', volume: 0.5, balance: -0.25 }],
  animations: [
    {
      name: 'act',
      bones: [
        {
          bone: 'arm',
          rotate: [
            { time: 0, angle: 0 },
            { time: 0.5, angle: 30, curve: 'stepped' },
            { time: 1, angle: 60 },
          ],
        },
      ],
      ik: [
        {
          ik: 'ik1',
          frames: [
            { time: 0, mix: 1, bendPositive: true },
            { time: 1, mix: 0.25, bendPositive: false },
          ],
        },
      ],
      events: [{ time: 1, event: 'boom', int: 7 }],
    },
  ],
};

describe('decodeSkel structural mapping', () => {
  it('decodes the header, string table and every section into the name-based intermediate', () => {
    const decoded = decodeSkel(encodeSkel(richModel)) as Record<string, unknown>;

    expect(decoded['skeleton']).toEqual({ spine: '4.1.24', fps: 24, images: './art/' });

    const bones = decoded['bones'] as Array<Record<string, unknown>>;
    expect(bones).toHaveLength(4);
    expect(bones[0]).not.toHaveProperty('parent'); // root has no parent
    expect(bones[1]).toMatchObject({
      name: 'arm',
      parent: 'root',
      x: 40,
      rotation: 15,
      transform: 'normal',
    });

    const slots = decoded['slots'] as Array<Record<string, unknown>>;
    expect(slots[0]).toMatchObject({
      name: 'body',
      bone: 'arm',
      color: 'ff0000ff',
      dark: '223344',
      attachment: 'skin',
      blend: 'multiply',
    });

    const ik = decoded['ik'] as Array<Record<string, unknown>>;
    expect(ik[0]).toMatchObject({
      name: 'ik1',
      bones: ['arm'],
      target: 'target',
      mix: 0.75,
      bendPositive: false,
      stretch: true,
    });

    const transform = decoded['transform'] as Array<Record<string, unknown>>;
    expect(transform[0]).toMatchObject({
      name: 'tc1',
      bones: ['arm'],
      target: 'target',
      translateMix: 0.5,
    });

    const path = decoded['path'] as Array<Record<string, unknown>>;
    expect(path[0]).toMatchObject({
      name: 'pc1',
      bones: ['pathbone'],
      target: 'pathslot',
      positionMode: 'percent',
      rotateMode: 'chainScale',
    });

    const events = decoded['events'] as Record<string, unknown>;
    expect(events['boom']).toEqual({ int: 3, audio: 'sfx/boom.ogg', volume: 0.5, balance: -0.25 });

    const animations = decoded['animations'] as Record<string, Record<string, unknown>>;
    const act = animations['act']!;
    const armRotate = (act['bones'] as Record<string, Record<string, unknown[]>>)['arm']![
      'rotate'
    ]!;
    expect(armRotate).toHaveLength(3);
    expect(armRotate[0]).toEqual({ time: 0, angle: 0 }); // linear key carries no curve field
    expect(armRotate[1]).toEqual({ time: 0.5, angle: 30, curve: 'stepped' });
    expect(armRotate[2]).toEqual({ time: 1, angle: 60 }); // last key omits its outgoing curve
  });

  it('imports the rich model to a validated document with derived weighted metadata absent', () => {
    const result = importSpineSkel(encodeSkel(richModel), { name: 'rich' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.name).toBe('rich');
    expect(result.document.bones.map((b) => b.name)).toEqual(['root', 'arm', 'target', 'pathbone']);
    expect(result.document.ikConstraints[0]?.bend).toBe(-1);
    expect(result.document.animations['act']?.duration).toBe(1);
  });

  it('accepts both a Uint8Array and an ArrayBuffer view of the same bytes', () => {
    const bytes = encodeSkel(richModel);
    const fromArray = importSpineSkel(bytes, { name: 'rich' });
    const copy = bytes.slice();
    const fromBuffer = importSpineSkel(copy.buffer, { name: 'rich' });
    expect(fromArray.ok).toBe(true);
    expect(fromBuffer.ok).toBe(true);
    if (fromArray.ok && fromBuffer.ok) expect(fromBuffer.document).toEqual(fromArray.document);
  });

  it('reads a weighted vertex stream back into the shared self-delimiting layout', () => {
    const model: SkelModel = {
      version: '4.2.33',
      bones: [{ name: 'root' }, { name: 'b1', parent: 'root' }],
      slots: [{ name: 's', bone: 'root', attachment: 'm' }],
      skins: [
        {
          name: 'default',
          slots: [
            {
              slot: 's',
              attachments: [
                {
                  placeholder: 'm',
                  type: 'mesh',
                  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
                  triangles: [0, 1, 2, 0, 2, 3],
                  // 4 logical vertices, each a single bone-0 influence: [count=1, boneIndex, bx, by, weight]
                  vertices: [1, 0, 0, 0, 1, 1, 0, 64, 0, 1, 1, 0, 64, 64, 1, 1, 0, 0, 64, 1],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = importSpineSkel(encodeSkel(model), { name: 'w' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attachment = result.document.skins[0]?.attachments['s']?.['m'];
    expect(attachment?.type).toBe('mesh');
    if (attachment?.type === 'mesh') expect(attachment.bones).toEqual([0]);
  });
});
