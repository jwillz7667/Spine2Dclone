import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import type {
  Animation,
  Attachment,
  AtlasRef,
  BlendMode,
  CurveType,
  PathConstraint,
  RegionAttachment,
  RGB,
  RGBA,
  SequenceMode,
  SkeletonMeta,
  TransformMode,
} from '@marionette/format/types';

// Stage F2 (ADR-0009) carried timeline tracks, held VERBATIM as the format keyframe arrays. Document-core
// has no command that authors them yet (that is PP-D10); it carries them losslessly through load and export
// so a 0.4.0 document round-trips. They are non-empty arrays of the exact on-disk shape (a NonNullable of
// the optional format channel), deep-frozen and shared by reference (never mutated in place).
type CarriedSequence = NonNullable<RegionAttachment['sequence']>;
// Stage F3 (ADR-0011, formatVersion 0.5.0) carried path-constraint timelines: the per-animation `path`
// record (constraintName -> Keyframe<PathFrame>[]), held VERBATIM as the on-disk shape. Document-core
// authors no path timeline yet (PP-D11); it carries the record losslessly through load and export so a
// 0.5.0 document round-trips, deep-frozen and shared by reference (never mutated in place), mirroring how
// drawOrder/events and the Stage F2 tracks above are carried.
type CarriedPathTimelines = Animation['path'];
import type {
  AnimationId,
  BoneId,
  EventDefId,
  IkConstraintId,
  KeyframeId,
  SkinId,
  SlotId,
  TransformConstraintId,
} from './ids';
import type { SlotSceneState } from './slot-scene';
import { defaultSlotSceneState } from './slot-scene';

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
  // Stage F2 (ADR-0009 section 3) frame-sequence playback, carried verbatim; no command authors it (PP-D10).
  readonly sequence?: CarriedSequence;
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
  // Stage F2 (ADR-0009 section 3) frame-sequence playback, carried verbatim; no command authors it (PP-D10).
  readonly sequence?: CarriedSequence;
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

// A linked mesh (Stage F2, ADR-0009 section 2) promoted to editable (PP-D10). It reuses a PARENT mesh's
// geometry (uvs/triangles/hull/vertices/weights) while carrying its OWN atlas region, color, and size. It has
// NO geometry of its own; `parent` is the parent attachment NAME on the SAME slot in skin `skin ?? this skin`
// (the default skin's name is 'default'), and `timelines` selects whether it shares the parent's deform
// timelines. CreateLinkedMesh resolves and cycle-checks the parent at the command boundary (mirroring the
// format's LINKED_MESH_* validators); UnlinkMesh bakes it to a plain MeshAttachmentEntity with the resolved
// root geometry.
export interface LinkedMeshAttachmentEntity {
  readonly kind: 'linkedmesh';
  readonly name: string;
  readonly path: string;
  readonly parent: string;
  readonly skin?: string;
  readonly timelines: boolean;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}

// A non-region attachment (clipping/point/boundingbox) held VERBATIM so a loaded document round-trips
// losslessly: WP-2.1 has no command that creates or edits one. It lives in the same per-slot attachment
// map as region/mesh attachments (keyed by SlotId then name), so a slot rename keeps the linkage and the
// delete cascade restores it uniformly. `value` is the exact format Attachment. Mesh attachments are NO
// LONGER preserved verbatim (WP-2.1 promotes them to the editable MeshAttachmentEntity above), and linked
// meshes are promoted to LinkedMeshAttachmentEntity (PP-D10).
export interface PreservedAttachmentEntity {
  readonly kind: 'preserved';
  readonly name: string;
  readonly value: Attachment;
}

// A path attachment (Stage F3, ADR-0011 section 1) promoted to editable (PP-D11): a piecewise cubic Bezier
// spline through the slot, used as a rail a path constraint distributes bones along. The EDITABLE entity
// models the UNWEIGHTED control-point case (a flat [x0, y0, x1, y1, ...] stream, laid out anchor, handle,
// handle, anchor, ... with consecutive curves sharing their touching anchor); a WEIGHTED path (a `bones`
// manifest present) is carried verbatim as a PreservedAttachmentEntity until a weighted-path authoring
// surface lands, exactly as an unweighted-only mesh promotion would. `lengths` is the cumulative arc-length
// table (one entry per curve, non-decreasing) the command layer RECOMPUTES from the control points on every
// edit (the format requires it and ADR-0011 assigns its computation to authoring; see paths/path-geometry).
// A path renders no pixels, so it carries no atlas region, size, or color (like boundingbox).
export interface PathAttachmentEntity {
  readonly kind: 'path';
  readonly name: string;
  readonly closed: boolean;
  readonly constantSpeed: boolean;
  readonly lengths: readonly number[];
  readonly vertices: readonly number[];
}

