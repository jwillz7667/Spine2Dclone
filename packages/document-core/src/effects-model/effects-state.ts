import type {
  AtlasRef,
  BlendMode,
  CurveType,
  EmitterShape,
  ParticleTexture,
  RangeF,
  RGB,
  SpawnConfig,
  TrailSpec,
  Vec2,
} from '@marionette/format/effects-types';
import type { BundleItemId, EffectId, EffectLayerId, LifeStopId } from '../model/ids';

// Internal effects model (phase-3-vfx-particles.md section 8.1.1): the EffectsDocument as first-class
// editable entities addressed by minted ids, the exact mirror of the skeletal model's bone/slot id-keyed
// design. The on-disk format is name-keyed (effects/bundles by name) and array-ordered (layers, life-curve
// stops, bundle items); the model holds an EffectId/EffectLayerId/LifeStopId/BundleItemId per entity, minted
// at import and never serialized. Names are mutable attributes, never identities (RenameEffect has zero
// cascade because bundle items reference an EffectId).

// CurveType reused from the shared `common` primitives (one easing model across skeletal + effects). Strings
// ('linear' / 'stepped') are value types; a bezier carries control points, deep-copied like the skeletal model.
export function cloneEffectsCurve(curve: CurveType): CurveType {
  if (typeof curve === 'string') return curve;
  return { type: 'bezier', cx1: curve.cx1, cy1: curve.cy1, cx2: curve.cx2, cy2: curve.cy2 };
}

// A LifeCurve stop value is either a scalar (scale/alpha curves) or an RGB color (color curves). The two
// are structurally disjoint (a number vs an object), so a value narrows with `typeof` and no `as`.
export type LifeStopValue = number | RGB;

// Deep-copy a stop value, preserving its shape (an RGB copies its channels so the copy never aliases).
export function cloneLifeStopValue(value: LifeStopValue): LifeStopValue {
  if (typeof value === 'number') return value;
  return { r: value.r, g: value.g, b: value.b };
}

// An editable life-curve stop: an internal `id` (so a sibling insert/remove never invalidates a captured
// command), the normalized parameter `t` in [0, 1], a `value` (scalar or RGB), and an outgoing easing
// `curve`. Immutable and deep-frozen at construction so it is shared by reference between the model,
// mementos, and read hand-outs with no aliasing bug (mirrors the skeletal KeyframeEntity discipline).
export interface EffectLifeStopEntity {
  readonly id: LifeStopId;
  readonly t: number;
  readonly value: LifeStopValue;
  readonly curve: CurveType;
}

// An editable life curve: an ordered (strictly ascending `t`) list of stops with `first.t === 0` and
// `last.t === 1` (the WP-3.0 cross-reference contract, enforced by the curve commands' typed guards).
export interface EffectLifeCurveEntity {
  readonly stops: readonly EffectLifeStopEntity[];
}

// The set of life-curve FIELDS an effect layer can carry. A field maps to one EffectLifeCurveEntity on the
// layer; the curve commands locate a stop by LifeStopId by scanning a layer's curves (a stop id is unique
// within its layer). The emitter's optional particle trail contributes two more curve fields, prefixed so
// they never collide with the layer-level fields.
export type LifeCurveField =
  | 'scaleOverLife'
  | 'colorOverLife'
  | 'alphaOverLife'
  | 'widthOverLength'
  | 'colorOverLength'
  | 'alphaOverLength'
  | 'trailWidthOverLength'
  | 'trailAlphaOverLength';

// The non-curve, non-trail body of an emitter layer (everything the SetLayerField command may patch plus
// the structural fields). Curves and the trail are promoted out so the command paths stay disjoint: a
// life-curve edit goes through the curve commands, a trail-region/spec edit is out of WP-3.7 scope and
// rides verbatim. `name` is the layer's display name (the on-disk array carries it; the model keeps it as
// a value, addressing the layer by EffectLayerId). The emitter's curve fields live in `curves` below.
export interface EmitterLayerBody {
  readonly type: 'emitter';
  readonly name: string;
  readonly maxParticles: number;
  readonly spawn: SpawnConfig;
  readonly shape: EmitterShape;
  readonly lifetime: RangeF;
  readonly startSpeed: RangeF;
  readonly emissionAngle: RangeF;
  readonly startRotation: RangeF;
  readonly angularVelocity: RangeF;
  readonly startScale: RangeF;
  readonly gravity: Vec2;
  readonly acceleration: Vec2;
  readonly drag: number;
  readonly texture: ParticleTexture;
  // The particle trail MINUS its two over-length curves (those are promoted into `curves`); null when the
  // emitter has no trail. Held verbatim so a loaded trail round-trips losslessly (WP-3.7 does not author it).
  readonly trail: Omit<TrailSpec, 'widthOverLength' | 'alphaOverLength'> | null;
}

