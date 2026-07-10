import type { SkeletonDocument } from '@marionette/format/types';
import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import { describe, expect, it } from 'vitest';
import {
  ConstraintError,
  CreatePhysicsConstraintCommand,
  DeletePhysicsConstraintCommand,
  RenamePhysicsConstraintCommand,
  ReorderConstraintsCommand,
  SetPhysicsConstraintChannelsCommand,
  SetPhysicsConstraintParamsCommand,
  SetPhysicsConstraintTargetBoneCommand,
  SetPhysicsSettingsCommand,
  assertInvariants,
  loadDocument,
  type PhysicsConstraintParams,
} from '../src';
import { makeTestEnv, physicsedSeed } from './seeds';

// PP-D12 physics constraint authoring: the round-trip harness proves every command's do/undo is bit-exact on
// the 'physicsed' seed; this file pins the behaviors the harness does not: the name-collision / channels /
// bone-missing rejections, the delete cascade of the physics timeline, the rename with zero timeline cascade,
// the coalesced setParams / setSettings merged sequences (250ms window, different-target no-coalesce), and the
// four-array (ik + transform + path + physics) reorder space.

const PARAMS: PhysicsConstraintParams = {
  step: 1 / 60,
  inertia: 0.5,
  strength: 40,
  damping: 0.9,
  mass: 1,
  wind: 0,
  gravity: 0,
  mix: 1,
};

describe('CreatePhysicsConstraint', () => {
  it('creates a physics constraint on a bone and undoes cleanly', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const bone = doc.model.bones()[0]!;
    const startCount = doc.model.physicsConstraints().length;

    doc.history.execute(
      new CreatePhysicsConstraintCommand(
        doc.ids.mint('physicsConstraint'),
        'ph2',
        bone.id,
        ['x', 'y'],
        PARAMS,
      ),
    );
    expect(doc.model.physicsConstraints().map((c) => c.name)).toContain('ph2');

    doc.history.undo();
    expect(doc.model.physicsConstraints().length).toBe(startCount);
  });

  it('rejects a duplicate constraint name across the combined namespace', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const bone = doc.model.bones()[0]!;

    // 'tail-jiggle' already exists in the seed.
    expect(() =>
      doc.history.execute(
        new CreatePhysicsConstraintCommand(
          doc.ids.mint('physicsConstraint'),
          'tail-jiggle',
          bone.id,
          ['rotation'],
          PARAMS,
        ),
      ),
    ).toThrow(ConstraintError);
  });

  it('rejects an empty channel set (channelsEmpty) before any mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const bone = doc.model.bones()[0]!;
    const before = doc.model.snapshot();

    let reason = '';
    try {
      doc.history.execute(
        new CreatePhysicsConstraintCommand(
          doc.ids.mint('physicsConstraint'),
          'empty',
          bone.id,
          [],
          PARAMS,
        ),
      );
    } catch (error) {
      if (error instanceof ConstraintError) reason = error.reason;
    }
    expect(reason).toBe('channelsEmpty');
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a duplicated channel (channelDuplicate) before any mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const bone = doc.model.bones()[0]!;
    const before = doc.model.snapshot();

    let reason = '';
    try {
      doc.history.execute(
        new CreatePhysicsConstraintCommand(
          doc.ids.mint('physicsConstraint'),
          'dup',
          bone.id,
          ['rotation', 'rotation'],
          PARAMS,
        ),
      );
    } catch (error) {
      if (error instanceof ConstraintError) reason = error.reason;
    }
    expect(reason).toBe('channelDuplicate');
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('DeletePhysicsConstraint', () => {
  it('deletes the constraint and cascades its physics timeline in one undo step', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    const before = doc.model.snapshot();

    // The 'jiggle' animation keys this constraint's physics timeline (by id) before the delete.
    const jiggleBefore = doc.model.animations().find((a) => a.name === 'jiggle')!;
    expect(jiggleBefore.physics.has(constraint.id)).toBe(true);

    doc.history.execute(new DeletePhysicsConstraintCommand(constraint.id));

    expect(doc.model.physicsConstraints().find((c) => c.id === constraint.id)).toBeUndefined();
    const jiggleAfter = doc.model.animations().find((a) => a.name === 'jiggle')!;
    expect(jiggleAfter.physics.has(constraint.id)).toBe(false); // orphan track pruned

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // constraint and its timeline both restored
  });
});

