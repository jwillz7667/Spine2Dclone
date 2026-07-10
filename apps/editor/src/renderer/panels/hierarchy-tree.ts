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

// ----- Hierarchy tree completeness (PP-D7): slot, constraint, and skin nodes -----
// The tree centered on bones; PP-D7 folds in the rest of the rig so one panel navigates the whole
// document. The pure builders below produce flat, depth-annotated node lists (the same shape as
// buildHierarchyRows) that the panel renders and that drive the existing ephemeral selection stores.
// Everything here stays React-free and document-access-free (branded ids arrive as plain strings), so it
// is unit-tested in isolation exactly like buildHierarchyRows/canReparent.

// The kinds of node the tree can show. Constraints keep their four sub-kinds so a node carries enough to
// route selection to the tagged constraint-selection store; 'skin' covers the implicit default and named
// skins alike (the skin preview is keyed by NAME, which the node carries).
export type HierarchyNodeKind = 'bone' | 'slot' | 'ik' | 'transform' | 'path' | 'physics' | 'skin';

// One rendered node in the completed tree: its kind, the entity id (or the skin NAME for a skin node,
// which is what the preview store consumes), the display name, the indentation depth, and (for a slot) the
// id of the bone it rides so the panel can group and the pure filter can keep a context bone visible.
export interface HierarchyNode<TId extends string = string> {
  readonly kind: HierarchyNodeKind;
  readonly id: TId;
  readonly name: string;
  readonly depth: number;
  readonly boneId: TId | null;
}

// A slot as the tree reads it: its id, display name, and the bone it rides. SlotEntity is structurally
// assignable to this (tests pass plain objects).
export interface HierarchySlot<TId extends string = string> {
  readonly id: TId;
  readonly name: string;
  readonly bone: TId;
}

// A named entity the tree lists flat (a constraint or a skin): id + display name. The constraint/skin read
// entities are structurally assignable (tests pass plain objects).
export interface HierarchyNamed<TId extends string = string> {
  readonly id: TId;
  readonly name: string;
}

// The four constraint arrays in solve/read order, each carrying its node kind.
export interface HierarchyConstraints<TId extends string = string> {
  readonly ik: readonly HierarchyNamed<TId>[];
  readonly transform: readonly HierarchyNamed<TId>[];
  readonly path: readonly HierarchyNamed<TId>[];
  readonly physics: readonly HierarchyNamed<TId>[];
}

// The always-present default skin's name (mirrors runtime-core DEFAULT_SKIN_NAME). A skin node's id IS the
// skin name because the preview store keys on the name; the default skin has no SkinId, so the literal is
// its stable identity in the tree.
export const DEFAULT_SKIN_NAME = 'default';

// Build the skeletal tree: every bone in pre-order (buildHierarchyRows), with each bone's riding slots
// emitted immediately after it at depth + 1. Slots ride bones by BoneId, so a slot follows its bone
// regardless of draw order; slots are listed in the order given (the panel passes them in slotOrder).
export function buildSkeletonTree<TId extends string>(
  bones: readonly HierarchyBone<TId>[],
  slots: readonly HierarchySlot<TId>[],
): readonly HierarchyNode<TId>[] {
  const slotsByBone = new Map<TId, HierarchySlot<TId>[]>();
  for (const slot of slots) {
    const list = slotsByBone.get(slot.bone);
    if (list) list.push(slot);
    else slotsByBone.set(slot.bone, [slot]);
  }
  const out: HierarchyNode<TId>[] = [];
  for (const row of buildHierarchyRows(bones)) {
    out.push({ kind: 'bone', id: row.id, name: row.name, depth: row.depth, boneId: null });
    for (const slot of slotsByBone.get(row.id) ?? []) {
      out.push({
        kind: 'slot',
        id: slot.id,
        name: slot.name,
        depth: row.depth + 1,
        boneId: row.id,
      });
    }
  }
  return out;
}

// Build the flat constraint node list (all four kinds, in ik -> transform -> path -> physics order, the
// combined solve order). All at depth 0 (the panel renders them under a section header).
export function buildConstraintNodes<TId extends string>(
  constraints: HierarchyConstraints<TId>,
): readonly HierarchyNode<TId>[] {
  const out: HierarchyNode<TId>[] = [];
  const push = (kind: HierarchyNodeKind, list: readonly HierarchyNamed<TId>[]): void => {
    for (const c of list) out.push({ kind, id: c.id, name: c.name, depth: 0, boneId: null });
  };
  push('ik', constraints.ik);
  push('transform', constraints.transform);
  push('path', constraints.path);
  push('physics', constraints.physics);
  return out;
}

