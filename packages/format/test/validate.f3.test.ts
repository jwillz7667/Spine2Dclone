import { describe, expect, it } from 'vitest';
import type { PathAttachment } from '../src/schema/attachment';
import type { PathConstraint } from '../src/schema/constraint';
import type { SkeletonDocument } from '../src/schema/document';
import { validateDocument } from '../src/validate';
import type { FormatErrorCode } from '../src/validate/errors';
import { cloneMinimal } from './helpers';

// Stage F3 (ADR-0011): path attachments (open/closed/weighted cubic splines with an arc-length table) and
// path constraints (slot target, bone list, position/spacing/rotate modes, per-channel mix), plus the path
// timeline and the constraint order/name space now spanning three arrays. Each test isolates one behavior;
// hashes are not managed here (verifyHash: false) so the structural and semantic layers run regardless.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;

function codes(doc: SkeletonDocument): FormatErrorCode[] {
  return validateDocument(doc, { verifyHash: false }).errors.map((error) => error.code);
}

// A valid OPEN, unweighted, single-curve path (4 control points, one cumulative arc length).
function openPath(over: Partial<PathAttachment> = {}): PathAttachment {
  return {
    type: 'path',
    closed: false,
    constantSpeed: true,
    lengths: [100],
    vertices: [0, 0, 33, 0, 66, 0, 100, 0],
    ...over,
  };
}

function pathConstraint(over: Partial<PathConstraint> = {}): PathConstraint {
  return {
    name: 'pc',
    target: 'rail',
    bones: ['root'],
    positionMode: 'percent',
    spacingMode: 'length',
    rotateMode: 'tangent',
    position: 0,
    spacing: 0,
    offsetRotation: 0,
    mixRotate: 1,
    mixX: 1,
    mixY: 1,
    ...over,
  };
}

// cloneMinimal has one slot `body` (region `body`); add a `rail` slot carrying a path attachment and a path
// constraint targeting it. The path renders no pixels, so no atlas region is added.
function withPath(path: PathAttachment = openPath()): SkeletonDocument {
  const doc = cloneMinimal();
  doc.slots.push({
    name: 'rail',
    bone: 'root',
    color: WHITE,
    attachment: 'railPath',
    blendMode: 'normal',
  });
  doc.skins[0]!.attachments['rail'] = { railPath: path };
  doc.pathConstraints.push(pathConstraint());
  return doc;
}

