import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import type { Animation, AtlasRef, Skin, Slot, TransformMode } from '@marionette/format/types';
import type { BoneId } from './ids';

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

// Phase-0 preserved content: the non-bone document body (slots, skins, animations, atlas) is held as
// verbatim format values and round-tripped unchanged. Phase 0 has no commands that mutate them, and no
// tested path renames a slot-referenced bone, so name references stay valid through load and export.
// Phase 1 promotes these to id-keyed entities when their commands land (LAW 5, command-history 3.1).
export interface PreservedContent {
  readonly slots: readonly Slot[];
  readonly skins: readonly Skin[];
  readonly animations: Readonly<Record<string, Animation>>;
  readonly atlas: AtlasRef;
}

// The full internal document state. Bones are the only editable, id-keyed collection in Phase 0;
// `boneOrder` keeps parents before children (the format invariant). DocState is immutable to the
// outside world: its only mutation surface is the Mutator, reachable only from inside a command.
export interface DocState {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: ReadonlyMap<BoneId, BoneEntity>;
  readonly boneOrder: readonly BoneId[];
  readonly preserved: PreservedContent;
}

// A new, empty document body: one default skin (the format requires it on export), no slots,
// animations, or atlas pages. Bones start empty; the first CreateBone adds the root. Export is not
// valid until at least one bone exists (the format requires bones.length >= 1), which the Phase 0
// flow satisfies by creating a bone before saving.
export function emptyPreservedContent(): PreservedContent {
  return {
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {},
    atlas: { pages: [] },
  };
}

// A fresh, empty document state at the current format version: no bones yet (the first CreateBone adds
// the root), a default skin, no slots/animations/atlas. Export stays invalid until a bone exists (the
// format requires bones.length >= 1), which the Phase 0 flow satisfies before saving.
export function newDocState(name: string): DocState {
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name,
    bones: new Map(),
    boneOrder: [],
    preserved: emptyPreservedContent(),
  };
}
