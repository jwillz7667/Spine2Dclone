import { describe, expect, it } from 'vitest';
import type { MeshAttachment } from '../src/schema/attachment';
import type { SkeletonDocument } from '../src/schema/document';
import { validateDocument } from '../src/validate';
import type { FormatErrorCode } from '../src/validate/errors';

// WP-2.2 / ADR-0004: the additive MESH, CONSTRAINT, ANIM (ik/transform), and DEFORM validator
// families. Each test isolates one fault and asserts its reserved FormatErrorCode is present. Hashes
// are not managed here (verifyHash: false); the structural and semantic layers run regardless.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

// An unweighted quad mesh: V = 4, vertices = 2 * V, two triangles, full hull.
function unweightedMesh(): MeshAttachment {
  return {
    type: 'mesh',
    path: 'limb',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    color: WHITE,
    vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
  };
}

// A weighted quad bound to global bones 0 (root) and 1 (child), weights summing to 1 per vertex.
function weightedMesh(): MeshAttachment {
  return {
    type: 'mesh',
    path: 'limb',
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    color: WHITE,
    bones: [0, 1],
    vertices: [
      1, 0, -10, -10, 1, 1, 1, 10, -10, 1, 2, 0, 10, 10, 0.5, 1, 10, 10, 0.5, 1, 0, -10, 10, 1,
    ],
  };
}