export interface SpriteAnimatorLayerBody {
  readonly type: 'spriteAnimator';
  readonly name: string;
  readonly region: string;
  readonly anchorSpace: 'world' | 'screen';
  readonly rotationDegPerSec: number;
  readonly loop: boolean;
  readonly layerDuration: number;
}

export interface RibbonTrailLayerBody {
  readonly type: 'ribbonTrail';
  readonly name: string;
  readonly region: string;
  readonly anchorRef: string;
  readonly maxSegments: number;
  readonly segmentSpacing: number;
}

// The body discriminated union: the layer fields that are NOT life curves. The discriminant `type` selects
// the variant exactly as the format layer union does.
export type EffectLayerBody = EmitterLayerBody | SpriteAnimatorLayerBody | RibbonTrailLayerBody;

// An editable effect layer: an internal `id`, its per-layer `blendMode` (reuses the format BlendMode), the
// non-curve `body`, and the layer's life curves keyed by LifeCurveField. The curve set present depends on
// the body type (an emitter has scale/color/alpha over life plus optional trail curves; a sprite animator
// the same three over life; a ribbon trail width/color/alpha over LENGTH); a field absent from the map is
// not applicable to that layer type.
export interface EffectLayerEntity {
  readonly id: EffectLayerId;
  readonly blendMode: BlendMode;
  readonly body: EffectLayerBody;
  readonly curves: ReadonlyMap<LifeCurveField, EffectLifeCurveEntity>;
}

// An editable effect: an internal `id`, the mutable `name` (the on-disk record key), the effect meta
// (duration / deterministic / simulationDt), the effect-level default `blendMode`, an ordered list of
// layer ids (the z order within the effect), and the layers keyed by EffectLayerId. Layer ORDER is the
// stored layerOrder array (exactly as boneOrder accompanies the bones map).
export interface EffectEntity {
  readonly id: EffectId;
  readonly name: string;
  readonly duration: number | null;
  readonly deterministic: boolean;
  readonly simulationDt: number;
  readonly blendMode: BlendMode;
  readonly layerOrder: readonly EffectLayerId[];
  readonly layers: ReadonlyMap<EffectLayerId, EffectLayerEntity>;
}

// An editable bundle item: an internal `id`, the referenced `effect` as an EffectId (NOT a name, so a
// rename never breaks the reference), the relative `startOffset`, the logical `anchorRole`, and the
// integer `seedSalt`.
export interface BundleItemEntity {
  readonly id: BundleItemId;
  readonly effect: EffectId;
  readonly startOffset: number;
  readonly anchorRole: string;
  readonly seedSalt: number;
}

// An editable bundle: a stable EffectId-free identity is NOT minted (bundles are addressed by name, the
// mutable on-disk key, like the skeletal animations record); items carry BundleItemIds and an explicit
// `itemOrder` so reorders and removes are safe under undo/redo interleaving.
export interface BundleEntity {
  readonly name: string;
  readonly itemOrder: readonly BundleItemId[];
  readonly items: ReadonlyMap<BundleItemId, BundleItemEntity>;
}

// The full internal effects-document state. `effects` is keyed by EffectId with an explicit `effectOrder`
// (the on-disk record is name-keyed and order-insignificant, but a stable enumeration order keeps snapshots
// deterministic and lets export emit a stable name-keyed record). `bundles` is keyed by name (the on-disk
// record key, mutable). `atlas` is the VFX atlas (reuses the shared AtlasRef shape). EffectsState is
// immutable to the outside world; its only mutation surface is the EffectsMutator, reachable only from a
// command via History (the structural half of LAW 2, identical to the skeletal model).
export interface EffectsState {
  readonly effectsFormatVersion: string;
  readonly name: string;
  readonly atlas: AtlasRef;
  readonly effectOrder: readonly EffectId[];
  readonly effects: ReadonlyMap<EffectId, EffectEntity>;
  readonly bundleOrder: readonly string[];
  readonly bundles: ReadonlyMap<string, BundleEntity>;
}

// Construct an immutable, deep-frozen life-curve stop. Centralized so the model, commands, and import build
// stops the same way; freezing makes a stop safe to share by reference everywhere (it is never mutated in
// place; a curve replaces its stops wholesale).
export function makeLifeStop(
  id: LifeStopId,
  t: number,
  value: LifeStopValue,
  curve: CurveType,
): EffectLifeStopEntity {
  return Object.freeze({
    id,
    t,
    value: typeof value === 'number' ? value : Object.freeze(cloneLifeStopValue(value)),
    curve: typeof curve === 'string' ? curve : Object.freeze(cloneEffectsCurve(curve)),
  });
}

// A fresh, empty effects state at the current effects-format version: no effects, no bundles, an empty
// atlas. SetEffectsAtlas, CreateEffect, and CreateBundle populate it through commands.
export function newEffectsState(effectsFormatVersion: string, name: string): EffectsState {
  return {
    effectsFormatVersion,
    name,
    atlas: { pages: [] },
    effectOrder: [],
    effects: new Map(),
    bundleOrder: [],
    bundles: new Map(),
  };
}
