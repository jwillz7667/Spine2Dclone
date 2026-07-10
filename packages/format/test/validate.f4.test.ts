import { describe, expect, it } from 'vitest';
import type { PhysicsConstraint, PhysicsSettings } from '../src/schema/constraint';
import type { SkeletonDocument } from '../src/schema/document';
import { validateDocument } from '../src/validate';
import type { FormatErrorCode } from '../src/validate/errors';
import { cloneMinimal } from './helpers';

// Stage F4 (ADR-0014): physics constraints (single bone, a non-empty unique channel set over
// x/y/rotation/scaleX/shearX, and the step/inertia/strength/damping/mass/wind/gravity/mix model
// parameters), the optional skeleton physics settings block, the physics timeline, and the constraint
// order/name space now spanning four arrays. Each test isolates one behavior; hashes are not managed here
// (verifyHash: false) so the structural and semantic layers run regardless.

function codes(doc: SkeletonDocument): FormatErrorCode[] {
  return validateDocument(doc, { verifyHash: false }).errors.map((error) => error.code);
}

// A valid physics constraint on the root bone (rotation jiggle), authoring-default step 1/60.
function physicsConstraint(over: Partial<PhysicsConstraint> = {}): PhysicsConstraint {
  return {
    name: 'phys',
    bone: 'root',
    channels: ['rotation'],
    step: 1 / 60,
    inertia: 0.5,
    strength: 100,
    damping: 0.9,
    mass: 1,
    wind: 0,
    gravity: 0,
    mix: 1,
    ...over,
  };
}

// cloneMinimal has one bone `root` and one slot `body`. Add a physics constraint on `root`.
function withPhysics(pc: PhysicsConstraint = physicsConstraint()): SkeletonDocument {
  const doc = cloneMinimal();
  doc.physicsConstraints.push(pc);
  return doc;
}

describe('physics constraint definition (ADR-0014 section 1)', () => {
  it('accepts a valid single-channel physics constraint', () => {
    expect(validateDocument(withPhysics(), { verifyHash: false }).ok).toBe(true);
  });

  it('accepts a multi-channel constraint over every channel', () => {
    const doc = withPhysics(
      physicsConstraint({ channels: ['x', 'y', 'rotation', 'scaleX', 'shearX'] }),
    );
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('PHYSICS_CHANNELS_EMPTY when the channel set is empty (structural)', () => {
    expect(codes(withPhysics(physicsConstraint({ channels: [] })))).toEqual([
      'PHYSICS_CHANNELS_EMPTY',
    ]);
  });

  it('PHYSICS_CHANNEL_DUPLICATE when a channel is listed twice (structural)', () => {
    expect(codes(withPhysics(physicsConstraint({ channels: ['x', 'x'] })))).toEqual([
      'PHYSICS_CHANNEL_DUPLICATE',
    ]);
  });

  it('PHYSICS_STEP_RANGE when step is not strictly positive', () => {
    expect(codes(withPhysics(physicsConstraint({ step: 0 })))).toEqual(['PHYSICS_STEP_RANGE']);
  });

  it('PHYSICS_MASS_RANGE when mass is not strictly positive', () => {
    expect(codes(withPhysics(physicsConstraint({ mass: 0 })))).toEqual(['PHYSICS_MASS_RANGE']);
  });

  it('PHYSICS_STRENGTH_RANGE when strength is negative', () => {
    expect(codes(withPhysics(physicsConstraint({ strength: -1 })))).toEqual([
      'PHYSICS_STRENGTH_RANGE',
    ]);
  });

  it('PHYSICS_INERTIA_RANGE when inertia is outside [0, 1]', () => {
    expect(codes(withPhysics(physicsConstraint({ inertia: 1.5 })))).toEqual([
      'PHYSICS_INERTIA_RANGE',
    ]);
  });

  it('PHYSICS_DAMPING_RANGE when damping is outside [0, 1]', () => {
    expect(codes(withPhysics(physicsConstraint({ damping: -0.1 })))).toEqual([
      'PHYSICS_DAMPING_RANGE',
    ]);
  });

  it('PHYSICS_MIX_RANGE when mix is outside [0, 1]', () => {
    expect(codes(withPhysics(physicsConstraint({ mix: 2 })))).toEqual(['PHYSICS_MIX_RANGE']);
  });

  it('PHYSICS_BONE_MISSING when the bound bone does not resolve (semantic)', () => {
    expect(codes(withPhysics(physicsConstraint({ bone: 'ghost' })))).toEqual([
      'PHYSICS_BONE_MISSING',
    ]);
  });
});

describe('skeleton physics settings block (ADR-0014 section 5)', () => {
  it('accepts a valid optional physics settings block', () => {
    const doc = withPhysics();
    doc.physics = { gravity: 980, wind: -30, mix: 0.75 } satisfies PhysicsSettings;
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('PHYSICS_MIX_RANGE when the settings master mix is out of range', () => {
    const doc = withPhysics();
    doc.physics = { gravity: 0, wind: 0, mix: 1.5 };
    expect(codes(doc)).toEqual(['PHYSICS_MIX_RANGE']);
  });
});

describe('constraint order and name space across four arrays (ADR-0014 section 4)', () => {
  it('accepts a dense unique order across ik, transform, path, and physics constraints', () => {
    const doc = withPhysics();
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
    doc.physicsConstraints[0]!.order = 1;
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('CONSTRAINT_ORDER_INVALID when order is set on some of the four arrays but not all', () => {
    const doc = withPhysics();
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
    // The physics constraint omits order, so the all-or-none rule is violated across the combined set.
    expect(codes(doc)).toContain('CONSTRAINT_ORDER_INVALID');
  });

  it('CONSTRAINT_NAME_DUPLICATE when a physics constraint reuses an ik constraint name', () => {
    const doc = withPhysics(physicsConstraint({ name: 'shared' }));
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

  it('resolves a skin-scoped physics constraint', () => {
    const doc = withPhysics();
    doc.skins[0]!.constraints = ['phys'];
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });
});

describe('physics timeline (ADR-0014 section 7)', () => {
  it('accepts a physics timeline keying dynamic channels', () => {
    const doc = withPhysics();
    doc.animations['idle']!.physics = {
      phys: [
        { time: 0, value: { mix: 0, strength: 50 }, curve: 'linear' },
        { time: 1, value: { mix: 1, wind: 40, gravity: 980 }, curve: 'linear' },
      ],
    };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('ANIM_PHYSICS_UNKNOWN when a physics timeline keys a non-existent constraint', () => {
    const doc = withPhysics();
    doc.animations['idle']!.physics = {
      ghost: [{ time: 0, value: { mix: 1 }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('ANIM_PHYSICS_UNKNOWN');
  });

  it('PHYSICS_STRENGTH_RANGE when a physics frame strength is negative', () => {
    const doc = withPhysics();
    doc.animations['idle']!.physics = {
      phys: [{ time: 0, value: { strength: -5 }, curve: 'linear' }],
    };
    expect(codes(doc)).toContain('PHYSICS_STRENGTH_RANGE');
  });
});
