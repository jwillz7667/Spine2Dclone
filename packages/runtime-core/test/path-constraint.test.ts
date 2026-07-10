import { describe, expect, it } from 'vitest';
import type {
  Animation,
  PathAttachment,
  PathConstraint,
  SkeletonDocument,
} from '@marionette/format/types';
import { buildPose, MAT2X3_STRIDE, sampleSkeleton } from '../src';
import { bone, slot } from './anim-fixtures';

// PP-B6 path solve unit checks (ADR-0013). These build a COMPLETE format-0.5.0 document with a path
// attachment and a path constraint, run the canonical solve, and check the straight-line geometry
// analytically (independent of the solver's own arithmetic), plus determinism and weighted equivalence.

// A straight horizontal open path from (0, 0) to (300, 0), one cubic curve with evenly spaced control
// points, so arc length is linear in t and equals 300. The committed lengths table is [300].
const STRAIGHT_VERTICES = [0, 0, 100, 0, 200, 0, 300, 0];

function pathAttachment(overrides: Partial<PathAttachment> = {}): PathAttachment {
  return {
    type: 'path',
    closed: false,
    constantSpeed: true,
    lengths: [300],
    vertices: [...STRAIGHT_VERTICES],
    ...overrides,
  };
}

function pathConstraint(overrides: Partial<PathConstraint> = {}): PathConstraint {
  return {
    name: 'pc',
    target: 'pathSlot',
    bones: ['follower'],
    positionMode: 'percent',
    spacingMode: 'length',
    rotateMode: 'tangent',
    position: 0.5,
    spacing: 0,
    offsetRotation: 0,
    mixRotate: 1,
    mixX: 1,
    mixY: 1,
    ...overrides,
  };
}

function emptyAnim(): Animation {
  return { duration: 1, bones: {}, slots: {}, ik: {}, transform: {}, path: {}, deform: {} };
}

function doc(attachment: PathAttachment, constraint: PathConstraint): SkeletonDocument {
  return {
    formatVersion: '0.5.0',
    name: 'path-test',
    hash: '',
    bones: [bone('pathBone', null), bone('follower', null, { length: 100 })],
    slots: [slot('pathSlot', 'pathBone', { attachment: 'spine' })],
    skins: [{ name: 'default', attachments: { pathSlot: { spine: attachment } } }],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [constraint],
    animations: { idle: emptyAnim() },
    atlas: { pages: [] },
  };
}

function followerWorld(document: SkeletonDocument): number[] {
  const pose = buildPose(document);
  sampleSkeleton(document, 'idle', 0, pose);
  const followerIndex = pose.boneNames.indexOf('follower');
  const base = followerIndex * MAT2X3_STRIDE;
  return Array.from(pose.world.slice(base, base + MAT2X3_STRIDE));
}

describe('path constraint solve (ADR-0013)', () => {
  it('places a bone at the arc-length position on a straight horizontal path (tangent rotation 0)', () => {
    // percent position 0.5 on a length-300 path => arc length 150 => world point (150, 0); a horizontal
    // path has tangent angle 0, so the follower world is identity rotation translated to (150, 0).
    const world = followerWorld(doc(pathAttachment(), pathConstraint()));

    expect(world[0]).toBeCloseTo(1, 9);
    expect(world[1]).toBeCloseTo(0, 9);
    expect(world[2]).toBeCloseTo(0, 9);
    expect(world[3]).toBeCloseTo(1, 9);
    expect(world[4]).toBeCloseTo(150, 6);
    expect(world[5]).toBeCloseTo(0, 9);
  });

  it('is deterministic: two solves of the same document produce identical bone worlds', () => {
    const document = doc(
      pathAttachment(),
      pathConstraint({ rotateMode: 'chain', bones: ['follower'] }),
    );
    const first = followerWorld(document);
    const second = followerWorld(document);

    expect(second).toEqual(first);
  });

  it('constantSpeed false matches constantSpeed true on a straight (linear arc-length) path', () => {
    // For an evenly spaced straight line arc length is linear in t, so t = curveFraction either way and
    // both modes must land on the identical point.
    const constant = followerWorld(doc(pathAttachment({ constantSpeed: true }), pathConstraint()));
    const naive = followerWorld(doc(pathAttachment({ constantSpeed: false }), pathConstraint()));

    expect(naive).toEqual(constant);
  });

  it('a single-influence weighted control stream equals the unweighted transform', () => {
    // Weighted stream: one influence per control point, all riding pathBone (global index 0) at weight 1
    // with the same local coordinates, so every world control point equals the unweighted transform.
    const weightedVertices: number[] = [];
    for (let i = 0; i < STRAIGHT_VERTICES.length; i += 2) {
      weightedVertices.push(1, 0, STRAIGHT_VERTICES[i]!, STRAIGHT_VERTICES[i + 1]!, 1);
    }
    const weighted = pathAttachment({ vertices: weightedVertices, bones: [0] });
    const weightedWorld = followerWorld(doc(weighted, pathConstraint()));
    const unweightedWorld = followerWorld(doc(pathAttachment(), pathConstraint()));

    for (let lane = 0; lane < MAT2X3_STRIDE; lane += 1) {
      expect(weightedWorld[lane]).toBeCloseTo(unweightedWorld[lane]!, 9);
    }
  });

  it('mix 0 leaves the follower at its setup pose (no-op)', () => {
    const world = followerWorld(
      doc(pathAttachment(), pathConstraint({ mixRotate: 0, mixX: 0, mixY: 0 })),
    );

    // follower is a root at the origin with identity setup, untouched by a fully-faded constraint.
    expect(world).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('percent position 1.0 lands on the path end (300, 0)', () => {
    const world = followerWorld(doc(pathAttachment(), pathConstraint({ position: 1 })));

    expect(world[4]).toBeCloseTo(300, 6);
    expect(world[5]).toBeCloseTo(0, 9);
  });

  it('an animated mixX channel blends the follower x from the path point toward its setup', () => {
    // position percent 0.5 => path point (150, 0). mixX is keyed 1 -> 0 over [0, 1], so the follower x is
    // setup.x + mixX * (150 - setup.x) = 150 * mixX (mixY/mixRotate stay 1, so y = 0 and rotation = 0).
    const document = doc(pathAttachment(), pathConstraint());
    document.animations.idle!.path = {
      pc: [
        { time: 0, value: { mixX: 1 }, curve: 'linear' },
        { time: 1, value: { mixX: 0 }, curve: 'linear' },
      ],
    };
    const pose = buildPose(document);
    const followerIndex = pose.boneNames.indexOf('follower');
    const base = followerIndex * MAT2X3_STRIDE;
    for (const [time, expectedX] of [
      [0, 150],
      [0.5, 75],
      [1, 0],
    ] as const) {
      sampleSkeleton(document, 'idle', time, pose);
      expect(pose.world[base + 4]).toBeCloseTo(expectedX, 6);
      expect(pose.world[base + 5]).toBeCloseTo(0, 9);
    }
  });
});
