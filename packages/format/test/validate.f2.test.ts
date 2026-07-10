import { describe, expect, it } from 'vitest';
import type { SkeletonDocument } from '../src/schema/document';
import type { IkConstraint } from '../src/schema/constraint';
import { validateDocument } from '../src/validate';
import type { FormatErrorCode } from '../src/validate/errors';
import { cloneMinimal } from './helpers';

// Stage F2 (ADR-0009): constraint depth and order, linked meshes, sequence attachments, timeline
// granularity, and skin scoping. Each test isolates one behavior; hashes are not managed here
// (verifyHash: false) so the structural and semantic layers run regardless.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

function codes(doc: SkeletonDocument): FormatErrorCode[] {
  return validateDocument(doc, { verifyHash: false }).errors.map((error) => error.code);
}

function ik(name: string, over: Partial<IkConstraint> = {}): IkConstraint {
  return {
    name,
    bones: ['root'],
    target: 'root',
    mix: 1,
    bend: 1,
    softness: 0,
    stretch: false,
    compress: false,
    uniform: false,
    ...over,
  };
}

// cloneMinimal has one slot `body` (region `body`); add a `limb` slot carrying a mesh and a linked mesh
// that reuses its geometry, plus the atlas regions they reference.
function withLinkedMesh(): SkeletonDocument {
  const doc = cloneMinimal();
  doc.slots.push({
    name: 'limb',
    bone: 'root',
    color: WHITE,
    attachment: 'baseMesh',
    blendMode: 'normal',
  });
  doc.skins[0]!.attachments['limb'] = {
    baseMesh: {
      type: 'mesh',
      path: 'baseRegion',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      color: WHITE,
      vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
    },
    dst: {
      type: 'linkedmesh',
      path: 'linkedRegion',
      parent: 'baseMesh',
      timelines: false,
      width: 64,
      height: 64,
      color: WHITE,
    },
  };
  const region = (name: string, x: number) => ({
    name,
    x,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  });
  doc.atlas.pages[0]!.regions.push(region('baseRegion', 64), region('linkedRegion', 128));
  return doc;
}

describe('constraint depth and order (ADR-0009 section 1)', () => {
  it('accepts IK softness/stretch/compress/uniform and a signed bend', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('ik', { softness: 8, stretch: true, uniform: true, bend: -1 }));
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('IK_SOFTNESS_RANGE for a negative softness (structural)', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('ik', { softness: -1 }));
    expect(codes(doc)).toEqual(['IK_SOFTNESS_RANGE']);
  });

  it('accepts a dense, unique order across both constraint arrays', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('a', { order: 0 }), ik('b', { order: 1 }));
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('accepts order omitted everywhere (default document order)', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('a'), ik('b'));
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('CONSTRAINT_ORDER_INVALID when order is set on some constraints but not all', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('a', { order: 0 }), ik('b'));
    expect(codes(doc)).toEqual(['CONSTRAINT_ORDER_INVALID']);
  });

  it('CONSTRAINT_ORDER_INVALID for a duplicated (non-dense) order', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('a', { order: 0 }), ik('b', { order: 0 }));
    expect(codes(doc)).toContain('CONSTRAINT_ORDER_INVALID');
  });
});

