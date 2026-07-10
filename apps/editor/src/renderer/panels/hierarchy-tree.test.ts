import { describe, expect, it } from 'vitest';
import {
  ALL_KINDS_VISIBLE,
  DEFAULT_SKIN_NAME,
  DEFAULT_TREE_BONE_LENGTH,
  buildConstraintNodes,
  buildHierarchyRows,
  buildSkeletonTree,
  buildSkinNodes,
  canReparent,
  filterSectionNodes,
  filterSkeletonTree,
  isDescendant,
  isNodeSelected,
  nodeSelectionTarget,
  treeBoneGeometry,
  type HierarchyBone,
  type HierarchyFilter,
  type HierarchyNode,
  type HierarchySelectionState,
  type HierarchySlot,
} from './hierarchy-tree';

// A two-level rig whose subtrees are deliberately NOT contiguous in boneOrder: 'childA1' (under
// 'childA') is the LAST entry even though 'childB' (a sibling of 'childA') comes before it. boneOrder
// still honors parents-before-children, so this exercises the pre-order reconstruction (a naive flat
// pass would emit childB between childA and childA1; the tree must keep the subtree contiguous).
const RIG: readonly HierarchyBone[] = [
  { id: 'root', name: 'root', parent: null },
  { id: 'childA', name: 'childA', parent: 'root' },
  { id: 'childB', name: 'childB', parent: 'root' },
  { id: 'childA1', name: 'childA1', parent: 'childA' },
];

describe('buildHierarchyRows', () => {
  it('emits a contiguous pre-order with depth from the parent chain', () => {
    const rows = buildHierarchyRows(RIG);

    expect(rows.map((row) => row.id)).toEqual(['root', 'childA', 'childA1', 'childB']);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1]);
  });

  it('returns an empty list when there are no bones', () => {
    expect(buildHierarchyRows<string>([])).toEqual([]);
  });

  it('emits multiple roots in their boneOrder', () => {
    const rows = buildHierarchyRows([
      { id: 'r1', name: 'r1', parent: null },
      { id: 'r2', name: 'r2', parent: null },
    ]);

    expect(rows.map((row) => row.id)).toEqual(['r1', 'r2']);
    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });
});

describe('isDescendant', () => {
  it('is true down the chain, both directly and transitively', () => {
    expect(isDescendant(RIG, 'root', 'childA')).toBe(true);
    expect(isDescendant(RIG, 'root', 'childA1')).toBe(true);
    expect(isDescendant(RIG, 'childA', 'childA1')).toBe(true);
  });

  it('is false up the chain and across sibling branches', () => {
    expect(isDescendant(RIG, 'childA1', 'root')).toBe(false);
    expect(isDescendant(RIG, 'childB', 'childA1')).toBe(false);
  });

  it('is false for a bone measured against itself (strict)', () => {
    expect(isDescendant(RIG, 'childA', 'childA')).toBe(false);
  });
});

describe('canReparent', () => {
  it('always allows reparenting to a root (null parent)', () => {
    expect(canReparent(RIG, 'childA1', null)).toBe(true);
    expect(canReparent(RIG, 'root', null)).toBe(true);
  });

  it('allows a valid move onto a non-descendant', () => {
    expect(canReparent(RIG, 'childA', 'childB')).toBe(true);
    expect(canReparent(RIG, 'childA1', 'root')).toBe(true);
  });

  it('rejects dropping a bone onto itself', () => {
    expect(canReparent(RIG, 'childA', 'childA')).toBe(false);
  });

  it('rejects dropping a bone onto one of its descendants', () => {
    expect(canReparent(RIG, 'childA', 'childA1')).toBe(false);
    expect(canReparent(RIG, 'root', 'childA1')).toBe(false);
  });
});

describe('treeBoneGeometry', () => {
  it('builds an identity setup transform with the default length and the given name', () => {
    const geom = treeBoneGeometry('bone_7');

    expect(geom).toEqual({
      name: 'bone_7',
      length: DEFAULT_TREE_BONE_LENGTH,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    });
  });
});