function baseDoc(mesh: MeshAttachment = unweightedMesh()): SkeletonDocument {
  const bone = (name: string, parent: string | null, x: number) => ({
    name,
    parent,
    length: 100,
    x,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal' as const,
  });
  return {
    formatVersion: '0.2.0',
    name: 'rig',
    hash: '',
    bones: [bone('root', null, 0), bone('child', 'root', 100)],
    slots: [{ name: 'limb', bone: 'root', color: WHITE, attachment: 'limb', blendMode: 'normal' }],
    skins: [{ name: 'default', attachments: { limb: { limb: mesh } } }],
    ikConstraints: [],
    transformConstraints: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'a.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'limb',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
}

function codes(doc: SkeletonDocument): FormatErrorCode[] {
  return validateDocument(doc, { verifyHash: false }).errors.map((e) => e.code);
}

function ik(over: Partial<SkeletonDocument['ikConstraints'][number]> = {}): SkeletonDocument {
  const doc = baseDoc();
  return {
    ...doc,
    ikConstraints: [
      {
        name: 'ik',
        bones: ['root', 'child'],
        target: 'child',
        mix: 1,
        bendPositive: true,
        ...over,
      },
    ],
  };
}

function tc(
  over: Partial<SkeletonDocument['transformConstraints'][number]> = {},
): SkeletonDocument {
  const doc = baseDoc();
  const zero = {
    mixRotate: 1,
    mixX: 0,
    mixY: 0,
    mixScaleX: 0,
    mixScaleY: 0,
    mixShearY: 0,
    offsetRotation: 0,
    offsetX: 0,
    offsetY: 0,
    offsetScaleX: 0,
    offsetScaleY: 0,
    offsetShearY: 0,
  };
  return {
    ...doc,
    transformConstraints: [{ name: 'tc', bones: ['child'], target: 'root', ...zero, ...over }],
  };
}

describe('mesh validation (ADR-0002)', () => {
  it('accepts a well-formed unweighted mesh', () => {
    expect(validateDocument(baseDoc(), { verifyHash: false }).ok).toBe(true);
  });

  it('accepts a well-formed weighted mesh', () => {
    expect(validateDocument(baseDoc(weightedMesh()), { verifyHash: false }).ok).toBe(true);
  });

  it('MESH_UV_LENGTH for odd uvs', () => {
    const mesh = { ...unweightedMesh(), uvs: [0, 0, 1] };
    expect(codes(baseDoc(mesh))).toContain('MESH_UV_LENGTH');
  });

  it('MESH_VERTEX_LENGTH for an unweighted vertices/uvs mismatch', () => {
    const mesh = { ...unweightedMesh(), vertices: [0, 0] };
    expect(codes(baseDoc(mesh))).toContain('MESH_VERTEX_LENGTH');
  });

  it('MESH_TRIANGLE_LENGTH when triangles are not a multiple of 3', () => {
    const mesh = { ...unweightedMesh(), triangles: [0, 1, 2, 0] };
    expect(codes(baseDoc(mesh))).toContain('MESH_TRIANGLE_LENGTH');
  });

  it('MESH_TRIANGLE_INDEX_RANGE for an out-of-range triangle index', () => {
    const mesh = { ...unweightedMesh(), triangles: [0, 1, 9, 0, 2, 3] };
    expect(codes(baseDoc(mesh))).toContain('MESH_TRIANGLE_INDEX_RANGE');
  });

  it('MESH_HULL_RANGE when hullLength exceeds the vertex count', () => {
    const mesh = { ...unweightedMesh(), hullLength: 9 };
    expect(codes(baseDoc(mesh))).toContain('MESH_HULL_RANGE');
  });

  it('MESH_EDGE_INVALID for an out-of-range edge index', () => {
    const mesh = { ...unweightedMesh(), edges: [0, 9] };
    expect(codes(baseDoc(mesh))).toContain('MESH_EDGE_INVALID');
  });

  it('MESH_WEIGHT_DECODE when the stream does not consume to V', () => {
    const mesh = { ...weightedMesh(), vertices: [1, 0, 0, 0, 1] };
    expect(codes(baseDoc(mesh))).toContain('MESH_WEIGHT_DECODE');
  });

  it('MESH_WEIGHT_BONE_RANGE for an out-of-range bone index', () => {
    const mesh = {
      ...weightedMesh(),
      bones: [0, 9],
      vertices: [1, 0, 0, 0, 1, 1, 9, 0, 0, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1],
    };
    expect(codes(baseDoc(mesh))).toContain('MESH_WEIGHT_BONE_RANGE');
  });

  it('MESH_WEIGHT_BONES_MANIFEST when the manifest is not the referenced set', () => {
    const mesh = { ...weightedMesh(), bones: [0] };
    expect(codes(baseDoc(mesh))).toContain('MESH_WEIGHT_BONES_MANIFEST');
  });

  it('MESH_WEIGHT_INFLUENCE_CAP for more than 4 influences', () => {
    const mesh = {
      ...weightedMesh(),
      bones: [0, 1],
      vertices: [
        5, 0, 0, 0, 0.2, 1, 0, 0, 0.2, 0, 0, 0, 0.2, 1, 0, 0, 0.2, 0, 0, 0, 0.2, 1, 0, 0, 1, 1, 1,
        0, 0, 1, 1, 0, 0, 0, 1,
      ],
    };
    expect(codes(baseDoc(mesh))).toContain('MESH_WEIGHT_INFLUENCE_CAP');
  });

  it('MESH_WEIGHT_SUM when per-vertex weights do not sum to 1', () => {
    const mesh = {
      ...weightedMesh(),
      vertices: [
        1, 0, -10, -10, 0.5, 1, 1, 10, -10, 1, 2, 0, 10, 10, 0.5, 1, 10, 10, 0.5, 1, 0, -10, 10, 1,
      ],
    };
    expect(codes(baseDoc(mesh))).toContain('MESH_WEIGHT_SUM');
  });
});

describe('constraint validation (ADR-0003)', () => {
  it('accepts a well-formed two-bone IK constraint', () => {
    expect(validateDocument(ik(), { verifyHash: false }).ok).toBe(true);
  });

  it('IK_BONE_MISSING for a chain bone that does not exist', () => {
    expect(codes(ik({ bones: ['root', 'ghost'] }))).toContain('IK_BONE_MISSING');
  });

  it('IK_TARGET_MISSING for a target that does not exist', () => {
    expect(codes(ik({ target: 'ghost' }))).toContain('IK_TARGET_MISSING');
  });

  it('IK_CHAIN_DISCONTINUOUS when bones[1] is not a direct child of bones[0]', () => {
    expect(codes(ik({ bones: ['child', 'root'] }))).toContain('IK_CHAIN_DISCONTINUOUS');
  });

  it('IK_BONES_ARITY for a chain longer than 2 (structural)', () => {
    expect(codes(ik({ bones: ['root', 'child', 'root'] }))).toContain('IK_BONES_ARITY');
  });

  it('IK_MIX_RANGE for a mix outside [0, 1] (structural)', () => {
    expect(codes(ik({ mix: 1.5 }))).toContain('IK_MIX_RANGE');
  });

  it('accepts a well-formed transform constraint', () => {
    expect(validateDocument(tc(), { verifyHash: false }).ok).toBe(true);
  });

  it('TC_BONE_MISSING for a constrained bone that does not exist', () => {
    expect(codes(tc({ bones: ['ghost'] }))).toContain('TC_BONE_MISSING');
  });

  it('TC_TARGET_MISSING for a target that does not exist', () => {
    expect(codes(tc({ target: 'ghost' }))).toContain('TC_TARGET_MISSING');
  });

  it('TC_MIX_RANGE for a mix channel outside [0, 1] (structural)', () => {
    expect(codes(tc({ mixRotate: 2 }))).toContain('TC_MIX_RANGE');
  });

  it('CONSTRAINT_NAME_DUPLICATE across the ik and transform arrays', () => {
    const doc = baseDoc();
    const dup: SkeletonDocument = {
      ...doc,
      ikConstraints: [
        { name: 'shared', bones: ['child'], target: 'root', mix: 1, bendPositive: true },
      ],
      transformConstraints: [
        {
          name: 'shared',
          bones: ['child'],
          target: 'root',
          mixRotate: 1,
          mixX: 0,
          mixY: 0,
          mixScaleX: 0,
          mixScaleY: 0,
          mixShearY: 0,
          offsetRotation: 0,
          offsetX: 0,
          offsetY: 0,
          offsetScaleX: 0,
          offsetScaleY: 0,
          offsetShearY: 0,
        },
      ],
    };
    expect(codes(dup)).toContain('CONSTRAINT_NAME_DUPLICATE');
  });
});

describe('animation ik/transform/deform validation (ADR-0004)', () => {
  it('ANIM_IK_UNKNOWN when an ik timeline keys a non-existent constraint', () => {
    const doc = ik();
    const withAnim: SkeletonDocument = {
      ...doc,
      animations: {
        idle: {
          duration: 1,
          bones: {},
          slots: {},
          ik: { ghost: [{ time: 0, value: { mix: 1, bendPositive: true }, curve: 'stepped' }] },
          transform: {},
          deform: {},
        },
      },
    };
    expect(codes(withAnim)).toContain('ANIM_IK_UNKNOWN');
  });

  it('ANIM_TRANSFORM_UNKNOWN when a transform timeline keys a non-existent constraint', () => {
    const doc = tc();
    const withAnim: SkeletonDocument = {
      ...doc,
      animations: {
        idle: {
          duration: 1,
          bones: {},
          slots: {},
          ik: {},
          transform: { ghost: [{ time: 0, value: { mixRotate: 1 }, curve: 'linear' }] },
          deform: {},
        },
      },
    };
    expect(codes(withAnim)).toContain('ANIM_TRANSFORM_UNKNOWN');
  });

  function withDeform(deform: SkeletonDocument['animations'][string]['deform']): SkeletonDocument {
    const doc = baseDoc();
    return {
      ...doc,
      animations: { idle: { duration: 1, bones: {}, slots: {}, ik: {}, transform: {}, deform } },
    };
  }

  it('accepts a well-formed deform timeline on a mesh attachment', () => {
    const deform = {
      default: {
        limb: {
          limb: [
            { time: 0, value: { offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, curve: 'linear' as const },
          ],
        },
      },
    };
    expect(validateDocument(withDeform(deform), { verifyHash: false }).ok).toBe(true);
  });

  it('DEFORM_SKIN_UNKNOWN for an unknown skin', () => {
    const deform = {
      ghost: {
        limb: {
          limb: [
            { time: 0, value: { offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, curve: 'linear' as const },
          ],
        },
      },
    };
    expect(codes(withDeform(deform))).toContain('DEFORM_SKIN_UNKNOWN');
  });

  it('DEFORM_SLOT_UNKNOWN for an unknown slot', () => {
    const deform = {
      default: {
        ghost: { limb: [{ time: 0, value: { offsets: [0, 0] }, curve: 'linear' as const }] },
      },
    };
    expect(codes(withDeform(deform))).toContain('DEFORM_SLOT_UNKNOWN');
  });

  it('DEFORM_ATTACHMENT_UNKNOWN for an unknown attachment', () => {
    const deform = {
      default: {
        limb: { ghost: [{ time: 0, value: { offsets: [0, 0] }, curve: 'linear' as const }] },
      },
    };
    expect(codes(withDeform(deform))).toContain('DEFORM_ATTACHMENT_UNKNOWN');
  });

  it('DEFORM_OFFSET_LENGTH when offsets are not 2 * V', () => {
    const deform = {
      default: {
        limb: { limb: [{ time: 0, value: { offsets: [0, 0] }, curve: 'linear' as const }] },
      },
    };
    expect(codes(withDeform(deform))).toContain('DEFORM_OFFSET_LENGTH');
  });

  it('DEFORM_NOT_MESH when the deformed attachment is a region', () => {
    const doc = baseDoc();
    const withRegion: SkeletonDocument = {
      ...doc,
      skins: [
        {
          name: 'default',
          attachments: {
            limb: {
              limb: {
                type: 'region',
                path: 'limb',
                x: 0,
                y: 0,
                rotation: 0,
                scaleX: 1,
                scaleY: 1,
                width: 64,
                height: 64,
                color: WHITE,
              },
            },
          },
        },
      ],
      animations: {
        idle: {
          duration: 1,
          bones: {},
          slots: {},
          ik: {},
          transform: {},
          deform: {
            default: { limb: { limb: [{ time: 0, value: { offsets: [0, 0] }, curve: 'linear' }] } },
          },
        },
      },
    };
    expect(codes(withRegion)).toContain('DEFORM_NOT_MESH');
  });
});
