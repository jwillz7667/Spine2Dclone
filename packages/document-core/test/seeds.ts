import type {
  Animation,
  AtlasRegion,
  Bone,
  MeshAttachment,
  RegionAttachment,
  SkeletonDocument,
  Slot,
} from '@marionette/format/types';
import { makeIdFactory, type DocumentEnvironment } from '../src';

// In-memory format seed documents for the round-trip harness and command tests. They are valid
// SkeletonDocuments (default skin present, bones >= 1) carried as drafts (hash ''), so loadDocument
// accepts them with verifyHash off. They stand in for the packages/format golden fixtures without
// coupling the document-core tests to that package's test files.
function bone(name: string, parent: string | null, overrides: Partial<Bone> = {}): Bone {
  return {
    name,
    parent,
    length: 100,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
    ...overrides,
  };
}

function slot(name: string, boneName: string, overrides: Partial<Slot> = {}): Slot {
  return {
    name,
    bone: boneName,
    color: { r: 1, g: 1, b: 1, a: 1 },
    attachment: null,
    blendMode: 'normal',
    ...overrides,
  };
}

function region(path: string): RegionAttachment {
  return {
    type: 'region',
    path,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
  };
}

// A valid UNWEIGHTED mesh attachment: a 4-corner quad hull (hullLength 4) plus one interior center
// vertex (5 vertices total), fan-triangulated, with flat [x,y,...] vertices and no `bones` (unweighted)
// and no `edges`. This is the WP-2.1 mesh-edit seed: every mesh command can target it (add/delete change
// the interior vertex; delete returns it to the 4-corner quad).
function mesh(path: string): MeshAttachment {
  return {
    type: 'mesh',
    path,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
    triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    hullLength: 4,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
  };
}

function atlasRegion(name: string): AtlasRegion {
  return {
    name,
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  };
}

interface DocBody {
  readonly slots?: Slot[];
  readonly skins?: SkeletonDocument['skins'];
  readonly atlas?: SkeletonDocument['atlas'];
  readonly animations?: Record<string, Animation>;
}

function doc(name: string, bones: Bone[], body: DocBody = {}): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name,
    hash: '',
    bones,
    slots: body.slots ?? [],
    skins: body.skins ?? [{ name: 'default', attachments: {} }],
    animations: body.animations ?? {},
    atlas: body.atlas ?? { pages: [] },
  };
}

// A single idle animation exercising every authored channel across the seed's bone and slot: a bezier-
// eased rotate, a translate, and a slot color tint, in strict time order within [0, duration]. It makes
// every WP-1.5 animation/keyframe command applicable with a real delta and lets DeleteBone/DeleteSlot
// exercise the animation-track prune cascade.
const idleAnimation: Animation = {
  duration: 1,
  bones: {
    root: {
      rotate: [
        { time: 0, value: { angle: 0 }, curve: 'linear' },
        {
          time: 0.5,
          value: { angle: 30 },
          curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
        },
        { time: 1, value: { angle: 0 }, curve: 'linear' },
      ],
      translate: [
        { time: 0, value: { x: 0, y: 0 }, curve: 'linear' },
        { time: 1, value: { x: 10, y: 0 }, curve: 'stepped' },
      ],
    },
  },
  slots: {
    body: {
      color: [
        { time: 0, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' },
        { time: 1, value: { color: { r: 1, g: 0, b: 0, a: 1 } }, curve: 'linear' },
      ],
    },
  },
};

export const seeds = {
  // One root bone (normalized rotation), the common seed.
  minimal: doc('minimal', [bone('root', null)]),
  // A parent plus child, so DeleteBone exercises the subtree cascade.
  rig: doc('rig', [bone('root', null), bone('child', 'root', { x: 100 })]),
  // A bone with an out-of-range rotation, so NormalizeBoneRotation produces a real delta.
  rotated: doc('rotated', [bone('root', null, { rotation: 270 })]),
  // Two bones, two slots (one carrying a region attachment whose name differs from its atlas path),
  // and two atlas regions. This is the slot/attachment seed: it makes every WP-1.2 command applicable
  // with a real delta and lets DeleteBone exercise the slot + attachment cascade.
  slotted: doc('slotted', [bone('root', null), bone('arm', 'root', { x: 50 })], {
    slots: [slot('body', 'root', { attachment: 'body' }), slot('hand', 'arm')],
    skins: [{ name: 'default', attachments: { body: { body: region('skin_body') } } }],
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_body'), atlasRegion('skin_hand')],
        },
      ],
    },
  }),
  // One bone, one slot, and one idle animation with keyframes across channels (incl. a bezier). The
  // WP-1.5 animation/keyframe seed: every keyframe command is applicable here with a real delta.
  animated: doc('animated', [bone('root', null)], {
    slots: [slot('body', 'root')],
    animations: { idle: idleAnimation },
  }),
  // Two bones, a region attachment ('body') for GenerateMeshFromRegion to target, and an UNWEIGHTED mesh
  // attachment ('panel' on 'mesh_slot', its active setup attachment) for the WP-2.1 mesh-edit commands.
  // The atlas carries both referenced regions (every region/mesh path must resolve, ATTACHMENT_REGION_
  // MISSING). This makes every WP-2.1 command applicable here with a real delta.
  meshed: doc('meshed', [bone('root', null), bone('arm', 'root', { x: 50 })], {
    slots: [
      slot('body', 'root', { attachment: 'body' }),
      slot('mesh_slot', 'arm', { attachment: 'panel' }),
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: { body: region('skin_body') },
          mesh_slot: { panel: mesh('skin_panel') },
        },
      },
    ],
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_body'), atlasRegion('skin_panel')],
        },
      ],
    },
  }),
} as const;

export interface Seed {
  readonly id: string;
  readonly json: SkeletonDocument;
}

export const seedList: readonly Seed[] = [
  { id: 'minimal', json: seeds.minimal },
  { id: 'rig', json: seeds.rig },
  { id: 'rotated', json: seeds.rotated },
  { id: 'slotted', json: seeds.slotted },
  { id: 'animated', json: seeds.animated },
  { id: 'meshed', json: seeds.meshed },
];

// A deterministic test environment: a controllable fake clock (so coalescing-window tests are
// reproducible) and a fresh monotonic IdFactory per loaded Document. No performance.now anywhere.
export interface TestEnv {
  readonly env: DocumentEnvironment;
  setNow(ms: number): void;
  advance(ms: number): void;
}

export function makeTestEnv(start = 0): TestEnv {
  let now = start;
  return {
    env: { now: () => now, createIds: makeIdFactory },
    setNow: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
