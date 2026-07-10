import type {
  AnimationEntity,
  BoneChannel,
  KeyframeEntity,
  KeyframeId,
  KeyframeTarget,
  KeyframeValue,
} from '../document';
import type { CurveType } from '@marionette/format/types';
import type { TrackNames } from './tracks';

// The value-graph channel model (PP-D3): the dopesheet's interpolated VALUE channels projected into flat
// SCALAR lanes so each can be drawn as a value-vs-time curve. Only the value channels (ChannelRow in
// tracks.ts: a KeyframeTarget plus a curved scalar value) are projected here; the opaque timeline rows
// (attachment/sequence/deform/ik/transform/path/physics) carry no interpolated scalar and are out of scope
// for the graph, matching how the dopesheet already separates the two. No React, no DOM, no PixiJS: these
// are the unit-tested pure transforms the graph panel renders over. The load-bearing piece is the
// value<->KeyframeValue mapping (writeComponent preserves the untouched components of a multi-field value,
// so a single-axis drag never disturbs the others).

// A scalar component accessor keyed on the VALUE SHAPE (not the channel), since several channels share a
// shape: rotate is a lone angle, translate/scale/shear are a vec2, the split bone components are a lone
// scalar, color/dark are an RGBA, the split rgb track is an RGB triple, and the split alpha track is a lone
// alpha. `shape` is the discriminant the read/write pair switches on; the members' keys are disjoint
// (angle/x/value/color/rgb/alpha), so a KeyframeValue narrows with `in`, no tag and no `as`.
export type ComponentField =
  | { readonly shape: 'rotate' }
  | { readonly shape: 'vec2'; readonly axis: 'x' | 'y' }
  | { readonly shape: 'scalar' }
  | { readonly shape: 'color'; readonly axis: 'r' | 'g' | 'b' | 'a' }
  | { readonly shape: 'rgb'; readonly axis: 'r' | 'g' | 'b' }
  | { readonly shape: 'alpha' };

// One keyframe projected onto a single scalar lane: the branded id (so an insert/delete elsewhere never
// invalidates it), its time, the scalar read out of the channel value, and the outgoing curve.
export interface ValueKey {
  readonly id: KeyframeId;
  readonly time: number;
  readonly value: number;
  readonly curve: CurveType;
}

// A drawable scalar lane: a stable key, the owning entity's display name (group), an axis-qualified label,
// an overlay color, the KeyframeTarget the channel writes through, the component the lane reads/writes, and
// the lane's keyframes in ascending time. `key` is stable across revisions (built from branded ids plus the
// axis), so per-lane visibility survives renames and reorders. Two lanes of the same vec2 channel share one
// KeyframeTarget and the same KeyframeId per key (a translate key shows a dot on both the X and the Y lane).
export interface ValueLane {
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly color: number;
  readonly target: KeyframeTarget;
  readonly field: ComponentField;
  readonly keys: readonly ValueKey[];
}

// The ten bone channels in the dopesheet's row order: the four joint channels then the six Stage F2 split
// components (ADR-0009 section 4.1). A bone keys a joint OR its split components, never both, so at most one
// form per transform group is non-empty.
const BONE_CHANNELS: readonly BoneChannel[] = [
  'rotate',
  'translate',
  'scale',
  'shear',
  'translateX',
  'translateY',
  'scaleX',
  'scaleY',
  'shearX',
  'shearY',
];

// Per-lane overlay colors (0xRRGGBB), keyed by a semantic axis: X-family red, Y-family green, rotation and
// the blue channel blue, alpha a neutral grey. scale/shear reuse the x/y hues (disambiguated by the label
// and per-lane visibility), matching how a value graph reads at a glance.
const AXIS_RED = 0xf28b82;
const AXIS_GREEN = 0x81c995;
const AXIS_BLUE = 0x8ab4f8;
const AXIS_GREY = 0xc8c8c8;

// Read the scalar component of a channel value. The value shape matches its lane's field by construction, so
// the `in` narrowing is exact and needs no cast; a mismatch (never produced by the command layer) reads as 0
// rather than throwing, keeping the projection total.
export function readComponent(value: KeyframeValue, field: ComponentField): number {
  switch (field.shape) {
    case 'rotate':
      return 'angle' in value ? value.angle : 0;
    case 'vec2':
      if (!('x' in value)) return 0;
      return field.axis === 'x' ? value.x : value.y;
    case 'scalar':
      return 'value' in value ? value.value : 0;
    case 'color':
      return 'color' in value ? value.color[field.axis] : 0;
    case 'rgb':
      return 'rgb' in value ? value.rgb[field.axis] : 0;
    case 'alpha':
      return 'alpha' in value ? value.alpha : 0;
  }
}