// The four fields a path control-point edit overwrites WHOLESALE (mirroring MeshGeometry): the geometry
// (`vertices`), the derived arc-length table (`lengths`, recomputed on every edit), and the two flags
// (`closed`/`constantSpeed`, which a flag command flips and a close/open edit changes alongside the vertex
// stream). `name` is the stable identity and is preserved across an edit. Because the overwrite set is
// exactly these four, a path-edit command's before memento is the full prior PathGeometry, which keeps the
// do/undo round-trip bit-exact (command-history D3: capture exactly what you overwrite).
export interface PathGeometry {
  readonly closed: boolean;
  readonly constantSpeed: boolean;
  readonly lengths: readonly number[];
  readonly vertices: readonly number[];
}

// Project a path attachment's current geometry into a PathGeometry value copy (the before memento source
// and the base every path-edit command modifies). Arrays are sliced so the memento never aliases the live
// entity.
export function pathGeometryOf(path: PathAttachmentEntity): PathGeometry {
  return {
    closed: path.closed,
    constantSpeed: path.constantSpeed,
    lengths: path.lengths.slice(),
    vertices: path.vertices.slice(),
  };
}

// Construct an immutable, deep-frozen path attachment (PP-D11). Centralized so load, the command, and the
// internal freeze build it the same way; the arrays are copied so the entity never aliases a caller's value.
export function makePathAttachment(init: {
  readonly name: string;
  readonly closed: boolean;
  readonly constantSpeed: boolean;
  readonly lengths: readonly number[];
  readonly vertices: readonly number[];
}): PathAttachmentEntity {
  return Object.freeze({
    kind: 'path',
    name: init.name,
    closed: init.closed,
    constantSpeed: init.constantSpeed,
    lengths: Object.freeze(init.lengths.slice()),
    vertices: Object.freeze(init.vertices.slice()),
  });
}

// The default skin's attachments are the only ones promoted to editable. The discriminated union keeps
// the editable region (RegionAttachmentEntity), mesh (MeshAttachmentEntity), linked-mesh
// (LinkedMeshAttachmentEntity), and path (PathAttachmentEntity) paths clean while still carrying the
// remaining attachment kinds losslessly (PreservedAttachmentEntity). RemoveAttachment and the delete cascade
// operate on every kind uniformly; only the authoring commands construct or edit the promoted variants.
export type AttachmentEntity =
  | RegionAttachmentEntity
  | MeshAttachmentEntity
  | LinkedMeshAttachmentEntity
  | PathAttachmentEntity
  | PreservedAttachmentEntity;

// Construct an immutable, deep-frozen linked-mesh attachment (PP-D10). Centralized so load, the command, and
// the internal freeze build it the same way; the color is copied so the entity never aliases a caller's value.
export function makeLinkedMeshAttachment(init: {
  readonly name: string;
  readonly path: string;
  readonly parent: string;
  readonly skin?: string | undefined;
  readonly timelines: boolean;
  readonly width: number;
  readonly height: number;
  readonly color: RGBA;
}): LinkedMeshAttachmentEntity {
  return Object.freeze({
    kind: 'linkedmesh',
    name: init.name,
    path: init.path,
    parent: init.parent,
    ...(init.skin !== undefined ? { skin: init.skin } : {}),
    timelines: init.timelines,
    width: init.width,
    height: init.height,
    color: Object.freeze({ ...init.color }),
  });
}

// The animatable bone transform channels (the format BoneTimelines keys). A keyframe on a bone channel
// carries the channel-specific value shape below; the channel is the discriminant the model and exporter
// switch on (WP-1.5). The JOINT channels (rotate/translate/scale/shear) carry a rotate angle or a vec2;
// the Stage F2 (ADR-0009 section 4.1, PP-D10) per-component SPLIT channels carry a lone ScalarValue. A
// joint channel and its split components MUST NOT coexist on one bone (TIMELINE_COMPONENT_CONFLICT).
export type BoneJointChannel = 'rotate' | 'translate' | 'scale' | 'shear';
export type BoneComponentChannel =
  | 'translateX'
  | 'translateY'
  | 'scaleX'
  | 'scaleY'
  | 'shearX'
  | 'shearY';
export type BoneChannel = BoneJointChannel | BoneComponentChannel;

