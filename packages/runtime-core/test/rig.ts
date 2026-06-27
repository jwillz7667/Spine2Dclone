import type { Bone, SkeletonDocument } from '@marionette/format/types';
import { MAT2X3_STRIDE } from '../src/math/affine';
import type { Mat2x3, Pose } from '../src';

// A bone with sensible setup defaults (identity transform), overridable per field. Length is a
// positive default so the format shape constraints are satisfied if such a rig is ever validated.
export function bone(name: string, parent: string | null, overrides: Partial<Bone> = {}): Bone {
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

// Wrap an ordered bone list in a type-complete SkeletonDocument (the solve reads only bones).
export function makeRig(bones: Bone[]): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name: 'test-rig',
    hash: '',
    bones,
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: { pages: [] },
  };
}

// Read a solved bone world matrix back as a tuple, by bone name.
export function worldOf(pose: Pose, name: string): Mat2x3 {
  const index = pose.boneNames.indexOf(name);
  const base = index * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}