// Produce a NEW KeyframeValue with `field`'s scalar set to `scalar`, preserving every other component of
// `prev`. This is what lets a value-graph drag change one axis (via SetKeyframe at the key's own time)
// without perturbing the rest of a vec2, an rgba, or an rgb: the untouched fields are copied straight from
// prev. prev matches the shape by construction; a mismatch falls back to sensible zeros so the result stays
// a valid value of the target shape.
export function writeComponent(
  prev: KeyframeValue,
  field: ComponentField,
  scalar: number,
): KeyframeValue {
  switch (field.shape) {
    case 'rotate':
      return { angle: scalar };
    case 'scalar':
      return { value: scalar };
    case 'alpha':
      return { alpha: scalar };
    case 'vec2': {
      const x = 'x' in prev ? prev.x : 0;
      const y = 'x' in prev ? prev.y : 0;
      return field.axis === 'x' ? { x: scalar, y } : { x, y: scalar };
    }
    case 'color': {
      const base = 'color' in prev ? prev.color : { r: 0, g: 0, b: 0, a: 1 };
      return { color: { ...base, [field.axis]: scalar } };
    }
    case 'rgb': {
      const base = 'rgb' in prev ? prev.rgb : { r: 0, g: 0, b: 0 };
      return { rgb: { ...base, [field.axis]: scalar } };
    }
  }
}

interface LaneSpec {
  readonly axisKey: string; // stable per-lane suffix and color key
  readonly labelSuffix: string; // axis-qualified suffix appended to the channel label
  readonly color: number;
  readonly field: ComponentField;
}

const VEC2_AXES: readonly LaneSpec[] = [
  { axisKey: 'x', labelSuffix: ' X', color: AXIS_RED, field: { shape: 'vec2', axis: 'x' } },
  { axisKey: 'y', labelSuffix: ' Y', color: AXIS_GREEN, field: { shape: 'vec2', axis: 'y' } },
];

// The lane specs for a bone channel: rotate is one angle lane, the joint vec2 channels are an X and a Y
// lane, and each split component channel is a single scalar lane colored by its implied axis.
function boneLaneSpecs(channel: BoneChannel): { label: string; specs: readonly LaneSpec[] } {
  switch (channel) {
    case 'rotate':
      return {
        label: 'Rotate',
        specs: [
          { axisKey: 'angle', labelSuffix: '', color: AXIS_BLUE, field: { shape: 'rotate' } },
        ],
      };
    case 'translate':
      return { label: 'Translate', specs: VEC2_AXES };
    case 'scale':
      return { label: 'Scale', specs: VEC2_AXES };
    case 'shear':
      return { label: 'Shear', specs: VEC2_AXES };
    case 'translateX':
      return { label: 'Translate X', specs: [scalarSpec(AXIS_RED)] };
    case 'translateY':
      return { label: 'Translate Y', specs: [scalarSpec(AXIS_GREEN)] };
    case 'scaleX':
      return { label: 'Scale X', specs: [scalarSpec(AXIS_RED)] };
    case 'scaleY':
      return { label: 'Scale Y', specs: [scalarSpec(AXIS_GREEN)] };
    case 'shearX':
      return { label: 'Shear X', specs: [scalarSpec(AXIS_RED)] };
    case 'shearY':
      return { label: 'Shear Y', specs: [scalarSpec(AXIS_GREEN)] };
  }
}

function scalarSpec(color: number): LaneSpec {
  return { axisKey: 'value', labelSuffix: '', color, field: { shape: 'scalar' } };
}