// Keyframe value shapes, mirroring the format keyframe value types BY VALUE (handoff section 6): a
// rotate value is an angle, translate/scale/shear values are a vec2, a slot color value wraps an RGBA.
// Stage F2 (ADR-0009, PP-D10) ADDS three scalar/split shapes for the per-component bone tracks and the
// split slot-color tracks: a lone scalar (`value`, the per-component bone channels translateX/Y, scaleX/Y,
// shearX/Y), an RGB triple (`rgb`, the split slot-color track), and a lone alpha (`alpha`, the split
// slot-alpha track). The members are structurally distinct (disjoint keys `angle`/`x`/`color`/`value`/
// `rgb`/`alpha`), so a value narrows to its channel with `in`, no tag and no `as` (matching the on-disk
// shape exactly, which carries no discriminant).
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
export interface ScalarValue {
  readonly value: number;
}
export interface RgbValue {
  readonly rgb: RGB;
}
export interface AlphaValue {
  readonly alpha: number;
}
export type KeyframeValue =
  | RotateValue
  | Vec2Value
  | ColorValue
  | ScalarValue
  | RgbValue
  | AlphaValue;

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
  // Stage F2 (ADR-0009 section 4.1, PP-D10) per-component split tracks, now first-class editable id-keyed
  // keyframes (each carries a ScalarValue) like the joint channels: always present, empty when unused. A
  // joint channel and its split components never coexist on one bone (the format's
  // TIMELINE_COMPONENT_CONFLICT, enforced by SetKeyframe), so at most one form per channel is non-empty.
  readonly translateX: readonly KeyframeEntity[];
  readonly translateY: readonly KeyframeEntity[];
  readonly scaleX: readonly KeyframeEntity[];
  readonly scaleY: readonly KeyframeEntity[];
  readonly shearX: readonly KeyframeEntity[];
  readonly shearY: readonly KeyframeEntity[];
}

// A keyed slot frame-sequence entry (Stage F2, ADR-0009 section 3; promoted to editable by PP-D10). At
// `time`, play the attachment's frame sequence from frame `index` in `mode` at `delay` seconds per frame. No
// curve (a discrete playback-state change); key times are strict-ascending. Immutable and deep-frozen
// (makeSequenceKeyframe), so it is shared by reference without aliasing.
export interface SequenceKeyframeEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly mode: SequenceMode;
  readonly index: number;
  readonly delay: number;
}

// Per-slot timelines (Phase 1 subset): the color tint timeline (interpolated, curved) and the stepped
// attachment-swap timeline. A slot with everything empty owns no entry in an animation's `slots` map.
export interface SlotTimelineSet {
  readonly color: readonly KeyframeEntity[];
  readonly attachment: readonly AttachmentFrameEntity[];
  // Stage F2 (ADR-0009 section 3) frame-`sequence` timeline, promoted to editable id-keyed entities (PP-D10),
  // always present (empty when unused), like `color`/`attachment`.
  readonly sequence: readonly SequenceKeyframeEntity[];
  // Stage F2 (ADR-0009 section 4.3) keyable two-color `dark` tint, promoted to editable id-keyed keyframes
  // (PP-D10); the value is an RGBA ColorValue like the joint `color` channel. Keying it requires the slot's
  // setup `darkColor` (the format's ANIM_DARK_NO_SETUP). Always present (empty when unused).
  readonly dark: readonly KeyframeEntity[];
  // Stage F2 (ADR-0009 section 4.2, PP-D10) split rgb/alpha color tracks, now first-class editable id-keyed
  // keyframes: `rgb` carries an RgbValue, `alpha` an AlphaValue. Always present, empty when unused. The
  // joint `color` and the split `rgb`/`alpha` never coexist on one slot (the format's
  // TIMELINE_COMPONENT_CONFLICT, enforced by SetKeyframe).
  readonly rgb: readonly KeyframeEntity[];
  readonly alpha: readonly KeyframeEntity[];
}

// A keyed IK-constraint frame (WP-2.6, format IkFrame): an internal `id`, a `time`, a `mix` blend, a
// `bendPositive` flag, and an outgoing `curve`. `bendPositive` is NON-interpolatable and sampled STEPPED
// by every runtime regardless of `curve` (ADR-0003 section 7); the model carries both so a flip is a
// clean step at its keyframe time and the curve survives a round-trip. Immutable and deep-frozen, like
// KeyframeEntity, so it is shared by reference without aliasing.
export interface IkKeyframeEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly mix: number;
  readonly bendPositive: boolean;
  readonly curve: CurveType;
  // Stage F2 (ADR-0009 section 1) OPTIONAL keyed depth channels, carried verbatim (no command authors them
  // yet, PP-D10). `bendPositive` remains the model's bend representation; the load/export seam maps it to
  // and from the signed format `bend` losslessly (true <-> +1, false <-> -1).
  readonly softness?: number;
  readonly stretch?: boolean;
  readonly compress?: boolean;
}

