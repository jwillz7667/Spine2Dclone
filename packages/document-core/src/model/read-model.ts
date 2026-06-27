import type { TransformMode } from '@marionette/format/types';
import type { PreservedContent } from './doc-state';
import type { BoneEntity } from './doc-state';
import type { BoneId } from './ids';

// The public read surface given to the UI and to commands (command-history Section 3.2). Every
// accessor returns a frozen value copy or a readonly view; no accessor leaks a handle that can mutate
// the model. The only write surface is the Mutator (model/mutator.ts), reachable only from History.
export interface DocumentReadModel {
  // Bumps on every applied mutation (discrete or in-batch). The single source of "something changed".
  readonly revision: number;
  // The document name (a format field; shown in the UI title and resolved at export).
  readonly name: string;
  getBone(id: BoneId): BoneEntity | undefined;
  bones(): readonly BoneEntity[]; // in boneOrder
  // First bone in boneOrder whose name matches, or undefined (command-history D9). Never throws;
  // names are not internally unique, so this is first-match by design.
  findBoneByName(name: string): BoneEntity | undefined;
  // The preserved (non-bone) document body, read-only. Phase 0 holds it verbatim.
  preserved(): PreservedContent;
  // Canonical, deterministically-ordered, deep-equality-comparable projection (includes internal ids).
  snapshot(): DocSnapshot;
}

// A plain, JSON-serializable bone projection for snapshots (internal id included).
export interface BoneSnapshot {
  readonly id: string;
  readonly name: string;
  readonly parent: string | null;
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

// The full internal-state projection the round-trip harness deep-compares (command-history Section
// 3.4). Maps serialize as arrays sorted by id; order-significant arrays (boneOrder) preserve order;
// numbers are verbatim (undo restores stored mementos, so the round-trip is bit-exact, no epsilon).
export interface DocSnapshot {
  readonly formatVersion: string;
  readonly name: string;
  readonly bones: readonly BoneSnapshot[]; // sorted by id
  readonly boneOrder: readonly string[]; // order-significant
  readonly preserved: PreservedContent; // verbatim (already deeply immutable)
}

// Project a bone entity to its snapshot shape (a plain value copy).
export function boneToSnapshot(bone: BoneEntity): BoneSnapshot {
  return {
    id: bone.id,
    name: bone.name,
    parent: bone.parent,
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  };
}
