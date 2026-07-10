import type { SkeletonDocument } from '@marionette/format/types';
import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import {
  ConstraintError,
  CreatePathConstraintCommand,
  DeletePathConstraintCommand,
  ReorderConstraintsCommand,
  SetPathConstraintParamsCommand,
  loadDocument,
  type Document,
  type PathConstraintParams,
} from '../src';
import { makeTestEnv, pathedSeed, seeds } from './seeds';

// PP-D11 path constraint authoring: the round-trip harness proves every command's do/undo is bit-exact on
// the 'pathed' seed; this file pins the behaviors the harness does not: the targetNotPath / name-collision
// rejections, the delete cascade of the carried path timeline, the coalesced setParams merged sequence, and
// the three-array (ik + transform + path) reorder space.

const PARAMS: PathConstraintParams = {
  positionMode: 'percent',
  spacingMode: 'length',
  rotateMode: 'tangent',
  position: 0,
  spacing: 0,
  offsetRotation: 0,
  mixRotate: 1,
  mixX: 1,
  mixY: 1,
};

function pathTargetSlot(doc: Document) {
  const slot = doc.model.slots().find((s) => {
    if (s.attachment === null) return false;
    return doc.model.getAttachment(s.id, s.attachment)?.kind === 'path';
  });
  if (!slot) throw new Error('no path-carrying slot in seed');
  return slot;
}

describe('CreatePathConstraint', () => {
  it('creates a path constraint targeting a path slot and undoes cleanly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const slot = pathTargetSlot(doc);
    const bone = doc.model.bones()[0]!;
    const startCount = doc.model.pathConstraints().length;

    doc.history.execute(
      new CreatePathConstraintCommand(doc.ids.mint('pathConstraint'), 'pc2', slot.id, [bone.id], PARAMS),
    );
    expect(doc.model.pathConstraints().map((c) => c.name)).toContain('pc2');

    doc.history.undo();
    expect(doc.model.pathConstraints().length).toBe(startCount);
  });

  it('rejects a duplicate constraint name across the combined namespace', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const slot = pathTargetSlot(doc);
    const bone = doc.model.bones()[0]!;

    // 'rail-follow' already exists in the seed.
    expect(() =>
      doc.history.execute(
        new CreatePathConstraintCommand(
          doc.ids.mint('pathConstraint'),
          'rail-follow',
          slot.id,
          [bone.id],
          PARAMS,
        ),
      ),
    ).toThrow(ConstraintError);
  });

  it('rejects a target slot whose setup attachment is not a path (targetNotPath)', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.meshed, env);
    // 'mesh_slot' carries a mesh attachment ('panel') at setup.
    const meshSlot = doc.model.slots().find((s) => s.attachment === 'panel')!;
    const bone = doc.model.bones()[0]!;
    const before = doc.model.snapshot();

    let reason = '';
    try {
      doc.history.execute(
        new CreatePathConstraintCommand(
          doc.ids.mint('pathConstraint'),
          'bad',
          meshSlot.id,
          [bone.id],
          PARAMS,
        ),
      );
    } catch (error) {
      if (error instanceof ConstraintError) reason = error.reason;
    }
    expect(reason).toBe('targetNotPath');
    expect(doc.model.snapshot()).toEqual(before); // rejected before any mutation
  });
});

describe('DeletePathConstraint', () => {
  it('deletes the constraint and cascades its carried path timeline in one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const constraint = doc.model.pathConstraints()[0]!;
    const before = doc.model.snapshot();

    // The 'glide' animation keys this constraint's path timeline (by id) before the delete.
    const glideBefore = doc.model.animations().find((a) => a.name === 'glide')!;
    expect(glideBefore.path.has(constraint.id)).toBe(true);

    doc.history.execute(new DeletePathConstraintCommand(constraint.id));

    expect(doc.model.pathConstraints().find((c) => c.id === constraint.id)).toBeUndefined();
    const glideAfter = doc.model.animations().find((a) => a.name === 'glide')!;
    expect(glideAfter.path.has(constraint.id)).toBe(false); // orphan track pruned

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // constraint and its timeline both restored
  });
});

