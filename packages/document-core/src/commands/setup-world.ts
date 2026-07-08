import { CURRENT_FORMAT_VERSION, type WeightedInfluence } from '@marionette/format';
import type { Bone, SkeletonDocument } from '@marionette/format/types';
import {
  buildPose,
  computeWorldTransforms,
  invert,
  MAT2X3_STRIDE,
  resetToSetupPose,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import type { BoneEntity } from '../model/doc-state';
import type { BoneId } from '../model/ids';
import type { DocumentReadModel } from '../model/read-model';

// Setup-pose world transforms for the binding / weight commands (WP-2.3, WP-2.4). The mesh-weight
// pipeline converts vertices between the slot-bone-local flat encoding and per-bone bind-local (vx, vy),
// which needs every bone's SETUP world matrix. This mirrors the editor viewport's scene-solve projection:
// the model bones are projected to a minimal SkeletonDocument (no hash, no validation, the model already
// guarantees the parent-before-child order buildPose relies on) and solved by runtime-core, the
// behavioral source of truth (ADR-0001 permits document-core transform commands to use runtime-core). It
// reads only bones, never writes the format, and never decides an outcome (LAW 1).

// A bone's GLOBAL index is its position in model.bones() (boneOrder), which is exactly the index the
// weighted vertex encoding (ADR-0002) uses and the index the exported bones[] uses, so worldByIndex
// pairs one-to-one with the world matrices runtime-core's solveSkin reads.
export interface SetupWorldSolve {
  readonly bones: readonly BoneEntity[]; // model.bones() order; index-aligned with worldByIndex
  readonly worldByIndex: readonly Mat2x3[];
  readonly worldById: ReadonlyMap<BoneId, Mat2x3>;
  readonly indexById: ReadonlyMap<BoneId, number>;
}

function projectForSolve(model: DocumentReadModel, bones: readonly BoneEntity[]): SkeletonDocument {
  const idToName = new Map<BoneId, string>();
  for (const bone of bones) idToName.set(bone.id, bone.name);
  const projected: Bone[] = bones.map((bone) => ({
    name: bone.name,
    parent: bone.parent === null ? null : (idToName.get(bone.parent) ?? null),
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  }));
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones: projected,
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: [],
    events: [],
    animations: {},
    atlas: { pages: [] },
  };
}

function readWorld(world: Float64Array, index: number): Mat2x3 {
  const base = index * MAT2X3_STRIDE;
  return [
    world[base]!,
    world[base + 1]!,
    world[base + 2]!,
    world[base + 3]!,
    world[base + 4]!,
    world[base + 5]!,
  ];
}

// Solve every bone's setup world matrix, keyed by GLOBAL index and by BoneId. The model's bone order is
// index-aligned with the pose, so the i-th solved matrix belongs to the i-th model bone (and to global
// bone index i in the weighted encoding).
export function solveSetupWorld(model: DocumentReadModel): SetupWorldSolve {
  const bones = model.bones();
  const pose = buildPose(projectForSolve(model, bones));
  resetToSetupPose(pose);
  computeWorldTransforms(pose);

  const worldByIndex: Mat2x3[] = [];
  const worldById = new Map<BoneId, Mat2x3>();
  const indexById = new Map<BoneId, number>();
  for (let i = 0; i < bones.length; i += 1) {
    const world = readWorld(pose.world, i);
    worldByIndex.push(world);
    worldById.set(bones[i]!.id, world);
    indexById.set(bones[i]!.id, i);
  }
  return { bones, worldByIndex, worldById, indexById };
}

// World-space position of a logical vertex from its weighted influences and the per-index setup world
// matrices: pos = sum over influences of weight * (boneWorld * (vx, vy)). For a CONSISTENT binding (every
// influence maps to the same world point, which the bind / paint pipeline maintains by deriving each new
// influence's (vx, vy) from this same world point) this equals that shared point regardless of the
// weights, so it is the stable setup-pose anchor used to re-derive bind-local coordinates. The math
// mirrors runtime-core solveSkin so the editor and the runtime agree.
export function vertexWorldPosition(
  influences: readonly WeightedInfluence[],
  worldByIndex: readonly Mat2x3[],
): readonly [number, number] {
  let px = 0;
  let py = 0;
  for (const influence of influences) {
    const world = worldByIndex[influence.boneIndex];
    if (world === undefined) continue;
    px += influence.weight * (world[0] * influence.vx + world[2] * influence.vy + world[4]);
    py += influence.weight * (world[1] * influence.vx + world[3] * influence.vy + world[5]);
  }
  return [px, py];
}

// The setup world segment (ax, ay, bx, by) of a bone for proximity weighting: the origin is the bone's
// world translation, the tip is its origin plus its length along its local +X axis.
export function boneSegment(
  world: Mat2x3,
  length: number,
): readonly [number, number, number, number] {
  const [ax, ay] = transformPoint(world, 0, 0);
  const [bx, by] = transformPoint(world, length, 0);
  return [ax, ay, bx, by];
}

// Express a world point in a bone's bind-local frame: (vx, vy) = inverse(boneWorld) * (wx, wy).
export function toBindLocal(world: Mat2x3, wx: number, wy: number): readonly [number, number] {
  return transformPoint(invert(world), wx, wy);
}
