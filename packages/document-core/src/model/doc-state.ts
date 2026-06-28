import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import type {
  Attachment,
  AtlasRef,
  BlendMode,
  CurveType,
  RGBA,
  Skin,
  TransformMode,
} from '@marionette/format/types';
import type { AnimationId, BoneId, KeyframeId, SlotId } from './ids';

// Internal bone entity (command-history Section 3.1): carries an internal `id` and otherwise mirrors
// the format bone fields BY VALUE. `parent` is an Id reference, not a name, so a rename never cascades.
export interface BoneEntity {
  readonly id: BoneId;
  readonly name: string;
  readonly parent: BoneId | null;
  readonly length: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly shearX: number;
  readonly shearY: number;
  readonly transformMode: TransformMode;
}

// Internal slot entity (command-history Section 3.1): an internal `id` plus the format slot fields BY
// VALUE. CRITICAL: `bone` is a BoneId reference (like BoneEntity.parent), NOT a name, so renaming or
// reordering a bone never breaks a slot. `attachment` is the setup-pose active attachment NAME (a key
// into this slot's attachment map) or null. `darkColor` is null when the slot has a single-color tint
// (the format field is then absent), which is NOT equivalent to black.
export interface SlotEntity {
  readonly id: SlotId;
  readonly name: string;
  readonly bone: BoneId;
  readonly color: RGBA;
  readonly darkColor: RGBA | null;
  readonly attachment: string | null;
  readonly blendMode: BlendMode;
}

// A region attachment in the default skin, mirroring the format RegionAttachment BY VALUE plus its own
// `name` (the attachment map key; the format stores the name as the key, not as a field) and a `kind`
// discriminant. Phase 1 (WP-1.2) authors ONLY region attachments; addressing is by (owning SlotId,
// attachment name), since the command catalog mints no AttachmentId.
export interface RegionAttachmentEntity {
  readonly kind: 'region';
  readonly name: string;
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// An editable mesh attachment in the default skin (WP-2.1), mirroring the format MeshAttachment BY VALUE
// plus its own `name` (the attachment-map key) and a `kind` discriminant. `vertices` is the flat
// [x,y,...] slot-bone-space stream when UNWEIGHTED (`bones` omitted) and the weighted
// [boneCount, (boneIndex, vx, vy, weight) * boneCount] stream when WEIGHTED (`bones` present, the
// ascending de-duplicated manifest), exactly the format encoding (the @marionette/format codec is the
// single producer/consumer of the weighted layout; WP-2.1 authors only the unweighted form). `uvs`,
// `triangles`, and `hullLength` describe the topology; `edges` is the optional editor wireframe.
// Geometry (uvs/triangles/hullLength/vertices/edges/bones) is replaced wholesale through the
// setMeshGeometry mutator, never patched in place, so a frozen copy is safe to share by reference.
export interface MeshAttachmentEntity {
  readonly kind: 'mesh';
  readonly name: string;
  readonly path: string;
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly hullLength: number;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
  readonly edges?: readonly number[];
  readonly vertices: readonly number[];
  readonly bones?: readonly number[];
}

// The six geometry fields a mesh edit overwrites WHOLESALE (the setMeshGeometry mutator replaces all of
// them at once; name/path/width/height/color are stable through a geometry edit). `edges` and `bones`
// are `| undefined` (not optional) so a caller MUST state intent: undefined clears the wireframe / marks
// the mesh unweighted. Because the overwrite set is exactly these six, a mesh-edit command's before
// memento is the full prior MeshGeometry, which keeps the do/undo round-trip bit-exact (command-history
// D3: capture exactly what you overwrite).
export interface MeshGeometry {
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly hullLength: number;
  readonly vertices: readonly number[];
  readonly edges: readonly number[] | undefined;
  readonly bones: readonly number[] | undefined;
}

// Project a mesh attachment's current geometry into a MeshGeometry value copy (the before memento source
// and the base every mesh-edit command modifies). Arrays are sliced so the memento never aliases the
// live entity.
export function meshGeometryOf(mesh: MeshAttachmentEntity): MeshGeometry {
  return {
    uvs: mesh.uvs.slice(),
    triangles: mesh.triangles.slice(),
    hullLength: mesh.hullLength,
    vertices: mesh.vertices.slice(),
    edges: mesh.edges === undefined ? undefined : mesh.edges.slice(),
    bones: mesh.bones === undefined ? undefined : mesh.bones.slice(),
  };
}

// A non-region attachment (clipping/point/boundingbox) held VERBATIM so a loaded document round-trips
// losslessly: WP-2.1 has no command that creates or edits one. It lives in the same per-slot attachment
// map as region/mesh attachments (keyed by SlotId then name), so a slot rename keeps the linkage and the
// delete cascade restores it uniformly. `value` is the exact format Attachment. Mesh attachments are NO
// LONGER preserved verbatim (WP-2.1 promotes them to the editable MeshAttachmentEntity above).
export interface PreservedAttachmentEntity {
  readonly kind: 'preserved';
  readonly name: string;
  readonly value: Attachment;
}

// The default skin's attachments are the only ones promoted to editable. The discriminated union keeps
// the editable region (RegionAttachmentEntity) and mesh (MeshAttachmentEntity) paths clean while still
// carrying the remaining attachment kinds losslessly (PreservedAttachmentEntity). RemoveAttachment and
// the delete cascade operate on every kind uniformly; only the authoring commands construct or edit the
// region and mesh variants.
export type AttachmentEntity =
  | RegionAttachmentEntity
  | MeshAttachmentEntity
  | PreservedAttachmentEntity;

// The four animatable bone transform channels (the format BoneTimelines keys). A keyframe on a bone
// channel carries the channel-specific value shape below; the channel is the discriminant the model
// and exporter switch on (WP-1.5).
export type BoneChannel = 'rotate' | 'translate' | 'scale' | 'shear';

// Keyframe value shapes, mirroring the format keyframe value types BY VALUE (handoff section 6): a
// rotate value is an angle, translate/scale/shear values are a vec2, a slot color value wraps an RGBA.
// The members are structurally distinct (disjoint keys), so a value narrows to its channel with `in`,
// no tag and no `as` (matching the on-disk shape exactly, which carries no discriminant).
export interface RotateValue {
  readonly angle: number;
}
export interface Vec2Value {
  readonly x: number;
  readonly y: number;
}
export interface ColorValue {
  readonly color: RGBA;
}
export type KeyframeValue = RotateValue | Vec2Value | ColorValue;

// An editable keyframe: an internal `id` (so a sibling insert/delete never invalidates a reference),
// a `time` in seconds, a channel value, and an outgoing interpolation `curve` (the format Keyframe<T>
// fields by value). Keyframe objects are immutable and deep-frozen at construction (makeKeyframe), so
// they are shared by reference between the model, mementos, and read hand-outs with no aliasing bug.
export interface KeyframeEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly value: KeyframeValue;
  readonly curve: CurveType;
}