// Bones root -> arm; slot 'body' rides root, slot 'hand' rides arm. Exercises slot nesting under bones.
const SLOTS: readonly HierarchySlot[] = [
  { id: 'body', name: 'body', bone: 'root' },
  { id: 'hand', name: 'hand', bone: 'arm' },
];
const RIG2: readonly HierarchyBone[] = [
  { id: 'root', name: 'root', parent: null },
  { id: 'arm', name: 'arm', parent: 'root' },
];

const allVisible: HierarchyFilter = { query: '', kinds: ALL_KINDS_VISIBLE };

describe('buildSkeletonTree', () => {
  it('nests each slot under its riding bone at depth + 1', () => {
    const nodes = buildSkeletonTree(RIG2, SLOTS);

    expect(nodes.map((n) => [n.kind, n.id, n.depth])).toEqual([
      ['bone', 'root', 0],
      ['slot', 'body', 1],
      ['bone', 'arm', 1],
      ['slot', 'hand', 2],
    ]);
    // A slot node carries the id of the bone it rides.
    expect(nodes.find((n) => n.id === 'body')!.boneId).toBe('root');
  });

  it('emits a bone with no slots and no slots for a childless-of-slots bone', () => {
    const nodes = buildSkeletonTree([{ id: 'root', name: 'root', parent: null }], []);
    expect(nodes.map((n) => n.kind)).toEqual(['bone']);
  });
});

describe('buildConstraintNodes', () => {
  it('lists the four constraint kinds in ik, transform, path, physics order', () => {
    const nodes = buildConstraintNodes({
      ik: [{ id: 'ik1', name: 'limb-ik' }],
      transform: [{ id: 'tc1', name: 'follow' }],
      path: [{ id: 'pc1', name: 'rail' }],
      physics: [{ id: 'phy1', name: 'jiggle' }],
    });

    expect(nodes.map((n) => [n.kind, n.name])).toEqual([
      ['ik', 'limb-ik'],
      ['transform', 'follow'],
      ['path', 'rail'],
      ['physics', 'jiggle'],
    ]);
  });
});

describe('buildSkinNodes', () => {
  it('lists the implicit default skin first, then named skins keyed by name', () => {
    const nodes = buildSkinNodes([
      { id: 'skin_2', name: 'variant' },
      { id: 'skin_3', name: 'gold' },
    ]);

    expect(nodes.map((n) => n.id)).toEqual([DEFAULT_SKIN_NAME, 'variant', 'gold']);
    // A skin node's id IS its name (the preview store keys on the name).
    expect(nodes.every((n) => n.kind === 'skin' && n.id === n.name)).toBe(true);
  });
});

describe('filterSkeletonTree', () => {
  const tree = buildSkeletonTree(RIG2, SLOTS);

  it('returns the whole tree for an empty query with all kinds visible', () => {
    expect(filterSkeletonTree(tree, allVisible)).toEqual(tree);
  });

  it('keeps a matching slot and its parent bone for context', () => {
    const result = filterSkeletonTree(tree, { query: 'hand', kinds: ALL_KINDS_VISIBLE });
    // 'hand' rides 'arm', so both survive; 'root'/'body' drop.
    expect(result.map((n) => n.id)).toEqual(['arm', 'hand']);
  });

  it('matches bone names case-insensitively and drops non-matching subtrees', () => {
    const result = filterSkeletonTree(tree, { query: 'ROOT', kinds: ALL_KINDS_VISIBLE });
    expect(result.map((n) => n.id)).toEqual(['root', 'body']);
  });

  it('hides slots when the slots kind is disabled', () => {
    const result = filterSkeletonTree(tree, {
      query: '',
      kinds: { bones: true, slots: false, constraints: true, skins: true },
    });
    expect(result.every((n) => n.kind === 'bone')).toBe(true);
    expect(result.map((n) => n.id)).toEqual(['root', 'arm']);
  });

  it('drops a bone entirely when neither it nor its slots match', () => {
    const result = filterSkeletonTree(tree, { query: 'zzz', kinds: ALL_KINDS_VISIBLE });
    expect(result).toEqual([]);
  });
});

