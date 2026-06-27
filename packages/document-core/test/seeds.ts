import type {
  AtlasRegion,
  Bone,
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
}

function doc(name: string, bones: Bone[], body: DocBody = {}): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name,
    hash: '',
    bones,
    slots: body.slots ?? [],
    skins: body.skins ?? [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: body.atlas ?? { pages: [] },
  };
}

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
