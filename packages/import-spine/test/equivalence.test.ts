import { describe, expect, it } from 'vitest';
import { importSpineJson, importSpineSkel } from '../src/index';
import { encodeSkel, type SkelModel } from './fixtures/skel-encoder';

// JSON/binary equivalence (PP-A5 slice 2): the .skel binary reader decodes into the SAME intermediate the
// JSON path builds, so equivalent logical content produces DEEP-EQUAL documents (and identical warnings).
// Every buffer is hand-authored from the published binary format spec via the test encoder, never a real
// export (clean-room, LAW 4 / PP-A5). Field values are chosen to be exactly representable in a 32-bit
// float (integers and halves/quarters), because the binary format stores floats as float32 while JSON
// keeps doubles; a value like 0.8 would round differently between the two paths and is out of scope here.

interface Pair {
  readonly name: string;
  readonly json: unknown;
  readonly model: SkelModel;
}

// Pair 1: bones + a tinted region slot + a curved bone-rotate animation (linear, stepped, linear).
const minimalPair: Pair = {
  name: 'minimal region + rotate',
  json: {
    skeleton: { spine: '4.1.24', fps: 30, images: './images/' },
    bones: [{ name: 'root' }, { name: 'bone1', parent: 'root', x: 50, rotation: 30 }],
    slots: [
      { name: 'slot1', bone: 'bone1', color: 'ff8800ff', attachment: 'region1', blend: 'additive' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          slot1: { region1: { type: 'region', width: 64, height: 64, x: 1, y: 2, rotation: 5 } },
        },
      },
    ],
    animations: {
      idle: {
        bones: {
          bone1: {
            rotate: [
              { time: 0, angle: 0 },
              { time: 0.5, angle: 45, curve: 'stepped' },
              { time: 1, angle: 90 },
            ],
          },
        },
      },
    },
  },
  model: {
    version: '4.1.24',
    nonessential: true,
    fps: 30,
    images: './images/',
    bones: [{ name: 'root' }, { name: 'bone1', parent: 'root', x: 50, rotation: 30 }],
    slots: [{ name: 'slot1', bone: 'bone1', color: 'ff8800ff', attachment: 'region1', blend: 1 }],
    skins: [
      {
        name: 'default',
        slots: [
          {
            slot: 'slot1',
            attachments: [
              {
                placeholder: 'region1',
                type: 'region',
                width: 64,
                height: 64,
                x: 1,
                y: 2,
                rotation: 5,
              },
            ],
          },
        ],
      },
    ],
    animations: [
      {
        name: 'idle',
        bones: [
          {
            bone: 'bone1',
            rotate: [
              { time: 0, angle: 0 },
              { time: 0.5, angle: 45, curve: 'stepped' },
              { time: 1, angle: 90 },
            ],
          },
        ],
      },
    ],
  },
};