// A keyed transform-constraint frame (WP-2.7, format TransformFrame): a PARTIAL record of the six
// world-channel mix factors (a frame MAY carry a subset; an absent channel keeps its base value, which is
// SOLVE semantics per ADR-0003, not format). Each present mix is a number in [0, 1]; the absent ones are
// `undefined` (not optional) so a caller states intent. `curve` interpolates the present channels.
export interface TransformKeyframeEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly mixRotate: number | undefined;
  readonly mixX: number | undefined;
  readonly mixY: number | undefined;
  readonly mixScaleX: number | undefined;
  readonly mixScaleY: number | undefined;
  readonly mixShearY: number | undefined;
  readonly curve: CurveType;
}

// A keyed deform frame (WP-2.9, format Keyframe<{ offsets }>): per-LOGICAL-vertex (dx, dy) offsets from
// the setup mesh, flat as [dx0, dy0, dx1, dy1, ...] (offsets.length === 2 * V), applied AFTER skinning in
// world space (ADR-0003 section 9). Immutable and deep-frozen; the offsets array is copied at construction
// so the model never aliases a caller's array.
export interface DeformKeyframeEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly offsets: readonly number[];
  readonly curve: CurveType;
}

// The skin dimension of a deform timeline (WP-2.9, format deform record top key). Deform offsets are keyed
// per skin so a mesh in the 'red' skin and the 'blue' skin keep independent deform tracks (TASK-2.9.4).
// The implicit default skin is the literal 'default'; a named skin is its stable SkinId. Both are strings,
// so a Map keys on them directly; a SkinId ('skin_3') never collides with the literal 'default'.
export type DeformSkinKey = 'default' | SkinId;

// An event definition's optional audio hint (ADR-0008 section 1), mirroring the format EventAudio BY
// VALUE: a required asset `path`, a `volume` in [0, 1], and a stereo `balance` in [-1, 1]. Immutable.
export interface EventAudioValue {
  readonly path: string;
  readonly volume: number;
  readonly balance: number;
}

// A document-level event definition (Stage F1, ADR-0008 section 1), promoted to a first-class id-keyed
// entity (PP-D9). It carries the payload DEFAULTS an event fires with (`int`/`float`/`string`, each a
// value or undefined so a caller states intent, exactly like TransformKeyframeEntity's mix channels) plus
// an optional `audio` hint. `name` is the mutable on-disk identity an animation's event timeline references
// (by EventDefId in the model, so a rename never cascades). Deep-frozen at construction (makeEventDef).
export interface EventDefEntity {
  readonly id: EventDefId;
  readonly name: string;
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
  readonly audio: EventAudioValue | undefined;
}

// An event-timeline key (Stage F1, ADR-0008 section 2): fires the event referenced by `event` (an
// EventDefId, resolved from the on-disk name on load) at `time`, OPTIONALLY overriding the definition's
// int/float/string payload defaults for this firing (an absent override is undefined). Events are discrete
// (no curve). Event times are NON-DECREASING (coincident firings are legal), unlike the strictly-ascending
// value timelines. Immutable and deep-frozen (makeEventKey), so it is shared by reference without aliasing.
export interface EventKeyEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly event: EventDefId;
  readonly int: number | undefined;
  readonly float: number | undefined;
  readonly string: string | undefined;
}

// One entry of a draw-order key's compact offset list (Stage F1, ADR-0008 section 3): move the slot
// referenced by `slot` (a SlotId, resolved from the on-disk name on load, so a slot rename/reorder never
// breaks the key) by a signed integer number of positions from its setup draw-order index. Immutable.
export interface DrawOrderOffsetEntity {
  readonly slot: SlotId;
  readonly offset: number;
}

// A draw-order timeline key (Stage F1, ADR-0008 section 3): at `time`, apply this compact list of per-slot
// offsets to the setup draw order. An EMPTY `offsets` list means the setup order (identity), so a key can
// restore it after an earlier reorder. Draw-order changes are discrete (no curve) and STRICTLY ascending in
// time. The FULL per-frame order is DERIVED by runtime-core (PP-B4); the model carries only the offsets and
// keeps them consistent (each slot at most once, target indices distinct and in range) at the command
// boundary. Immutable and deep-frozen (makeDrawOrderKey); the offsets array is copied at construction.
export interface DrawOrderKeyEntity {
  readonly id: KeyframeId;
  readonly time: number;
  readonly offsets: readonly DrawOrderOffsetEntity[];
}