describe('filterSectionNodes', () => {
  const constraintNodes: readonly HierarchyNode[] = buildConstraintNodes({
    ik: [{ id: 'ik1', name: 'limb-ik' }],
    transform: [{ id: 'tc1', name: 'follow' }],
    path: [],
    physics: [{ id: 'phy1', name: 'tail-jiggle' }],
  });

  it('keeps only name matches within the section', () => {
    const result = filterSectionNodes(constraintNodes, {
      query: 'jiggle',
      kinds: ALL_KINDS_VISIBLE,
    });
    expect(result.map((n) => n.name)).toEqual(['tail-jiggle']);
  });

  it('drops the whole section when the constraints kind is disabled', () => {
    const result = filterSectionNodes(constraintNodes, {
      query: '',
      kinds: { bones: true, slots: true, constraints: false, skins: true },
    });
    expect(result).toEqual([]);
  });

  it('drops skin nodes when the skins kind is disabled', () => {
    const skinNodes = buildSkinNodes([{ id: 'skin_2', name: 'variant' }]);
    const result = filterSectionNodes(skinNodes, {
      query: '',
      kinds: { bones: true, slots: true, constraints: true, skins: false },
    });
    expect(result).toEqual([]);
  });
});

describe('nodeSelectionTarget', () => {
  const node = (kind: HierarchyNode['kind'], id: string): HierarchyNode => ({
    kind,
    id,
    name: id,
    depth: 0,
    boneId: null,
  });

  it('routes each node kind to its store target', () => {
    expect(nodeSelectionTarget(node('bone', 'b1'))).toEqual({ target: 'bone', id: 'b1' });
    expect(nodeSelectionTarget(node('slot', 's1'))).toEqual({ target: 'slot', id: 's1' });
    // Constraints keep their kind tag (the constraint store is tagged by kind).
    expect(nodeSelectionTarget(node('ik', 'ik1'))).toEqual({
      target: 'constraint',
      kind: 'ik',
      id: 'ik1',
    });
    expect(nodeSelectionTarget(node('physics', 'phy1'))).toEqual({
      target: 'constraint',
      kind: 'physics',
      id: 'phy1',
    });
    // A skin node's id IS its name (the preview store keys on the name).
    expect(nodeSelectionTarget(node('skin', 'variant'))).toEqual({
      target: 'skin',
      name: 'variant',
    });
  });
});

describe('isNodeSelected', () => {
  const node = (kind: HierarchyNode['kind'], id: string): HierarchyNode => ({
    kind,
    id,
    name: id,
    depth: 0,
    boneId: null,
  });
  const selection: HierarchySelectionState = {
    boneIds: new Set(['b1']),
    slotId: 's1',
    constraintKind: 'transform',
    constraintId: 'tc1',
    activeSkin: 'variant',
  };

  it('matches a bone against the bone selection set', () => {
    expect(isNodeSelected(node('bone', 'b1'), selection)).toBe(true);
    expect(isNodeSelected(node('bone', 'b2'), selection)).toBe(false);
  });

  it('matches a slot against the single slot selection', () => {
    expect(isNodeSelected(node('slot', 's1'), selection)).toBe(true);
    expect(isNodeSelected(node('slot', 's2'), selection)).toBe(false);
  });

  it('matches a constraint only when BOTH kind and id agree', () => {
    expect(isNodeSelected(node('transform', 'tc1'), selection)).toBe(true);
    // Same id, wrong kind: not selected (kinds share no id namespace but the tag disambiguates).
    expect(isNodeSelected(node('ik', 'tc1'), selection)).toBe(false);
    expect(isNodeSelected(node('transform', 'tc2'), selection)).toBe(false);
  });

  it('matches a skin against the active preview name', () => {
    expect(isNodeSelected(node('skin', 'variant'), selection)).toBe(true);
    expect(isNodeSelected(node('skin', 'default'), selection)).toBe(false);
  });
});