// Pair 2: IK + transform + path constraints (dense order 0/1/2) with their animation timelines. The path
// mix timeline keys both rotate and translate mix, matching the format's independent path mix channels.
const constraintsPair: Pair = {
  name: 'ik + transform + path constraints',
  json: {
    skeleton: { spine: '4.1.24' },
    bones: [
      { name: 'root' },
      { name: 'bone1', parent: 'root' },
      { name: 'bone2', parent: 'bone1', x: 30 },
      { name: 'target', parent: 'root', x: 60 },
      { name: 'follower', parent: 'root' },
      { name: 'pathbone', parent: 'root' },
    ],
    slots: [
      { name: 'slot1', bone: 'bone1', attachment: 'region1' },
      { name: 'pathslot', bone: 'root', attachment: 'path1' },
    ],
    ik: [
      {
        name: 'ik1',
        order: 0,
        bones: ['bone1', 'bone2'],
        target: 'target',
        mix: 1,
        bendPositive: false,
        softness: 5,
        stretch: true,
      },
    ],
    transform: [
      {
        name: 'tc1',
        order: 1,
        bones: ['follower'],
        target: 'bone1',
        rotateMix: 1,
        translateMix: 0.5,
        scaleMix: 0.25,
        shearMix: 0,
        rotation: 10,
        x: 5,
      },
    ],
    path: [
      {
        name: 'pc1',
        order: 2,
        bones: ['pathbone'],
        target: 'pathslot',
        positionMode: 'percent',
        spacingMode: 'length',
        rotateMode: 'chain scale',
        position: 0,
        spacing: 0,
        rotateMix: 1,
        translateMix: 1,
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          slot1: { region1: { type: 'region', width: 32, height: 32 } },
          pathslot: {
            path1: {
              type: 'path',
              closed: false,
              constantSpeed: true,
              lengths: [30],
              vertexCount: 4,
              vertices: [0, 0, 10, 0, 20, 0, 30, 0],
            },
          },
        },
      },
    ],
    animations: {
      act: {
        ik: {
          ik1: [
            { time: 0, mix: 1, bendPositive: true },
            { time: 1, mix: 0.5, bendPositive: false },
          ],
        },
        transform: {
          tc1: [
            { time: 0, rotateMix: 1, translateMix: 0.5, scaleMix: 0.25, shearMix: 0 },
            { time: 1, rotateMix: 0.5, translateMix: 1, scaleMix: 1, shearMix: 1 },
          ],
        },
        path: {
          pc1: [
            { time: 0, position: 0, rotateMix: 1, translateMix: 1 },
            { time: 1, position: 1 },
          ],
        },
      },
    },
  },
  model: {
    version: '4.1.24',
    bones: [
      { name: 'root' },
      { name: 'bone1', parent: 'root' },
      { name: 'bone2', parent: 'bone1', x: 30 },
      { name: 'target', parent: 'root', x: 60 },
      { name: 'follower', parent: 'root' },
      { name: 'pathbone', parent: 'root' },
    ],
    slots: [
      { name: 'slot1', bone: 'bone1', attachment: 'region1' },
      { name: 'pathslot', bone: 'root', attachment: 'path1' },
    ],
    ik: [
      {
        name: 'ik1',
        order: 0,
        bones: ['bone1', 'bone2'],
        target: 'target',
        mix: 1,
        bendPositive: false,
        softness: 5,
        stretch: true,
      },
    ],
    transform: [
      {
        name: 'tc1',
        order: 1,
        bone: 'follower',
        target: 'bone1',
        rotateMix: 1,
        translateMix: 0.5,
        scaleMix: 0.25,
        shearMix: 0,
        rotation: 10,
        x: 5,
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
        position: 0,
        spacing: 0,
        rotateMix: 1,
        translateMix: 1,
      },
    ],
    skins: [
      {
        name: 'default',
        slots: [
          {
            slot: 'slot1',
            attachments: [{ placeholder: 'region1', type: 'region', width: 32, height: 32 }],
          },
          {
            slot: 'pathslot',
            attachments: [
              {
                placeholder: 'path1',
                type: 'path',
                closed: false,
                constantSpeed: true,
                lengths: [30],
                vertexCount: 4,
                vertices: [0, 0, 10, 0, 20, 0, 30, 0],
              },
            ],
          },
        ],
      },
    ],
    animations: [
      {
        name: 'act',
        ik: [
          {
            ik: 'ik1',
            frames: [
              { time: 0, mix: 1, bendPositive: true },
              { time: 1, mix: 0.5, bendPositive: false },
            ],
          },
        ],
        transform: [
          {
            transform: 'tc1',
            frames: [
              { time: 0, rotateMix: 1, translateMix: 0.5, scaleMix: 0.25, shearMix: 0 },
              { time: 1, rotateMix: 0.5, translateMix: 1, scaleMix: 1, shearMix: 1 },
            ],
          },
        ],
        path: [
          {
            path: 'pc1',
            position: [
              { time: 0, value: 0 },
              { time: 1, value: 1 },
            ],
            mix: [{ time: 0, rotateMix: 1, translateMix: 1 }],
          },
        ],
      },
    ],
  },
};

