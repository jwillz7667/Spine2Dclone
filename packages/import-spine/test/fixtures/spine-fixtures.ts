// Hand-authored Spine 4.x JSON fixtures. These are written BY HAND from the PUBLISHED Spine JSON format
// documentation (esotericsoftware.com/spine-json-format), never downloaded or exported from Spine, per
// the clean-room legal posture (PP-A5 / LAW 4). Each is typed `unknown` because that is exactly how the
// importer receives a parsed file at its boundary. Field names and defaults match the published
// documentation; every positive fixture is designed to convert AND pass validateDocument.

// A minimal skeleton: two bones, one slot, one region attachment, one bone rotate animation exercising
// the three curve encodings (linear, stepped, and a flat-form bezier).
export const minimalFixture: unknown = {
  skeleton: { hash: 'AAAA', spine: '4.1.24', images: './images/', fps: 30 },
  bones: [{ name: 'root' }, { name: 'bone1', parent: 'root', x: 50, rotation: 30 }],
  slots: [{ name: 'slot1', bone: 'bone1', attachment: 'region1' }],
  skins: [
    {
      name: 'default',
      attachments: {
        slot1: { region1: { type: 'region', width: 64, height: 64 } },
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
            { time: 1, angle: 90, curve: 0.25, c2: 0, c3: 0.75, c4: 1 },
          ],
        },
      },
    },
  },
};

// A weighted mesh bound to two bones, plus a deform timeline. Weights sum to exactly 1. The deform key
// uses Spine's offset + vertices form; the importer pads it to the full 2 * V offsets array.
export const weightedMeshFixture: unknown = {
  skeleton: { spine: '4.2.33' },
  bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 50 }],
  slots: [{ name: 'meshslot', bone: 'root', attachment: 'mesh1' }],
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
            width: 64,
            height: 64,
          },
        },
      },
    },
  ],
  animations: {
    wobble: {
      deform: {
        default: {
          meshslot: {
            mesh1: [
              { time: 0, offset: 0, vertices: [0, 0, 0, 0, 0, 0, 0, 0] },
              { time: 0.5, offset: 2, vertices: [3, -3], curve: 'stepped' },
            ],
          },
        },
      },
    },
  },
};

// IK (two-bone), transform, and path constraints, each with an explicit dense solve order (0, 1, 2), plus
// their animation timelines. The path constraint targets a slot that carries an open cubic path.
export const constraintsFixture: unknown = {
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
  animations: {
    act: {
      ik: {
        ik1: [
          { time: 0, mix: 1, bendPositive: true },
          { time: 1, mix: 0.5, bendPositive: false },
        ],
      },
      transform: { tc1: [{ time: 0, rotateMix: 1, translateMix: 0.5 }] },
      path: {
        pc1: [
          { time: 0, position: 0, rotateMix: 1 },
          { time: 1, position: 1 },
        ],
      },
    },
  },
};

// A named variant skin that scopes bones and constraints, a linked mesh reusing a parent mesh, and a
// two-color (dark tint) animation on a slot that carries a setup dark color.
export const skinScopedFixture: unknown = {
  skeleton: { spine: '4.1.24' },
  bones: [{ name: 'root' }, { name: 'extra', parent: 'root' }],
  slots: [
    { name: 'body', bone: 'root', attachment: 'skinMesh', color: 'ffffffff', dark: '333333' },
  ],
  ik: [{ name: 'scopedIk', bones: ['extra'], target: 'root' }],
  skins: [
    {
      name: 'default',
      attachments: {
        body: {
          skinMesh: {
            type: 'mesh',
            uvs: [0, 0, 1, 0, 1, 1, 0, 1],
            triangles: [0, 1, 2, 0, 2, 3],
            vertices: [0, 0, 64, 0, 64, 64, 0, 64],
            hull: 4,
            width: 64,
            height: 64,
          },
        },
      },
    },
    {
      name: 'blue',
      bones: ['extra'],
      ik: ['scopedIk'],
      attachments: {
        body: {
          skinMesh: {
            type: 'linkedmesh',
            parent: 'skinMesh',
            skin: 'default',
            deform: true,
            width: 64,
            height: 64,
          },
        },
      },
    },
  ],
  animations: {
    tint: {
      slots: {
        body: {
          twoColor: [
            { time: 0, light: 'ffffffff', dark: '000000ff' },
            { time: 1, light: 'ff0000ff', dark: '111111ff', curve: 'stepped' },
          ],
          attachment: [{ time: 0, name: 'skinMesh' }],
        },
      },
    },
  },
};

// A skeleton exercising every UNSUPPORTED path so the importer records a warning (never a silent drop)
// for each: physics constraint + physics timeline, a draw-order timeline, a frame-sequence attachment
// block, a two-color timeline on a slot with no setup dark color (synthesized), and a per-key event
// audio override. It still converts to a VALID document.
export const warningsFixture: unknown = {
  skeleton: { spine: '4.2.33' },
  bones: [{ name: 'root' }, { name: 'b', parent: 'root' }],
  slots: [
    { name: 's1', bone: 'root', attachment: 'r' },
    { name: 's2', bone: 'root' },
  ],
  events: { boom: { int: 2, audio: 'sfx/boom.ogg', volume: 0.8 } },
  physics: [{ name: 'phys1', bone: 'b' }],
  skins: [
    {
      name: 'default',
      attachments: {
        s1: {
          r: {
            type: 'region',
            width: 16,
            height: 16,
            sequence: { count: 4, start: 0, digits: 2, setupIndex: 0 },
          },
        },
      },
    },
  ],
  animations: {
    go: {
      slots: {
        s1: { twoColor: [{ time: 0, light: 'ffffffff', dark: '000000ff' }] },
      },
      events: [{ time: 1, name: 'boom', int: 5, volume: 0.5, balance: 0.2 }],
      draworder: [{ time: 0.5, offsets: [{ slot: 's1', offset: 1 }] }],
      physics: { phys1: [{ time: 0, mix: 1 }] },
    },
  },
};