// A slot attachment-swap frame (the format slot `attachment` timeline): stepped, carries no curve, and
// `name` is the attachment to make active (or null to hide). Phase 1 does NOT author these (no command
// creates one), but the model round-trips them losslessly, so they have an id like any addressable
// timeline entry.
export interface AttachmentFrameEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly name: string | null;
}

// Per-bone transform timelines: each channel is an ordered (strictly ascending time) list. An empty
// channel is the absence of that timeline; a bone with all four channels empty owns no entry in an
// animation's `bones` map (the mutator prunes it), so the projection omits it.
export interface BoneTimelineSet {
  readonly rotate: readonly KeyframeEntity[];
  readonly translate: readonly KeyframeEntity[];
  readonly scale: readonly KeyframeEntity[];
  readonly shear: readonly KeyframeEntity[];
}

// Per-slot timelines (Phase 1 subset): the color tint timeline (interpolated, curved) and the stepped
// attachment-swap timeline. A slot with both empty owns no entry in an animation's `slots` map.
export interface SlotTimelineSet {
  readonly color: readonly KeyframeEntity[];
  readonly attachment: readonly AttachmentFrameEntity[];
}

// An editable animation (WP-1.5): an internal `id`, a mutable `name` (the on-disk record key, resolved
// at export), a `duration` in seconds, and timelines keyed by BoneId / SlotId internally (resolved to
// names on export) so renaming or reordering a bone/slot never breaks a track.
export interface AnimationEntity {
  readonly id: AnimationId;
  readonly name: string;
  readonly duration: number;
  readonly bones: ReadonlyMap<BoneId, BoneTimelineSet>;
  readonly slots: ReadonlyMap<SlotId, SlotTimelineSet>;
}

// Phase-1 preserved content: the document body not yet promoted to editable id-keyed entities. The
// `atlas` stays preserved until its command lands (WP-1.3). `extraSkins` are skins OTHER than 'default'
// (Phase 1 authors only the default skin, which is materialized from `slots` + `attachments`, never
// stored here); they round-trip verbatim. Slots/attachments (WP-1.2) and animations (WP-1.5) left
// PreservedContent and are now first-class (DocState.slots / .attachments / .animations).
export interface PreservedContent {
  readonly atlas: AtlasRef;
  readonly extraSkins: readonly Skin[];
}

