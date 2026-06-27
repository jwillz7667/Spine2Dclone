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