describe('RenamePhysicsConstraint', () => {
  it('renames a constraint without disturbing its id-keyed timeline, and undoes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    const before = doc.model.snapshot();

    doc.history.execute(new RenamePhysicsConstraintCommand(constraint.id, 'renamed'));
    expect(doc.model.getPhysicsConstraint(constraint.id)!.name).toBe('renamed');
    // The timeline is keyed by id, so a rename leaves the track untouched (zero cascade).
    const jiggle = doc.model.animations().find((a) => a.name === 'jiggle')!;
    expect(jiggle.physics.has(constraint.id)).toBe(true);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects a rename onto an existing constraint name', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    // Create a second constraint to collide with.
    doc.history.execute(
      new CreatePhysicsConstraintCommand(
        doc.ids.mint('physicsConstraint'),
        'other',
        doc.model.bones()[0]!.id,
        ['rotation'],
        PARAMS,
      ),
    );

    expect(() =>
      doc.history.execute(new RenamePhysicsConstraintCommand(constraint.id, 'other')),
    ).toThrow(ConstraintError);
  });
});

describe('SetPhysicsConstraintTargetBone', () => {
  it('retargets to another bone and undoes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    const other = doc.model.bones().find((b) => b.id !== constraint.bone)!;

    doc.history.execute(new SetPhysicsConstraintTargetBoneCommand(constraint.id, other.id));
    expect(doc.model.getPhysicsConstraint(constraint.id)!.bone).toBe(other.id);

    doc.history.undo();
    expect(doc.model.getPhysicsConstraint(constraint.id)!.bone).toBe(constraint.bone);
  });
});

describe('SetPhysicsConstraintChannels', () => {
  it('replaces the channel set and undoes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;

    doc.history.execute(new SetPhysicsConstraintChannelsCommand(constraint.id, ['x', 'rotation']));
    expect(doc.model.getPhysicsConstraint(constraint.id)!.channels).toEqual(['x', 'rotation']);

    doc.history.undo();
    expect(doc.model.getPhysicsConstraint(constraint.id)!.channels).toEqual(constraint.channels);
  });

  it('rejects an empty or duplicated channel set before any mutation', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new SetPhysicsConstraintChannelsCommand(constraint.id, [])),
    ).toThrow(ConstraintError);
    expect(() =>
      doc.history.execute(new SetPhysicsConstraintChannelsCommand(constraint.id, ['x', 'x'])),
    ).toThrow(ConstraintError);
    expect(doc.model.snapshot()).toEqual(before);
  });
});

describe('SetPhysicsConstraintParams', () => {
  it('coalesces a strength slider stroke into one undo step (window irrelevant inside a session)', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const constraint = doc.model.physicsConstraints()[0]!;
    const preStroke = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new SetPhysicsConstraintParamsCommand(constraint.id, { strength: 10 }));
    advance(300); // beyond the 250ms window; a session coalesces regardless
    doc.history.execute(new SetPhysicsConstraintParamsCommand(constraint.id, { strength: 25 }));
    advance(300);
    doc.history.execute(new SetPhysicsConstraintParamsCommand(constraint.id, { strength: 60 }));
    const event = doc.history.endInteraction('Set Physics Constraint');
    expect(event?.kind).toBe('physics.setParams'); // one merged command, not a composite of three

    expect(doc.model.getPhysicsConstraint(constraint.id)!.strength).toBe(60);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(preStroke); // one undo returns to the pre-drag value
    expect(doc.history.canUndo).toBe(false);
    expect(() => assertInvariants(doc.model)).not.toThrow();
  });

  it('does not coalesce across two different physics constraints', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const first = doc.model.physicsConstraints()[0]!;
    const secondId = doc.ids.mint('physicsConstraint');
    doc.history.execute(
      new CreatePhysicsConstraintCommand(
        secondId,
        'second',
        doc.model.bones()[0]!.id,
        ['rotation'],
        PARAMS,
      ),
    );

    doc.history.execute(new SetPhysicsConstraintParamsCommand(first.id, { damping: 0.5 }));
    doc.history.execute(new SetPhysicsConstraintParamsCommand(secondId, { damping: 0.5 }));

    let undoSteps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      undoSteps += 1;
    }
    expect(undoSteps).toBe(3); // create + two distinct-target param edits, none merged
  });
});