describe('path attachment geometry (ADR-0011 section 1)', () => {
  it('accepts an open unweighted single-curve path', () => {
    expect(validateDocument(withPath(), { verifyHash: false }).ok).toBe(true);
  });

  it('accepts a closed unweighted path (3 control points, 1 wrapping curve)', () => {
    const doc = withPath(
      openPath({ closed: true, constantSpeed: false, lengths: [200], vertices: [0, 0, 50, 50, -50, 50] }),
    );
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('accepts a weighted path reusing the mesh vertex codec', () => {
    const doc = withPath(
      openPath({
        bones: [0],
        vertices: [1, 0, 0, 0, 1, 1, 0, 33, 0, 1, 1, 0, 66, 0, 1, 1, 0, 100, 0, 1],
      }),
    );
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('PATH_VERTEX_COUNT when the control-point count does not fit the openness', () => {
    // A closed spline needs a multiple of 3 control points; 4 (8 numbers) fits neither.
    const doc = withPath(openPath({ closed: true, lengths: [], vertices: [0, 0, 1, 0, 2, 0, 3, 0] }));
    expect(codes(doc)).toEqual(['PATH_VERTEX_COUNT']);
  });

  it('PATH_LENGTHS_COUNT when the arc-length table has the wrong length', () => {
    const doc = withPath(openPath({ lengths: [50, 100] }));
    expect(codes(doc)).toEqual(['PATH_LENGTHS_COUNT']);
  });

  it('PATH_LENGTHS_ORDER when the cumulative table is not non-decreasing', () => {
    const doc = withPath(openPath({ lengths: [-1] }));
    expect(codes(doc)).toEqual(['PATH_LENGTHS_ORDER']);
  });

  it('reuses the mesh weighted-vertex codes for a malformed weighted path stream', () => {
    // A valid open 4-control-point weighted stream, but the last vertex's weight is 0.5 (not 1), so the
    // shared MESH_WEIGHT_SUM code fires (the weighted-vertex codec is shared with meshes).
    const doc = withPath(
      openPath({
        bones: [0],
        vertices: [1, 0, 0, 0, 1, 1, 0, 33, 0, 1, 1, 0, 66, 0, 1, 1, 0, 100, 0, 0.5],
      }),
    );
    expect(codes(doc)).toEqual(['MESH_WEIGHT_SUM']);
  });
});

describe('path constraint references (ADR-0011 section 2)', () => {
  it('accepts a valid path constraint targeting a path slot', () => {
    expect(validateDocument(withPath(), { verifyHash: false }).ok).toBe(true);
  });

  it('PATH_TARGET_MISSING when the target slot does not exist', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.target = 'ghost';
    expect(codes(doc)).toEqual(['PATH_TARGET_MISSING']);
  });

  it('PATH_TARGET_NOT_PATH when the target slot setup attachment is not a path', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.target = 'body'; // the region slot from cloneMinimal
    expect(codes(doc)).toEqual(['PATH_TARGET_NOT_PATH']);
  });

  it('does not flag PATH_TARGET_NOT_PATH when the target slot has no setup attachment (runtime concern)', () => {
    const doc = withPath();
    doc.slots.find((slot) => slot.name === 'rail')!.attachment = null;
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('PATH_BONE_MISSING when a driven bone does not resolve', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.bones = ['ghost'];
    expect(codes(doc)).toEqual(['PATH_BONE_MISSING']);
  });

  it('PATH_BONES_EMPTY when the bone list is empty (structural)', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.bones = [];
    expect(codes(doc)).toEqual(['PATH_BONES_EMPTY']);
  });

  it('PATH_MIX_RANGE when a mix channel is outside [0, 1] (structural)', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.mixRotate = 2;
    expect(codes(doc)).toEqual(['PATH_MIX_RANGE']);
  });
});

describe('constraint order and name space across three arrays (ADR-0011 section 2.3)', () => {
  it('accepts a dense unique order across ik, transform, and path constraints', () => {
    const doc = withPath();
    doc.ikConstraints.push({
      name: 'ik',
      bones: ['root'],
      target: 'root',
      mix: 1,
      bend: 1,
      softness: 0,
      stretch: false,
      compress: false,
      uniform: false,
      order: 0,
    });
    doc.pathConstraints[0]!.order = 1;
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('CONSTRAINT_ORDER_INVALID when order is set on some of the three arrays but not all', () => {
    const doc = withPath();
    doc.ikConstraints.push({
      name: 'ik',
      bones: ['root'],
      target: 'root',
      mix: 1,
      bend: 1,
      softness: 0,
      stretch: false,
      compress: false,
      uniform: false,
      order: 0,
    });
    // The path constraint omits order, so the all-or-none rule is violated across the combined set.
    expect(codes(doc)).toContain('CONSTRAINT_ORDER_INVALID');
  });

  it('CONSTRAINT_NAME_DUPLICATE when a path constraint reuses an ik constraint name', () => {
    const doc = withPath();
    doc.pathConstraints[0]!.name = 'shared';
    doc.ikConstraints.push({
      name: 'shared',
      bones: ['root'],
      target: 'root',
      mix: 1,
      bend: 1,
      softness: 0,
      stretch: false,
      compress: false,
      uniform: false,
    });
    expect(codes(doc)).toContain('CONSTRAINT_NAME_DUPLICATE');
  });

  it('resolves a skin-scoped path constraint', () => {
    const doc = withPath();
    doc.skins[0]!.constraints = ['pc'];
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });
});

describe('path timeline (ADR-0011 section 3)', () => {
  it('accepts a path timeline keying position and a mix channel', () => {
    const doc = withPath();
    doc.animations['idle']!.path = {
      pc: [
        { time: 0, value: { position: 0, mixRotate: 1 }, curve: 'linear' },
        { time: 1, value: { position: 1 }, curve: 'linear' },
      ],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('ANIM_PATH_UNKNOWN when a path timeline keys a non-existent constraint', () => {
    const doc = withPath();
    doc.animations['idle']!.path = {
      ghost: [{ time: 0, value: { position: 0 }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('ANIM_PATH_UNKNOWN');
  });

  it('PATH_MIX_RANGE when a path frame mix channel is out of range', () => {
    const doc = withPath();
    doc.animations['idle']!.path = {
      pc: [{ time: 0, value: { mixX: 2 }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('PATH_MIX_RANGE');
  });
});
