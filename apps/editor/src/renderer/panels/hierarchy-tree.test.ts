import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TREE_BONE_LENGTH,
  buildHierarchyRows,
  canReparent,
  isDescendant,
  treeBoneGeometry,
  type HierarchyBone,
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