// Pair 3: a weighted mesh (two-bone influence), a deform timeline, a two-color slot timeline on a slot
// with a setup dark color, an event definition + key, and a draw-order timeline (surfaced as a warning).
const weightedDeformPair: Pair = {
  name: 'weighted mesh + deform + two-color + draworder warning',
  json: {
    skeleton: { spine: '4.2.33' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 50 }],
    slots: [
      { name: 'meshslot', bone: 'root', color: 'ffffffff', dark: '333333', attachment: 'mesh1' },
    ],
    events: { step: { int: 1 } },
    skins: [
      {
        name: 'default',
        attachments: {
          meshslot: {
            mesh1: {
              type: 'mesh',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              vertices: [
                2, 0, 0, 0, 0.5, 1, -50, 0, 0.5, 2, 0, 64, 0, 0.5, 1, 14, 0, 0.5, 2, 0, 64, 64, 0.5,
                1, 14, 64, 0.5, 2, 0, 0, 64, 0.5, 1, -50, 64, 0.5,
              ],
              hull: 4,
            },
          },
        },
      },
    ],
    animations: {
      wobble: {
        slots: {
          meshslot: {
            twoColor: [
              { time: 0, light: 'ffffffff', dark: '000000ff' },
              { time: 0.5, light: 'ff0000ff', dark: '111111ff' },
            ],
          },
        },
        deform: {
          default: {
            meshslot: {
              mesh1: [
                { time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] },
                { time: 0.5, offset: 2, vertices: [3, -3] },
              ],
            },
          },
        },
        events: [{ time: 1, name: 'step', int: 5 }],
        draworder: [{ time: 0.5, offsets: [{ slot: 'meshslot', offset: 1 }] }],
      },
    },
  },
  model: {
    version: '4.2.33',
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 50 }],
    slots: [
      { name: 'meshslot', bone: 'root', color: 'ffffffff', dark: '333333', attachment: 'mesh1' },
    ],
    events: [{ name: 'step', int: 1 }],
    skins: [
      {
        name: 'default',
        slots: [
          {
            slot: 'meshslot',
            attachments: [
              {
                placeholder: 'mesh1',
                type: 'mesh',
                uvs: [0, 0, 1, 0, 1, 1, 0, 1],
                triangles: [0, 1, 2, 0, 2, 3],
                vertices: [
                  2, 0, 0, 0, 0.5, 1, -50, 0, 0.5, 2, 0, 64, 0, 0.5, 1, 14, 0, 0.5, 2, 0, 64, 64,
                  0.5, 1, 14, 64, 0.5, 2, 0, 0, 64, 0.5, 1, -50, 64, 0.5,
                ],
                hull: 4,
              },
            ],
          },
        ],
      },
    ],
    animations: [
      {
        name: 'wobble',
        slots: [
          {
            slot: 'meshslot',
            twoColor: [
              { time: 0, light: 'ffffffff', dark: '000000' },
              { time: 0.5, light: 'ff0000ff', dark: '111111' },
            ],
          },
        ],
        deform: [
          {
            skin: 'default',
            slot: 'meshslot',
            attachment: 'mesh1',
            frames: [
              { time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] },
              { time: 0.5, offset: 2, vertices: [3, -3] },
            ],
          },
        ],
        events: [{ time: 1, event: 'step', int: 5 }],
        draworder: [{ time: 0.5, changes: [{ slot: 'meshslot', amount: 1 }] }],
      },
    ],
  },
};

describe.each([minimalPair, constraintsPair, weightedDeformPair])(
  'JSON/binary equivalence: $name',
  (pair) => {
    it('produces a deep-equal validated document from JSON and from .skel', () => {
      const fromJson = importSpineJson(pair.json, { name: 'shared' });
      const fromSkel = importSpineSkel(encodeSkel(pair.model), { name: 'shared' });

      expect(fromJson.ok).toBe(true);
      expect(fromSkel.ok).toBe(true);
      if (!fromJson.ok || !fromSkel.ok) return;

      expect(fromSkel.document).toEqual(fromJson.document);
    });

    it('produces identical warnings from JSON and from .skel', () => {
      const fromJson = importSpineJson(pair.json, { name: 'shared' });
      const fromSkel = importSpineSkel(encodeSkel(pair.model), { name: 'shared' });
      expect(fromSkel.warnings).toEqual(fromJson.warnings);
    });
  },
);
