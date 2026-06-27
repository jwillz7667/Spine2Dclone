import type {
  Animation,
  Bone,
  CurveType,
  Keyframe,
  RGBA,
  SkeletonDocument,
  Slot,
} from '@marionette/format/types';

// In-test SkeletonDocument builders for the WP-1.4 sampling suite. They are structurally valid (one
// default skin, at least one bone) and carried as drafts (hash ''); buildPose reads only bones and
// slots, so they need not pass the full semantic validator. This mirrors the pattern in
// packages/document-core/test/seeds.ts (inline docs without coupling to the format golden fixtures).

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

export function slot(name: string, boneName: string, overrides: Partial<Slot> = {}): Slot {
  return {
    name,
    bone: boneName,
    color: { r: 1, g: 1, b: 1, a: 1 },
    attachment: null,
    blendMode: 'normal',
    ...overrides,
  };
}

export function rotateKey(
  time: number,
  angle: number,
  curve: CurveType,
): Keyframe<{ angle: number }> {
  return { time, value: { angle }, curve };
}

export function vec2Key(
  time: number,
  x: number,
  y: number,
  curve: CurveType,
): Keyframe<{ x: number; y: number }> {
  return { time, value: { x, y }, curve };
}

export function colorKey(time: number, color: RGBA, curve: CurveType): Keyframe<{ color: RGBA }> {
  return { time, value: { color }, curve };
}

export function attachmentFrame(
  time: number,
  name: string | null,
): { time: number; name: string | null } {
  return { time, name };
}

export interface DocParts {
  readonly name?: string;
  readonly bones: readonly Bone[];
  readonly slots?: readonly Slot[];
  readonly animations?: Readonly<Record<string, Animation>>;
}

export function doc(parts: DocParts): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name: parts.name ?? 'anim-test',
    hash: '',
    bones: [...parts.bones],
    slots: parts.slots ? [...parts.slots] : [],
    skins: [{ name: 'default', attachments: {} }],
    animations: { ...(parts.animations ?? {}) },
    atlas: { pages: [] },
  };
}