describe('linked meshes (ADR-0009 section 2)', () => {
  it('accepts a linked mesh that reuses a parent mesh', () => {
    expect(validateDocument(withLinkedMesh(), { verifyHash: false }).ok).toBe(true);
  });

  it('LINKED_MESH_PARENT_MISSING when the parent does not resolve', () => {
    const doc = withLinkedMesh();
    const dst = doc.skins[0]!.attachments['limb']!['dst']!;
    if (dst.type === 'linkedmesh') dst.parent = 'ghost';
    expect(codes(doc)).toContain('LINKED_MESH_PARENT_MISSING');
  });

  it('LINKED_MESH_PARENT_INVALID when the parent is not a geometry attachment', () => {
    const doc = withLinkedMesh();
    doc.skins[0]!.attachments['limb']!['baseMesh'] = {
      type: 'region',
      path: 'baseRegion',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 64,
      height: 64,
      color: WHITE,
    };
    expect(codes(doc)).toContain('LINKED_MESH_PARENT_INVALID');
  });

  it('LINKED_MESH_CYCLE when the parent chain loops', () => {
    const doc = withLinkedMesh();
    doc.skins[0]!.attachments['limb']!['baseMesh'] = {
      type: 'linkedmesh',
      path: 'baseRegion',
      parent: 'dst',
      timelines: false,
      width: 64,
      height: 64,
      color: WHITE,
    };
    expect(codes(doc)).toContain('LINKED_MESH_CYCLE');
  });

  it('accepts a deform on a linked mesh (V resolved through the parent)', () => {
    const doc = withLinkedMesh();
    doc.animations['deformer'] = {
      duration: 1,
      bones: {},
      slots: {},
      ik: {},
      transform: {},
      path: {},
      physics: {},
      deform: {
        default: {
          limb: {
            dst: [{ time: 0, value: { offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, curve: 'linear' }],
          },
        },
      },
      drawOrder: [],
      events: [],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });
});

describe('sequence attachments (ADR-0009 section 3)', () => {
  it('accepts a region sequence with an in-range setup index', () => {
    const doc = cloneMinimal();
    const att = doc.skins[0]!.attachments['body']!['body']!;
    if (att.type === 'region') att.sequence = { count: 4, start: 1, digits: 2, setupIndex: 2 };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('SEQUENCE_SETUP_RANGE when setupIndex is out of range (structural)', () => {
    const doc = cloneMinimal();
    const att = doc.skins[0]!.attachments['body']!['body']!;
    if (att.type === 'region') att.sequence = { count: 2, start: 0, digits: 2, setupIndex: 5 };
    expect(codes(doc)).toEqual(['SEQUENCE_SETUP_RANGE']);
  });

  it('accepts a per-slot sequence timeline', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots['body'] = {
      sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });
});

describe('timeline granularity (ADR-0009 section 4)', () => {
  it('accepts per-component bone tracks with per-component curves', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.bones['root'] = {
      translateX: [
        {
          time: 0,
          value: { value: 0 },
          curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
        },
        { time: 1, value: { value: 5 }, curve: 'linear' },
      ],
      scaleY: [{ time: 0, value: { value: 1 }, curve: 'stepped' }],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('TIMELINE_COMPONENT_CONFLICT when a joint and split bone track coexist', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.bones['root'] = {
      translate: [{ time: 0, value: { x: 0, y: 0 }, curve: 'linear' }],
      translateX: [{ time: 0, value: { value: 0 }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('TIMELINE_COMPONENT_CONFLICT');
  });

  it('accepts split slot rgb and alpha tracks', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots['body'] = {
      rgb: [{ time: 0, value: { rgb: { r: 1, g: 0.5, b: 0.2 } }, curve: 'linear' }],
      alpha: [{ time: 0, value: { alpha: 0.5 }, curve: 'linear' }],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('TIMELINE_COMPONENT_CONFLICT when joint color and split rgb coexist', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots['body'] = {
      color: [{ time: 0, value: { color: WHITE }, curve: 'linear' }],
      rgb: [{ time: 0, value: { rgb: { r: 1, g: 1, b: 1 } }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('TIMELINE_COMPONENT_CONFLICT');
  });

  it('COLOR_RANGE for an rgb channel out of range', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots['body'] = {
      rgb: [{ time: 0, value: { rgb: { r: 2, g: 1, b: 1 } }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('COLOR_RANGE');
  });

  it('accepts a dark timeline when the slot defines a setup darkColor', () => {
    const doc = cloneMinimal();
    doc.slots[0]!.darkColor = { r: 0, g: 0, b: 0, a: 1 };
    doc.animations['idle']!.slots['body'] = {
      dark: [{ time: 0, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' }],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('ANIM_DARK_NO_SETUP for a dark timeline on a slot without a setup darkColor', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots['body'] = {
      dark: [{ time: 0, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('ANIM_DARK_NO_SETUP');
  });
});

describe('skin scoping (ADR-0009 section 5)', () => {
  it('accepts skin-scoped bones and constraints that resolve', () => {
    const doc = cloneMinimal();
    doc.ikConstraints.push(ik('ik'));
    doc.skins[0]!.bones = ['root'];
    doc.skins[0]!.constraints = ['ik'];
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('SKIN_BONE_UNKNOWN for a scoped bone that does not exist', () => {
    const doc = cloneMinimal();
    doc.skins[0]!.bones = ['ghost'];
    expect(codes(doc)).toEqual(['SKIN_BONE_UNKNOWN']);
  });

  it('SKIN_CONSTRAINT_UNKNOWN for a scoped constraint that does not exist', () => {
    const doc = cloneMinimal();
    doc.skins[0]!.constraints = ['ghost'];
    expect(codes(doc)).toEqual(['SKIN_CONSTRAINT_UNKNOWN']);
  });
});