// An editable animation (WP-1.5, extended in Phase 2). Bone/slot timelines are keyed by BoneId / SlotId;
// the ik/transform timelines are keyed by the constraint's internal id; the deform timeline is the nested
// skin -> slot -> attachment-name record (the format `deform` shape) keyed by DeformSkinKey then SlotId
// then attachment name. All keys are internal ids (or the stable 'default' literal), resolved to names on
// export, so a rename or reorder never breaks a track.
export interface AnimationEntity {
  readonly id: AnimationId;
  readonly name: string;
  readonly duration: number;
  readonly bones: ReadonlyMap<BoneId, BoneTimelineSet>;
  readonly slots: ReadonlyMap<SlotId, SlotTimelineSet>;
  readonly ik: ReadonlyMap<IkConstraintId, readonly IkKeyframeEntity[]>;
  readonly transform: ReadonlyMap<TransformConstraintId, readonly TransformKeyframeEntity[]>;
  readonly deform: ReadonlyMap<
    DeformSkinKey,
    ReadonlyMap<SlotId, ReadonlyMap<string, readonly DeformKeyframeEntity[]>>
  >;
  // Stage F1 (ADR-0008, formatVersion 0.3.0) draw-order and event timelines, promoted to id-keyed editable
  // entities (PP-D9). Draw-order keys reorder slots over time (offsets reference slots by SlotId); event
  // keys fire named events (referencing an EventDefId). Both carry a KeyframeId per key so a sibling
  // insert/delete never invalidates a captured command, exactly like the value/deform timelines.
  readonly drawOrder: readonly DrawOrderKeyEntity[];
  readonly events: readonly EventKeyEntity[];
  // Stage F3 (ADR-0011, formatVersion 0.5.0) path-constraint timeline record, carried verbatim (no command
  // authors it yet, PP-D11). REQUIRED and empty ({}) when an animation keys no path constraint, mirroring
  // the always-present drawOrder/events collections; a load/export round-trip preserves it exactly.
  readonly path: CarriedPathTimelines;
}

// An IK constraint (WP-2.6, format IkConstraint), mirrored BY VALUE except `bones`/`target`, which are
// BoneId references (not names) so a rename never breaks a constraint. `bones` is the 1 or 2 bone chain,
// parent-before-child; `target` is the bone the chain reaches toward. Solve order is the stored array
// order in DocState.ikConstraintOrder (ADR-0003 section 3).
export interface IkConstraintEntity {
  readonly id: IkConstraintId;
  readonly name: string;
  readonly bones: readonly BoneId[];
  readonly target: BoneId;
  readonly mix: number;
  // `bendPositive` is the model's bend representation; the load/export seam maps it to and from the signed
  // format `bend` losslessly (true <-> +1, false <-> -1, ADR-0009 section 1.4).
  readonly bendPositive: boolean;
  // Stage F2 (ADR-0009 section 1.1) IK depth, carried at its no-op default until an authoring command lands
  // (PP-D10). softness 0 and the three booleans false reproduce the pre-0.4.0 hard, fixed-length solve.
  readonly softness: number;
  readonly stretch: boolean;
  readonly compress: boolean;
  readonly uniform: boolean;
  // OPTIONAL explicit solve order across both constraint arrays (ADR-0009 section 1.3); absent by default.
  readonly order?: number;
}

// A transform constraint (WP-2.7, format TransformConstraint): drives a bone's six world channels from a
// target with a per-channel mix and additive offset (ADR-0003 section 5). `bones`/`target` are BoneId
// references. Solve order is DocState.transformConstraintOrder, AFTER all IK constraints.
export interface TransformConstraintEntity {
  readonly id: TransformConstraintId;
  readonly name: string;
  readonly bones: readonly BoneId[];
  readonly target: BoneId;
  readonly mixRotate: number;
  readonly mixX: number;
  readonly mixY: number;
  readonly mixScaleX: number;
  readonly mixScaleY: number;
  readonly mixShearY: number;
  readonly offsetRotation: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetScaleX: number;
  readonly offsetScaleY: number;
  readonly offsetShearY: number;
  // Stage F2 (ADR-0009 section 1.2) transform-constraint variant flags, carried at their no-op default
  // (both false reproduce the ADR-0003 world, absolute behavior) until an authoring command lands (PP-D10).
  readonly local: boolean;
  readonly relative: boolean;
  // OPTIONAL explicit solve order across both constraint arrays (ADR-0009 section 1.3); absent by default.
  readonly order?: number;
}