// The lane specs for a slot value channel. `color`/`dark` are an RGBA (dark keys only r/g/b, its alpha is
// carried but not authored here); `rgb` is an RGB triple; `alpha` is a lone alpha.
function slotLaneSpecs(channel: 'color' | 'dark' | 'rgb' | 'alpha'): {
  label: string;
  specs: readonly LaneSpec[];
} {
  if (channel === 'alpha') {
    return {
      label: 'Alpha',
      specs: [{ axisKey: 'a', labelSuffix: '', color: AXIS_GREY, field: { shape: 'alpha' } }],
    };
  }
  if (channel === 'rgb') {
    return {
      label: 'RGB',
      specs: [
        colorSpec('r', AXIS_RED, { shape: 'rgb', axis: 'r' }),
        colorSpec('g', AXIS_GREEN, { shape: 'rgb', axis: 'g' }),
        colorSpec('b', AXIS_BLUE, { shape: 'rgb', axis: 'b' }),
      ],
    };
  }
  const label = channel === 'dark' ? 'Dark' : 'Color';
  const rgba: readonly LaneSpec[] = [
    colorSpec('r', AXIS_RED, { shape: 'color', axis: 'r' }),
    colorSpec('g', AXIS_GREEN, { shape: 'color', axis: 'g' }),
    colorSpec('b', AXIS_BLUE, { shape: 'color', axis: 'b' }),
  ];
  // The joint color track keys alpha too; the dark two-color tint does not.
  const specs =
    channel === 'color'
      ? [...rgba, colorSpec('a', AXIS_GREY, { shape: 'color', axis: 'a' })]
      : rgba;
  return { label, specs };
}

function colorSpec(axisKey: string, color: number, field: ComponentField): LaneSpec {
  return { axisKey, labelSuffix: ` ${axisKey.toUpperCase()}`, color, field };
}

function projectKeys(keys: readonly KeyframeEntity[], field: ComponentField): ValueKey[] {
  return keys.map((kf) => ({
    id: kf.id,
    time: kf.time,
    value: readComponent(kf.value, field),
    curve: kf.curve,
  }));
}

function compareLabel(aName: string, aId: string, bName: string, bId: string): number {
  if (aName !== bName) return aName < bName ? -1 : 1;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

// Project an animation's interpolated value channels into flat scalar lanes, in the SAME stable order the
// dopesheet track tree uses (bones then slots, each sorted by resolved name with the branded id as a
// tiebreak) so the graph rows and the dopesheet rows never disagree. Empty channels and entities with no
// value keyframes are omitted.
export function buildValueLanes(animation: AnimationEntity, names: TrackNames): ValueLane[] {
  const lanes: ValueLane[] = [];

  const boneGroups = [...animation.bones.entries()]
    .map(([boneId, set]) => ({ boneId, set, name: names.boneName(boneId) }))
    .sort((a, b) => compareLabel(a.name, a.boneId, b.name, b.boneId));
  for (const { boneId, set, name } of boneGroups) {
    for (const channel of BONE_CHANNELS) {
      const keys = set[channel];
      if (keys.length === 0) continue;
      const target: KeyframeTarget = { kind: 'bone', boneId, channel };
      const { label, specs } = boneLaneSpecs(channel);
      for (const spec of specs) {
        lanes.push({
          key: `bone:${boneId}:${channel}:${spec.axisKey}`,
          group: name,
          label: `${label}${spec.labelSuffix}`,
          color: spec.color,
          target,
          field: spec.field,
          keys: projectKeys(keys, spec.field),
        });
      }
    }
  }

  const slotGroups = [...animation.slots.entries()]
    .map(([slotId, set]) => ({ slotId, set, name: names.slotName(slotId) }))
    .sort((a, b) => compareLabel(a.name, a.slotId, b.name, b.slotId));
  for (const { slotId, set, name } of slotGroups) {
    for (const channel of ['color', 'dark', 'rgb', 'alpha'] as const) {
      const keys = set[channel];
      if (keys.length === 0) continue;
      const target: KeyframeTarget = { kind: 'slot', slotId, channel };
      const { label, specs } = slotLaneSpecs(channel);
      for (const spec of specs) {
        lanes.push({
          key: `slot:${slotId}:${channel}:${spec.axisKey}`,
          group: name,
          label: `${label}${spec.labelSuffix}`,
          color: spec.color,
          target,
          field: spec.field,
          keys: projectKeys(keys, spec.field),
        });
      }
    }
  }

  return lanes;
}

// The exhaustive value extent across a set of lanes (for vertical framing). Returns null when no lane has a
// key, so the caller can fall back to a default value window.
export function laneValueExtent(lanes: readonly ValueLane[]): readonly [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const lane of lanes) {
    for (const key of lane.keys) {
      if (key.value < min) min = key.value;
      if (key.value > max) max = key.value;
    }
  }
  return min <= max ? [min, max] : null;
}

// The exhaustive time extent across a set of lanes (for horizontal framing). Returns null when no lane has a
// key.
export function laneTimeExtent(lanes: readonly ValueLane[]): readonly [number, number] | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const lane of lanes) {
    for (const key of lane.keys) {
      if (key.time < min) min = key.time;
      if (key.time > max) max = key.time;
    }
  }
  return min <= max ? [min, max] : null;
}
