import { describe, expect, it } from 'vitest';
import type { Skin } from '@marionette/format/types';
import { buildPose, decomposeWorld, sampleSkeleton } from '../src';
import type { Pose } from '../src';
import { worldOf } from './rig';
import { anim, bone, fullDoc, transformConstraint } from './constraint-fixtures';

// ADR-0011 section 4: a skin-scoped constraint solves only while its skin is active; the 'default' skin is
// always active; an unscoped constraint always solves. Scoped BONES have no transform-solve effect in
// runtime-core (a rendering/attachment concern), so only scoped constraints are exercised here.

const worldRotation = (pose: Pose, name: string): number =>
  decomposeWorld(worldOf(pose, name)).rotation;

// boneA is driven by a transform constraint scoped to skin "gold"; boneB by an unscoped one; boneC by a
// constraint scoped to the always-active "default" skin. The target sits at rotation 40; a solved bone
// tracks it (mixRotate 1), an unsolved one stays at its setup rotation 0.
const document = fullDoc({
  bones: [
    bone('root', null),
    bone('boneA', 'root'),
    bone('boneB', 'root'),
    bone('boneC', 'root'),
    bone('target', 'root', { rotation: 40 }),
  ],
  transformConstraints: [
    transformConstraint('tcGold', ['boneA'], 'target', { mixRotate: 1 }),
    transformConstraint('tcAlways', ['boneB'], 'target', { mixRotate: 1 }),
    transformConstraint('tcDefault', ['boneC'], 'target', { mixRotate: 1 }),
  ],
  skins: [
    { name: 'default', attachments: {}, constraints: ['tcDefault'] } as Skin,
    { name: 'gold', attachments: {}, constraints: ['tcGold'] } as Skin,
  ],
  animations: { a: anim() },
});

describe('skin-scoped constraints (ADR-0011 section 4)', () => {
  it('a scoped constraint is INACTIVE when its skin is not active', () => {
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 0, pose, null);

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(0, 6); // tcGold inactive (gold not active)
    expect(worldRotation(pose, 'boneB')).toBeCloseTo(40, 6); // tcAlways always active
    expect(worldRotation(pose, 'boneC')).toBeCloseTo(40, 6); // tcDefault: default skin always active
  });

  it('a scoped constraint is ACTIVE when its skin is the active skin', () => {
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 0, pose, 'gold');

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(40, 6); // tcGold now active
    expect(worldRotation(pose, 'boneB')).toBeCloseTo(40, 6);
    expect(worldRotation(pose, 'boneC')).toBeCloseTo(40, 6);
  });

  it('a different active skin leaves the gold-scoped constraint inactive', () => {
    const pose = buildPose(document);
    sampleSkeleton(document, 'a', 0, pose, 'silver');

    expect(worldRotation(pose, 'boneA')).toBeCloseTo(0, 6); // silver does not scope tcGold
  });

  it('captures the scoping skins on the resolved constraint', () => {
    const pose = buildPose(document);
    const byName = new Map(pose.transformConstraints.map((c) => [c.name, c]));
    expect(byName.get('tcGold')!.scopeSkins).toEqual(['gold']);
    expect(byName.get('tcDefault')!.scopeSkins).toEqual(['default']);
    expect(byName.get('tcAlways')!.scopeSkins).toBeNull();
  });
});