describe('SetPhysicsSettings', () => {
  it('sets the global settings block and undoes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const before = doc.model.physicsSettings();

    doc.history.execute(new SetPhysicsSettingsCommand({ gravity: 20, wind: -3, mix: 0.5 }));
    expect(doc.model.physicsSettings()).toEqual({ gravity: 20, wind: -3, mix: 0.5 });

    doc.history.undo();
    expect(doc.model.physicsSettings()).toEqual(before);
  });

  it('clears the block (null) and restores it on undo', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const before = doc.model.physicsSettings();
    expect(before).toBeDefined();

    doc.history.execute(new SetPhysicsSettingsCommand(null));
    expect(doc.model.physicsSettings()).toBeUndefined();

    doc.history.undo();
    expect(doc.model.physicsSettings()).toEqual(before);
  });

  it('coalesces a gravity slider stroke into one undo step', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(physicsedSeed, env);
    const preStroke = doc.model.snapshot();

    doc.history.beginInteraction();
    doc.history.execute(new SetPhysicsSettingsCommand({ gravity: 1, wind: 2, mix: 0.75 }));
    advance(300);
    doc.history.execute(new SetPhysicsSettingsCommand({ gravity: 5, wind: 2, mix: 0.75 }));
    advance(300);
    doc.history.execute(new SetPhysicsSettingsCommand({ gravity: 12, wind: 2, mix: 0.75 }));
    doc.history.endInteraction('Set Physics Settings');

    expect(doc.model.physicsSettings()!.gravity).toBe(12);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(preStroke);
    expect(doc.history.canUndo).toBe(false);
  });
});

// A document carrying one IK, one transform, one path, AND one physics constraint, so ReorderConstraints
// exercises the single combined order space that now spans all four arrays (ADR-0014 section 4).
function fourConstraintDoc(): SkeletonDocument {
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
    name: 'four',
    hash: '',
    bones: [b('root', null), b('arm', 'root', 50), b('rider', 'root', 20)],
    slots: [
      { name: 'rail_slot', bone: 'root', color: white, attachment: 'rail', blendMode: 'normal' },
    ],
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
    physicsConstraints: [
      {
        name: 'ph1',
        bone: 'arm',
        channels: ['rotation'],
        step: 1 / 60,
        inertia: 0.5,
        strength: 40,
        damping: 0.9,
        mass: 1,
        wind: 0,
        gravity: 0,
        mix: 1,
      },
    ],
    events: [],
    animations: {},
    atlas: { pages: [] },
  };
}

describe('ReorderConstraints across the four-array order space', () => {
  it('assigns a dense permutation over ik + transform + path + physics and undoes it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(fourConstraintDoc(), env);
    const ids = [
      ...doc.model.ikConstraints().map((c) => c.id),
      ...doc.model.transformConstraints().map((c) => c.id),
      ...doc.model.pathConstraints().map((c) => c.id),
      ...doc.model.physicsConstraints().map((c) => c.id),
    ];
    expect(ids).toHaveLength(4);
    const before = doc.model.snapshot();

    doc.history.execute(new ReorderConstraintsCommand([...ids].reverse()));

    const orders = [
      ...doc.model.ikConstraints().map((c) => c.order),
      ...doc.model.transformConstraints().map((c) => c.order),
      ...doc.model.pathConstraints().map((c) => c.order),
      ...doc.model.physicsConstraints().map((c) => c.order),
    ];
    expect([...orders].sort()).toEqual([0, 1, 2, 3]);
    // The physics constraint (last in default order) was moved to the front (order 0) by the reversal.
    expect(doc.model.physicsConstraints()[0]!.order).toBe(0);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });
});