// The full internal document state. Bones, slots, and animations are the editable, id-keyed
// collections; `boneOrder` keeps parents before children (the format invariant) and `slotOrder` is the
// setup-pose draw order (the format `slots[]` order). `attachments` is the default skin's attachments
// keyed by owning SlotId then attachment name. `animations` is keyed by AnimationId; the on-disk record
// is name-keyed and order-insignificant, so a deterministic projection sorts by id. DocState is
// immutable to the outside world: its only mutation surface is the Mutator, reachable only from a command.
export interface DocState {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: ReadonlyMap<BoneId, BoneEntity>;
  readonly boneOrder: readonly BoneId[];
  readonly slots: ReadonlyMap<SlotId, SlotEntity>;
  readonly slotOrder: readonly SlotId[];
  readonly attachments: ReadonlyMap<SlotId, ReadonlyMap<string, AttachmentEntity>>;
  readonly animations: ReadonlyMap<AnimationId, AnimationEntity>;
  readonly preserved: PreservedContent;
}

// A new, empty document body: one default skin (the format requires it on export) and no extra skins or
// atlas pages. The default skin is materialized from the (empty) slots/attachments on export, so it is
// not stored here. Animations are first-class (DocState.animations), not preserved.
export function emptyPreservedContent(): PreservedContent {
  return {
    atlas: { pages: [] },
    extraSkins: [],
  };
}

// A fresh, empty document state at the current format version: no bones yet (the first CreateBone adds
// the root), no slots, attachments, or animations, a materialized default skin on export. Export stays
// invalid until a bone exists (the format requires bones.length >= 1), which the Phase 0 flow satisfies
// before saving.
export function newDocState(name: string): DocState {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name,
    bones: new Map(),
    boneOrder: [],
    slots: new Map(),
    slotOrder: [],
    attachments: new Map(),
    animations: new Map(),
    preserved: emptyPreservedContent(),
  };
}

// Deep-copy a keyframe value, preserving its channel shape (a color also copies its RGBA so the copy
// never aliases the source). The `in` narrowing matches the disjoint value shapes with no `as`.
export function cloneKeyframeValue(value: KeyframeValue): KeyframeValue {
  if ('angle' in value) return { angle: value.angle };
  if ('color' in value) {
    const { r, g, b, a } = value.color;
    return { color: { r, g, b, a } };
  }
  return { x: value.x, y: value.y };
}

// Deep-copy a curve. Strings ('linear' / 'stepped') are value types; a bezier copies its control points
// so the copy never aliases the source.
export function cloneCurve(curve: CurveType): CurveType {
  if (typeof curve === 'string') return curve;
  return { type: 'bezier', cx1: curve.cx1, cy1: curve.cy1, cx2: curve.cx2, cy2: curve.cy2 };
}

// Construct an immutable, deep-frozen keyframe. Centralized so the model, commands, and load all build
// keyframes the same way; freezing makes a keyframe safe to share by reference everywhere (it is never
// mutated in place, channels are replaced wholesale).
export function makeKeyframe(
  id: KeyframeId,
  time: number,
  value: KeyframeValue,
  curve: CurveType,
): KeyframeEntity {
  return Object.freeze({
    id,
    time,
    value: Object.freeze(cloneKeyframeValue(value)),
    curve: typeof curve === 'string' ? curve : Object.freeze(cloneCurve(curve)),
  });
}

// Construct an immutable attachment-swap frame (no curve).
export function makeAttachmentFrame(
  id: KeyframeId,
  time: number,
  name: string | null,
): AttachmentFrameEntity {
  return Object.freeze({ id, time, name });
}

// An empty bone timeline set (all four channels empty). The mutator creates one lazily when the first
// keyframe is written to a bone, and prunes the entry when the set returns to all-empty.
export function emptyBoneTimelineSet(): BoneTimelineSet {
  return { rotate: [], translate: [], scale: [], shear: [] };
}

// True when a bone timeline set carries no keyframes on any channel (the prune condition).
export function isBoneTimelineSetEmpty(set: BoneTimelineSet): boolean {
  return (
    set.rotate.length === 0 &&
    set.translate.length === 0 &&
    set.scale.length === 0 &&
    set.shear.length === 0
  );
}

// True when a slot timeline set carries no color keyframes and no attachment frames (the prune condition).
export function isSlotTimelineSetEmpty(set: SlotTimelineSet): boolean {
  return set.color.length === 0 && set.attachment.length === 0;
}
