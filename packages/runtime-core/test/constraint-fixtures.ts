import type {
  Animation,
  Bone,
  CurveType,
  IkConstraint,
  IkFrame,
  Keyframe,
  MeshAttachment,
  SkeletonDocument,
  Skin,
  Slot,
  TransformConstraint,
  TransformFrame,
} from '@marionette/format/types';
import { bone, slot } from './anim-fixtures';

// In-test builders for the WP-2.x constraint + mesh-sampling suites. They produce COMPLETE, type-
// faithful SkeletonDocuments (every Phase-2 field present, empty when unused) so buildPose reads real
// arrays and the fixtures mirror what the validator/migration emit. Drafts (hash '') skip the semantic
// validator, like anim-fixtures.ts.
export { bone, slot };

export function ikConstraint(
  name: string,
  bones: string[],
  target: string,
  mix: number,
  bendPositive: boolean,
): IkConstraint {
  // The format carries the signed `bend` (ADR-0009) plus the no-op depth defaults; the boolean param is
  // preserved for test ergonomics and maps to the sign losslessly (true -> +1, false -> -1).
  return {
    name,
    bones,
    target,
    mix,
    bend: bendPositive ? 1 : -1,
    softness: 0,
    stretch: false,
    compress: false,
    uniform: false,
  };
}

export function transformConstraint(
  name: string,
  bones: string[],
  target: string,
  overrides: Partial<Omit<TransformConstraint, 'name' | 'bones' | 'target'>> = {},
): TransformConstraint {
  return {
    name,
    bones,
    target,
    mixRotate: 0,
    mixX: 0,
    mixY: 0,
    mixScaleX: 0,
    mixScaleY: 0,
    mixShearY: 0,
    offsetRotation: 0,
    offsetX: 0,
    offsetY: 0,
    offsetScaleX: 0,
    offsetScaleY: 0,
    offsetShearY: 0,
    local: false,
    relative: false,
    ...overrides,
  };
}

export function ikKey(
  time: number,
  mix: number,
  bendPositive: boolean,
  curve: CurveType = 'linear',
): Keyframe<IkFrame> {
  return { time, value: { mix, bend: bendPositive ? 1 : -1 }, curve };
}

export function transformKey(
  time: number,
  value: TransformFrame,
  curve: CurveType = 'linear',
): Keyframe<TransformFrame> {
  return { time, value, curve };
}

export function deformKey(
  time: number,
  offsets: number[],
  curve: CurveType = 'linear',
): Keyframe<{ offsets: number[] }> {
  return { time, value: { offsets }, curve };
}

// A complete Animation with all five timeline records present (empty unless supplied), the shape a
// validated/migrated document carries.
export interface AnimParts {
  readonly duration?: number;
  readonly bones?: Animation['bones'];
  readonly slots?: Animation['slots'];
  readonly ik?: Animation['ik'];
  readonly transform?: Animation['transform'];
  readonly deform?: Animation['deform'];
}

export function anim(parts: AnimParts = {}): Animation {
  return {
    duration: parts.duration ?? 1,
    bones: parts.bones ?? {},
    slots: parts.slots ?? {},
    ik: parts.ik ?? {},
    transform: parts.transform ?? {},
    deform: parts.deform ?? {},
  };
}

export function meshAttachment(overrides: Partial<MeshAttachment> = {}): MeshAttachment {
  return {
    type: 'mesh',
    path: 'm',
    uvs: [],
    triangles: [],
    hullLength: 0,
    width: 0,
    height: 0,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [],
    ...overrides,
  };
}

export interface FullDocParts {
  readonly name?: string;
  readonly bones: readonly Bone[];
  readonly slots?: readonly Slot[];
  readonly skins?: readonly Skin[];
  readonly ikConstraints?: readonly IkConstraint[];
  readonly transformConstraints?: readonly TransformConstraint[];
  readonly animations?: Readonly<Record<string, Animation>>;
}

export function fullDoc(parts: FullDocParts): SkeletonDocument {
  return {
    formatVersion: '0.2.0',
    name: parts.name ?? 'constraint-test',
    hash: '',
    bones: [...parts.bones],
    slots: parts.slots ? [...parts.slots] : [],
    skins: parts.skins ? [...parts.skins] : [{ name: 'default', attachments: {} }],
    ikConstraints: parts.ikConstraints ? [...parts.ikConstraints] : [],
    transformConstraints: parts.transformConstraints ? [...parts.transformConstraints] : [],
    animations: { ...(parts.animations ?? {}) },
    atlas: { pages: [] },
  };
}