// A named (NON-default) skin (WP-2.8, format Skin): its own `attachments` map keyed by owning SlotId then
// attachment name, exactly the shape of the default skin's editable attachment map. The 'default' skin is
// implicit (materialized from DocState.attachments) and is NOT a SkinEntity; CreateSkin/DeleteSkin operate
// only on named variants, so 'default' can never be deleted (TASK-2.8.1).
export interface SkinEntity {
  readonly id: SkinId;
  readonly name: string;
  readonly attachments: ReadonlyMap<SlotId, ReadonlyMap<string, AttachmentEntity>>;
  // Stage F2 (ADR-0009 section 5) skin-scoped bone/constraint NAME lists, carried verbatim (no command
  // authors them yet, PP-D10). Kept as on-disk names rather than ids because there is no scoping-aware
  // rename cascade until PP-D10; a load/export round-trip preserves them exactly.
  readonly bones?: readonly string[];
  readonly constraints?: readonly string[];
}

// Preserved content: the document body not yet promoted to editable id-keyed entities. The only remaining
// member is the `atlas` (it stays preserved until its own editing lands beyond WP-1.3's SetAtlasRef).
// Document-level events and the skeleton metadata block were promoted to first-class DocState.events /
// DocState.metadata by PP-D9 (Stage F1); non-default skins were promoted to DocState.skins by WP-2.8.
export interface PreservedContent {
  readonly atlas: AtlasRef;
  // Stage F3 (ADR-0011, formatVersion 0.5.0) root path-constraint array, carried verbatim as on-disk
  // names (no command authors path constraints yet, PP-D11), mirroring how the Stage F2 skin-scoping name
  // lists are carried. REQUIRED and empty ([]) when the rig has none; a round-trip preserves it exactly.
  readonly pathConstraints: readonly PathConstraint[];
}

// The full internal document state. Bones, slots, animations, constraints, and named skins are the
// editable, id-keyed collections; `boneOrder` keeps parents before children (the format invariant),
// `slotOrder` is the setup-pose draw order, and `ikConstraintOrder` / `transformConstraintOrder` are the
// constraint solve order (ADR-0003: all IK in order, then all transform in order). `attachments` is the
// DEFAULT skin's attachments keyed by owning SlotId then attachment name; `skins` holds the NON-default
// named skins keyed by SkinId (each with its own attachment map). `animations` is keyed by AnimationId.
// DocState is immutable to the outside world: its only mutation surface is the Mutator, reachable only
// from a command.
export interface DocState {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: ReadonlyMap<BoneId, BoneEntity>;
  readonly boneOrder: readonly BoneId[];
  readonly slots: ReadonlyMap<SlotId, SlotEntity>;
  readonly slotOrder: readonly SlotId[];
  readonly attachments: ReadonlyMap<SlotId, ReadonlyMap<string, AttachmentEntity>>;
  readonly animations: ReadonlyMap<AnimationId, AnimationEntity>;
  readonly ikConstraints: ReadonlyMap<IkConstraintId, IkConstraintEntity>;
  readonly ikConstraintOrder: readonly IkConstraintId[];
  readonly transformConstraints: ReadonlyMap<TransformConstraintId, TransformConstraintEntity>;
  readonly transformConstraintOrder: readonly TransformConstraintId[];
  readonly skins: ReadonlyMap<SkinId, SkinEntity>;
  readonly skinOrder: readonly SkinId[];
  // Document-level event definitions (Stage F1, ADR-0008; PP-D9), keyed by EventDefId with an explicit
  // `eventOrder` for a stable on-disk emission order (mirroring boneOrder alongside the bones map). An
  // animation's event keys reference these by EventDefId. `metadata` is the OPTIONAL skeleton metadata block
  // (fps/imagesPath/audioPath authoring hints), undefined when the document defines none.
  readonly events: ReadonlyMap<EventDefId, EventDefEntity>;
  readonly eventOrder: readonly EventDefId[];
  readonly metadata: SkeletonMeta | undefined;
  // The slot-scene aggregate (phase-4 WP-4.5 / WP-4.6): the grid, the SymbolId-keyed symbol library, the
  // win sequencer, the feature-flow graph, the tumble choreography, and the scene refs, all value/name-keyed
  // (not id-branded, mirroring how the format references slot artifacts by name). It is ALWAYS present (a
  // default 5x3 reelStrip scene on a fresh document), so a slot command never has to create the container.
  readonly slotScene: SlotSceneState;
  readonly preserved: PreservedContent;
}

