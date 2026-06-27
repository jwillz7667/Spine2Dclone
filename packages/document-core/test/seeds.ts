import type { Bone, SkeletonDocument } from '@marionette/format/types';
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

function doc(name: string, bones: Bone[]): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name,
    hash: '',
    bones,
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: { pages: [] },
  };
}

export const seeds = {
  // One root bone (normalized rotation), the common seed.
  minimal: doc('minimal', [bone('root', null)]),
  // A parent plus child, so DeleteBone exercises the subtree cascade.
  rig: doc('rig', [bone('root', null), bone('child', 'root', { x: 100 })]),
  // A bone with an out-of-range rotation, so NormalizeBoneRotation produces a real delta.
  rotated: doc('rotated', [bone('root', null, { rotation: 270 })]),
} as const;

export interface Seed {
  readonly id: string;
  readonly json: SkeletonDocument;
}

export const seedList: readonly Seed[] = [
  { id: 'minimal', json: seeds.minimal },
  { id: 'rig', json: seeds.rig },
  { id: 'rotated', json: seeds.rotated },
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
