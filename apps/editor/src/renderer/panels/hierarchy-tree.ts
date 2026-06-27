import type { BoneGeometry } from '../document';

// Pure tree-building and reparent-validation logic for the bone hierarchy panel (WP-1.1). The panel
// (hierarchy-panel.tsx) is thin glue over commands plus the ephemeral selection store; every DECISION
// worth a test lives here as a pure function with no React, no document access, and no side effects.
// This is the house convention (mirror animation-manager.ts): the editor vitest environment is `node`,
// so the logic is unit-tested here and the .tsx is covered by typecheck and lint. Ids stay generic
// (TId extends string) so the helpers are branded-id agnostic: the panel passes BoneId values (which
// are assignable to string), the tests pass plain strings.

// The parent link every helper here reads: a bone id and its parent id (or null for a root). The read
// model's BoneEntity is structurally assignable to this, and tests pass plain { id, parent } objects.
export interface HierarchyLink<TId extends string = string> {
  readonly id: TId;
  readonly parent: TId | null;
}

// A bone plus the name the tree renders. The read model's BoneEntity is assignable to this too.
export interface HierarchyBone<TId extends string = string> extends HierarchyLink<TId> {
  readonly name: string;
}

// One rendered tree row: the bone id, its display name, and its depth from the root (roots are depth 0).
export interface HierarchyRow<TId extends string = string> {
  readonly id: TId;
  readonly name: string;
  readonly depth: number;
}

// A small default length for a bone created from the tree, which (unlike the create-by-drag viewport
// tool that derives length from the pointer) has no gesture to size it. This is an editor UX default,
// NOT a format constant (the validator never reads it); the user can change it in the inspector later.
export const DEFAULT_TREE_BONE_LENGTH = 32;

// The setup geometry for a bone created from the tree. Mirrors create-bone-tool.ts: an identity setup
// transform (local origin, no rotation, unit scale, no shear, normal transform mode) with a small
// default length. The caller mints the BoneId and passes it as `name` so the export-time
// name-uniqueness contract (D9) holds without a counter that could collide after undo/redo or deletes.
export function treeBoneGeometry(name: string): BoneGeometry {
  return {
    name,
    length: DEFAULT_TREE_BONE_LENGTH,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
  };
}

// Flatten bones (in boneOrder, parents before children, an invariant the read model guarantees) into a
// pre-order render list annotated with depth: each parent is emitted immediately before its subtree,
// siblings keep their boneOrder relative order, and depth is the length of the parent chain (roots are
// 0). boneOrder guarantees parents precede children but NOT that a subtree is contiguous, so a
// depth-first pass over a parent->children index is required to produce a stable, contiguous pre-order.
export function buildHierarchyRows<TId extends string>(
  bones: readonly HierarchyBone<TId>[],
): readonly HierarchyRow<TId>[] {
  const childrenOf = new Map<TId | null, HierarchyBone<TId>[]>();
  for (const bone of bones) {
    const siblings = childrenOf.get(bone.parent);
    if (siblings) siblings.push(bone);
    else childrenOf.set(bone.parent, [bone]);
  }
  const rows: HierarchyRow<TId>[] = [];
  const visit = (bone: HierarchyBone<TId>, depth: number): void => {
    rows.push({ id: bone.id, name: bone.name, depth });
    for (const child of childrenOf.get(bone.id) ?? []) visit(child, depth + 1);
  };
  for (const root of childrenOf.get(null) ?? []) visit(root, 0);
  return rows;
}

// True when maybeDescendantId is a STRICT descendant of ancestorId: walk up the parent chain from
// maybeDescendantId and report a hit on ancestorId. A bone is never its own descendant, so
// isDescendant(bones, X, X) is false. This mirrors the command's cycle walk
// (reparent-bone.command.ts wouldCycle), so the UI pre-check agrees with the authoritative guard.
export function isDescendant<TId extends string>(
  bones: readonly HierarchyLink<TId>[],
  ancestorId: TId,
  maybeDescendantId: TId,
): boolean {
  const parentOf = new Map<TId, TId | null>(
    bones.map((bone): [TId, TId | null] => [bone.id, bone.parent]),
  );
  let cursor = parentOf.get(maybeDescendantId) ?? null;
  while (cursor !== null) {
    if (cursor === ancestorId) return true;
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

// Whether dragging `draggedId` onto `newParentId` is a legal reparent, mirroring ReparentBoneCommand's
// cycle guard so the UI can disable an invalid drop BEFORE dispatching (the command stays the authority
// and still throws ReparentCycleError if asked anyway). Reparenting to a root (newParentId === null) is
// always allowed. A drop is invalid only when the new parent IS the dragged bone or one of its
// descendants (which would make the dragged bone its own ancestor).
export function canReparent<TId extends string>(
  bones: readonly HierarchyLink<TId>[],
  draggedId: TId,
  newParentId: TId | null,
): boolean {
  if (newParentId === null) return true;
  if (newParentId === draggedId) return false;
  return !isDescendant(bones, draggedId, newParentId);
}