// A new, empty document body: one default skin (the format requires it on export) and no extra skins or
// atlas pages. The default skin is materialized from the (empty) slots/attachments on export, so it is
// not stored here. Animations are first-class (DocState.animations), not preserved.
export function emptyPreservedContent(): PreservedContent {
  return {
    atlas: { pages: [] },
    pathConstraints: [],
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
    ikConstraints: new Map(),
    ikConstraintOrder: [],
    transformConstraints: new Map(),
    transformConstraintOrder: [],
    skins: new Map(),
    skinOrder: [],
    events: new Map(),
    eventOrder: [],
    metadata: undefined,
    slotScene: defaultSlotSceneState(),
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
  if ('value' in value) return { value: value.value };
  if ('rgb' in value) {
    const { r, g, b } = value.rgb;
    return { rgb: { r, g, b } };
  }
  if ('alpha' in value) return { alpha: value.alpha };
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

// Construct an immutable slot sequence keyframe (PP-D10, no curve). Centralized so load, the commands, and
// the internal freeze build sequence keys identically.
export function makeSequenceKeyframe(
  id: KeyframeId,
  time: number,
  mode: SequenceMode,
  index: number,
  delay: number,
): SequenceKeyframeEntity {
  return Object.freeze({ id, time, mode, index, delay });
}

// Construct an immutable, deep-frozen IK keyframe (WP-2.6). Centralized so the model, commands, and load
// build IK frames the same way; the curve is frozen when it is a bezier (a string curve is a value type).
export function makeIkKeyframe(
  id: KeyframeId,
  time: number,
  mix: number,
  bendPositive: boolean,
  curve: CurveType,
  depth?: {
    readonly softness?: number | undefined;
    readonly stretch?: boolean | undefined;
    readonly compress?: boolean | undefined;
  },
): IkKeyframeEntity {
  // The OPTIONAL F2 depth channels (ADR-0009) are carried only when the loaded frame supplies them, per
  // exactOptionalPropertyTypes; an authored frame (set-ik-keyframe) passes no depth and stays at the
  // Phase-2 shape.
  return Object.freeze({
    id,
    time,
    mix,
    bendPositive,
    curve: typeof curve === 'string' ? curve : Object.freeze(cloneCurve(curve)),
    ...(depth?.softness !== undefined ? { softness: depth.softness } : {}),
    ...(depth?.stretch !== undefined ? { stretch: depth.stretch } : {}),
    ...(depth?.compress !== undefined ? { compress: depth.compress } : {}),
  });
}

// Construct an immutable, deep-frozen transform-constraint keyframe (WP-2.7). The six mix channels are
// each a number or undefined (an absent channel keeps its base value, ADR-0003); they are copied as given.
export function makeTransformKeyframe(
  id: KeyframeId,
  time: number,
  mix: {
    readonly mixRotate: number | undefined;
    readonly mixX: number | undefined;
    readonly mixY: number | undefined;
    readonly mixScaleX: number | undefined;
    readonly mixScaleY: number | undefined;
    readonly mixShearY: number | undefined;
  },
  curve: CurveType,
): TransformKeyframeEntity {
  return Object.freeze({
    id,
    time,
    mixRotate: mix.mixRotate,
    mixX: mix.mixX,
    mixY: mix.mixY,
    mixScaleX: mix.mixScaleX,
    mixScaleY: mix.mixScaleY,
    mixShearY: mix.mixShearY,
    curve: typeof curve === 'string' ? curve : Object.freeze(cloneCurve(curve)),
  });
}

// Construct an immutable, deep-frozen deform keyframe (WP-2.9). The offsets array is sliced and frozen so
// the model never aliases the caller's array and a handed-out reference cannot mutate it.
export function makeDeformKeyframe(
  id: KeyframeId,
  time: number,
  offsets: readonly number[],
  curve: CurveType,
): DeformKeyframeEntity {
  return Object.freeze({
    id,
    time,
    offsets: Object.freeze(offsets.slice()),
    curve: typeof curve === 'string' ? curve : Object.freeze(cloneCurve(curve)),
  });
}

// Deep-copy an event audio hint (a value type) or pass through undefined, so a memento never aliases the
// source. Centralized so the model, commands, and load build audio hints identically.
export function cloneEventAudio(audio: EventAudioValue | undefined): EventAudioValue | undefined {
  return audio === undefined
    ? undefined
    : { path: audio.path, volume: audio.volume, balance: audio.balance };
}

// Deep-copy the optional skeleton metadata block, emitting only the present fields (exactOptionalProperty
// Types) so a block with, say, only `fps` round-trips deep-equal. Passes through undefined unchanged.
export function cloneMetadata(metadata: SkeletonMeta | undefined): SkeletonMeta | undefined {
  if (metadata === undefined) return undefined;
  return {
    ...(metadata.fps !== undefined ? { fps: metadata.fps } : {}),
    ...(metadata.imagesPath !== undefined ? { imagesPath: metadata.imagesPath } : {}),
    ...(metadata.audioPath !== undefined ? { audioPath: metadata.audioPath } : {}),
  };
}

// Construct an immutable, deep-frozen event definition (Stage F1). Centralized so the model, commands, and
// load build event defs the same way; the audio hint is copied so the entity never aliases a caller's value.
export function makeEventDef(
  id: EventDefId,
  name: string,
  payload: {
    readonly int: number | undefined;
    readonly float: number | undefined;
    readonly string: string | undefined;
    readonly audio: EventAudioValue | undefined;
  },
): EventDefEntity {
  return Object.freeze({
    id,
    name,
    int: payload.int,
    float: payload.float,
    string: payload.string,
    audio: payload.audio === undefined ? undefined : Object.freeze(cloneEventAudio(payload.audio)),
  });
}

// Construct an immutable, deep-frozen event-timeline key (Stage F1). The int/float/string overrides are
// copied as given (each a value or undefined). `event` is the referenced definition's EventDefId.
export function makeEventKey(
  id: KeyframeId,
  time: number,
  event: EventDefId,
  overrides: {
    readonly int: number | undefined;
    readonly float: number | undefined;
    readonly string: string | undefined;
  },
): EventKeyEntity {
  return Object.freeze({
    id,
    time,
    event,
    int: overrides.int,
    float: overrides.float,
    string: overrides.string,
  });
}

// Construct an immutable, deep-frozen draw-order key (Stage F1). The offsets array is sliced and each entry
// frozen so the model never aliases the caller's array and a handed-out reference cannot mutate it.
export function makeDrawOrderKey(
  id: KeyframeId,
  time: number,
  offsets: readonly DrawOrderOffsetEntity[],
): DrawOrderKeyEntity {
  return Object.freeze({
    id,
    time,
    offsets: Object.freeze(offsets.map((entry) => Object.freeze({ slot: entry.slot, offset: entry.offset }))),
  });
}

// An empty bone timeline set (all ten channels empty). The mutator creates one lazily when the first
// keyframe is written to a bone, and prunes the entry when the set returns to all-empty.
export function emptyBoneTimelineSet(): BoneTimelineSet {
  return {
    rotate: [],
    translate: [],
    scale: [],
    shear: [],
    translateX: [],
    translateY: [],
    scaleX: [],
    scaleY: [],
    shearX: [],
    shearY: [],
  };
}

// True when a bone timeline set carries no keyframes on any of its ten channels (the prune condition). The
// Stage F2 (ADR-0009) split component tracks are first-class editable channels (PP-D10), so an empty split
// track is absent content exactly like an empty joint channel.
export function isBoneTimelineSetEmpty(set: BoneTimelineSet): boolean {
  return (
    set.rotate.length === 0 &&
    set.translate.length === 0 &&
    set.scale.length === 0 &&
    set.shear.length === 0 &&
    set.translateX.length === 0 &&
    set.translateY.length === 0 &&
    set.scaleX.length === 0 &&
    set.scaleY.length === 0 &&
    set.shearX.length === 0 &&
    set.shearY.length === 0
  );
}

// True when a slot timeline set carries no keyframes on any channel (the prune condition). The Stage F2
// (ADR-0009) split rgb/alpha tracks are first-class editable channels (PP-D10), so an empty split track is
// absent content exactly like an empty color channel.
export function isSlotTimelineSetEmpty(set: SlotTimelineSet): boolean {
  return (
    set.color.length === 0 &&
    set.attachment.length === 0 &&
    set.sequence.length === 0 &&
    set.dark.length === 0 &&
    set.rgb.length === 0 &&
    set.alpha.length === 0
  );
}

// The empty ik/transform/deform/path constraint timelines a fresh animation starts with (Phase 2, extended
// with the Stage F3 path record). They stay empty until an IK/transform/deform keyframe command writes one
// (path has no authoring command yet, PP-D11), so a fresh animation projects to empty
// `{ ik, transform, deform }` records and an empty `path` on export (the format requires all four keys).
export function emptyAnimationConstraintTimelines(): Pick<
  AnimationEntity,
  'ik' | 'transform' | 'deform' | 'path'
> {
  return { ik: new Map(), transform: new Map(), deform: new Map(), path: {} };
}