describe('SetPathConstraintParams', () => {
  it('coalesces a position slider drag into a single undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const constraint = doc.model.pathConstraints()[0]!;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 1; i <= 8; i += 1) {
      doc.history.execute(
        new SetPathConstraintParamsCommand(constraint.id, { position: i / 10 }),
      );
    }
    const event = doc.history.endInteraction('Set Path Constraint');
    expect(event?.kind).toBe('path.setParams'); // one merged command, not a composite of eight

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo returns to the pre-drag value
  });

  it('edits a mode and a scalar, restoring both on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(pathedSeed, env);
    const constraint = doc.model.pathConstraints()[0]!;

    doc.history.execute(
      new SetPathConstraintParamsCommand(constraint.id, { rotateMode: 'chain', spacing: 5 }),
    );
    const edited = doc.model.pathConstraints()[0]!;
    expect(edited.rotateMode).toBe('chain');
    expect(edited.spacing).toBe(5);

    doc.history.undo();
    const restored = doc.model.pathConstraints()[0]!;
    expect(restored.rotateMode).toBe(constraint.rotateMode);
    expect(restored.spacing).toBe(constraint.spacing);
  });
});

// A document carrying one IK, one transform, AND one path constraint, so ReorderConstraints exercises the
// single combined order space that now spans all three arrays (ADR-0011 section 2.3).
function threeConstraintDoc(): SkeletonDocument {
  const white = { r: 1, g: 1, b: 1, a: 1 } as const;
  const b = (name: string, parent: string | null, x = 0) => ({
    name,
    parent,
    length: 50,
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
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'three',
    hash: '',
    bones: [b('root', null), b('arm', 'root', 50), b('rider', 'root', 20)],
    slots: [{ name: 'rail_slot', bone: 'root', color: white, attachment: 'rail', blendMode: 'normal' }],
    skins: [
      {
        name: 'default',
        attachments: {
          rail_slot: {
            rail: {
              type: 'path',
              closed: false,
              constantSpeed: true,
              lengths: [90],
              vertices: [0, 0, 30, 0, 60, 0, 90, 0],
            },
          },
        },
      },
    ],
    ikConstraints: [
      {
        name: 'ik1',
        bones: ['arm'],
        target: 'root',
        mix: 1,
        bend: 1,
        softness: 0,
        stretch: false,
        compress: false,
        uniform: false,
      },
    ],
    transformConstraints: [
      {
        name: 'tc1',
        bones: ['rider'],
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
        local: false,
        relative: false,
      },
    ],
    pathConstraints: [
      {
        name: 'pc1',
        target: 'rail_slot',
        bones: ['rider'],
        positionMode: 'percent',
        spacingMode: 'length',
        rotateMode: 'tangent',
        position: 0,
        spacing: 0,
        offsetRotation: 0,
        mixRotate: 1,
        mixX: 1,
        mixY: 1,
      },
    ],
    events: [],
    animations: {},
    atlas: { pages: [] },
  };
}

describe('ReorderConstraints across the three-array order space', () => {
  it('assigns a dense permutation over ik + transform + path and undoes it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(threeConstraintDoc(), env);
    const ids = [
      ...doc.model.ikConstraints().map((c) => c.id),
      ...doc.model.transformConstraints().map((c) => c.id),
      ...doc.model.pathConstraints().map((c) => c.id),
    ];
    expect(ids).toHaveLength(3);
    const before = doc.model.snapshot();

    doc.history.execute(new ReorderConstraintsCommand([...ids].reverse()));

    // Every constraint across all three arrays now carries an explicit order forming a dense [0, 3) cover.
    const orders = [
      ...doc.model.ikConstraints().map((c) => c.order),
      ...doc.model.transformConstraints().map((c) => c.order),
      ...doc.model.pathConstraints().map((c) => c.order),
    ];
    expect([...orders].sort()).toEqual([0, 1, 2]);
    // The path constraint (last in default order) was moved to the front (order 0) by the reversal.
    expect(doc.model.pathConstraints()[0]!.order).toBe(0);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