// Build the flat skin node list: the implicit default skin first (its id is its name, DEFAULT_SKIN_NAME),
// then each named skin in the order given (skinOrder). A skin node's id is the skin NAME because the skin
// preview store keys on the name.
export function buildSkinNodes<TId extends string>(
  skins: readonly HierarchyNamed<TId>[],
): readonly HierarchyNode<string>[] {
  const out: HierarchyNode<string>[] = [
    { kind: 'skin', id: DEFAULT_SKIN_NAME, name: DEFAULT_SKIN_NAME, depth: 0, boneId: null },
  ];
  for (const skin of skins) {
    out.push({ kind: 'skin', id: skin.name, name: skin.name, depth: 0, boneId: null });
  }
  return out;
}

// Which categories of node the tree shows (the kind filter's four checkboxes). Constraints collapse the
// four constraint kinds into one toggle.
export interface HierarchyKindFilter {
  readonly bones: boolean;
  readonly slots: boolean;
  readonly constraints: boolean;
  readonly skins: boolean;
}

// The find/filter state: a name substring (case-insensitive; empty matches everything) plus the kind
// toggles. Both are ephemeral editor state; this module only interprets them.
export interface HierarchyFilter {
  readonly query: string;
  readonly kinds: HierarchyKindFilter;
}

// Every kind visible: the default filter with an empty query (matches everything).
export const ALL_KINDS_VISIBLE: HierarchyKindFilter = {
  bones: true,
  slots: true,
  constraints: true,
  skins: true,
};

// Map a node kind to the kind-filter category that gates it.
function categoryEnabled(kind: HierarchyNodeKind, kinds: HierarchyKindFilter): boolean {
  switch (kind) {
    case 'bone':
      return kinds.bones;
    case 'slot':
      return kinds.slots;
    case 'skin':
      return kinds.skins;
    default:
      return kinds.constraints;
  }
}

// Case-insensitive substring match; an empty (trimmed) query matches everything.
function nameMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || name.toLowerCase().includes(q);
}

// Filter the skeletal tree (bones + their slots). Two directions of context keep the tree navigable: a
// matching SLOT keeps its parent bone visible, and a matching BONE reveals its slots (its content). So a
// slot is kept when slots are an enabled kind and (its name matches OR its bone matches); a bone is kept
// when it matches itself (bones enabled + name matches) OR it has a kept slot. Slots are contiguous after
// their bone in buildSkeletonTree output, so one forward pass groups them.
export function filterSkeletonTree<TId extends string>(
  nodes: readonly HierarchyNode<TId>[],
  filter: HierarchyFilter,
): readonly HierarchyNode<TId>[] {
  const out: HierarchyNode<TId>[] = [];
  let i = 0;
  while (i < nodes.length) {
    const bone = nodes[i];
    if (!bone || bone.kind !== 'bone') {
      i += 1;
      continue;
    }
    const boneMatches = filter.kinds.bones && nameMatches(bone.name, filter.query);
    let j = i + 1;
    const keptSlots: HierarchyNode<TId>[] = [];
    while (j < nodes.length && nodes[j]!.kind === 'slot') {
      const slot = nodes[j]!;
      if (filter.kinds.slots && (boneMatches || nameMatches(slot.name, filter.query))) {
        keptSlots.push(slot);
      }
      j += 1;
    }
    if (boneMatches || keptSlots.length > 0) {
      out.push(bone);
      for (const slot of keptSlots) out.push(slot);
    }
    i = j;
  }
  return out;
}

// Filter a flat section (constraints or skins): keep a node when its category is enabled and its name
// matches. Used for the constraint and skin sections, which carry no parent/child relationship.
export function filterSectionNodes<TId extends string>(
  nodes: readonly HierarchyNode<TId>[],
  filter: HierarchyFilter,
): readonly HierarchyNode<TId>[] {
  return nodes.filter(
    (node) => categoryEnabled(node.kind, filter.kinds) && nameMatches(node.name, filter.query),
  );
}
