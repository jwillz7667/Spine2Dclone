// Stable, opaque, branded internal identity (command-history Section 2, decision D2). The model
// addresses every entity by an Id minted at creation; names are mutable attributes, never identities.
// IDs are an internal concern: they are NOT serialized into the format (the format references entities
// by name), so a rename is a single-field change with zero cascade and commands stay valid across an
// unrelated rename or reorder.

declare const ID_BRAND: unique symbol;

// A branded string. `K` keeps id kinds from colliding structurally (a BoneId is not a SlotId), without
// any `any`. The brand is phantom: it exists only in the type system, never at runtime.
export type Id<K extends string> = string & { readonly [ID_BRAND]: K };

// Phase 0 needs only bone identity. Other id brands (AnimationId, KeyframeId, ...) are declared by the
// phase whose entities they address (LAW 5), not pre-scaffolded here.
export type BoneId = Id<'bone'>;

// Phase 1 (WP-1.2) promotes slots to id-keyed entities. A SlotEntity is addressed by SlotId, never by
// name or draw-order index, so a rename or reorder never invalidates a captured command (command-
// history Section 2). Attachments carry no id of their own; they are addressed by (SlotId, name).
export type SlotId = Id<'slot'>;

// Phase 1 (WP-1.5) promotes animations and their keyframes to id-keyed entities. An AnimationEntity is
// addressed by AnimationId (never by its name, which is the on-disk record key and is mutable), and a
// KeyframeEntity by KeyframeId. Addressing a keyframe by id is load-bearing: an array index goes stale
// the instant a sibling keyframe is inserted or deleted, so commands target keyframes by KeyframeId and
// keep the channel array time-sorted as an invariant (command-history Section 2).
export type AnimationId = Id<'animation'>;
export type KeyframeId = Id<'keyframe'>;

// Phase 2 promotes constraints and named skins to id-keyed editable entities. An IkConstraintEntity is
// addressed by IkConstraintId and a TransformConstraintEntity by TransformConstraintId (never by name,
// the mutable on-disk key), so a constraint rename or a sibling delete never invalidates a captured
// command. A SkinEntity (a NON-default named skin) is addressed by SkinId; the implicit 'default' skin is
// materialized from the editable attachments and carries no SkinId. Constraint solve order is the stored
// array order (ADR-0003), so the model keeps an explicit id order alongside the id-keyed map, exactly as
// boneOrder accompanies the bones map.
export type IkConstraintId = Id<'ikConstraint'>;
export type TransformConstraintId = Id<'transformConstraint'>;
// Stage F3 (ADR-0011, formatVersion 0.5.0) promotes path constraints to id-keyed editable entities (PP-D11).
// A PathConstraintEntity is addressed by PathConstraintId, never by name (the mutable on-disk key), so a
// constraint rename or a sibling delete never invalidates a captured command. Path constraints share the
// single combined solve-order space with IK and transform (ADR-0011 section 2.3), so the model keeps an
// explicit id order alongside the id-keyed map, exactly as the ik/transform orders accompany their maps.
export type PathConstraintId = Id<'pathConstraint'>;
export type SkinId = Id<'skin'>;

// Stage F1 (ADR-0008, formatVersion 0.3.0) promotes document-level event definitions to id-keyed
// editable entities (PP-D9). An EventDefEntity is addressed by EventDefId, never by its name (the mutable
// on-disk identity), so a rename is a single-field change with zero cascade and an animation's event keys
// (which reference the definition by EventDefId, not name) survive it. Event keys and draw-order keys are
// per-animation timeline entries addressed by KeyframeId, like every other keyed timeline (a sibling
// insert/delete never invalidates a captured command).
export type EventDefId = Id<'eventDef'>;

// Phase 3 (WP-3.7) promotes the EffectsDocument entities to id-keyed editable entities (the realized
// form of the EmitterId placeholder reserved in command-history Section 2). An EffectEntity is addressed
// by EffectId (never by its name, the mutable on-disk record key), an EffectLayerEntity by EffectLayerId
// (never by array index, which goes stale on a sibling insert/reorder), a life-curve stop by LifeStopId,
// and an EffectBundle's item by BundleItemId. RenameEffect is a single-field change with ZERO cascade
// because a bundle item references an EffectId, not the name (phase-3 section 8.1.1). IDs are minted at
// import from the on-disk names/array order, are internal-only, and are NEVER serialized into the
// EffectsDocument; export resolves them back to names and re-emits arrays in their preserved order.
export type EffectId = Id<'effect'>;
export type EffectLayerId = Id<'effectLayer'>;
export type LifeStopId = Id<'lifeStop'>;
export type BundleItemId = Id<'bundleItem'>;

// IDs are minted by a single injected generator (no hidden global; dependency injection per house
// rules). The counter is per-Document and monotonic, so ids are unique within a document and
// deterministic given a fixed mint order (which makes load-path tests reproducible).
export interface IdFactory {
  mint<K extends string>(kind: K): Id<K>;
}

// Construct a fresh, per-Document monotonic id factory. The `${kind}_${n}` shape is opaque to callers;
// nothing parses it. The single cast brands the generated string and is the documented brand
// construction the no-`any`/no-unjustified-`as` rule explicitly permits.
export function makeIdFactory(): IdFactory {
  let counter = 0;
  return {
    mint<K extends string>(kind: K): Id<K> {
      counter += 1;
      return `${kind}_${counter}` as Id<K>;
    },
  };
}
