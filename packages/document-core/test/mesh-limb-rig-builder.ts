import type { SkeletonDocument } from '@marionette/format/types';
import {
  AddRegionAttachmentCommand,
  AutoWeightFromProximityCommand,
  BindMeshToBonesCommand,
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateIkConstraintCommand,
  CreateSlotCommand,
  GenerateMeshFromRegionCommand,
  SetAtlasRefCommand,
  SetDeformKeyframeCommand,
  SetIkKeyframeCommand,
  SetKeyframeCommand,
  createDocument,
  exportDocument,
  newDocState,
  type BoneGeometry,
  type DocumentEnvironment,
} from '../src';
import { makeIdFactory } from '../src';

// The WP-2.11 integrated milestone rig: a mesh-deformed, weighted, IK-driven limb authored ENTIRELY
// through document-core commands (LAW 2), the Phase-2 Definition-of-Done artifact (DECISION-2.0 named
// this `mesh-limb-rig`). This is a PURE builder (no filesystem): it stands up a Document, drives every
// mutation through doc.history.execute, then projects to the format with exportDocument (which validates
// and stamps the content hash). It mirrors the `rigged` seed but adds the steps that make the limb both
// BEND (a two-bone IK chain driving a weighted skin) and WOBBLE (a deform pose), so the runtime-web
// parity test can prove bone-world AND mesh-vertex determinism across the editor/runtime boundary.
//
// Placement note (boundaries): the builder lives in document-core's test tree because it imports the
// document-core command surface, which packages/conformance is forbidden to import (eslint boundaries:
// conformance allows only format + runtime-core). The asset JSON it produces is committed under
// packages/conformance/assets/mesh-limb-rig and read back by runtime-web via @marionette/format (which
// has no document-core edge), keeping every dependency direction legal.

export const MESH_LIMB_RIG_NAME = 'mesh-limb-rig';
export const MESH_LIMB_RIG_ANIMATION = 'wave';
export const MESH_LIMB_RIG_DURATION = 1;

// The limb sprite region geometry. The mesh GenerateMeshFromRegion builds is a single quad over this
// region (4 logical vertices), so its uvs length is 8 and a deform pose carries 8 offsets (one (dx, dy)
// per logical vertex, the validated DEFORM_OFFSET_LENGTH == uvs.length).
const LIMB_W = 64;
const LIMB_H = 128;

// A default bone setup transform; callers override the fields that matter per bone.
function geom(overrides: Partial<BoneGeometry>): BoneGeometry {
  return {
    name: 'bone',
    length: 50,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
    ...overrides,
  };
}

// Build the mesh-limb-rig through commands and return its exported (validated, hashed) SkeletonDocument.
// A fresh deterministic environment (fixed clock, monotonic id factory) is used so the build is fully
// reproducible: the same command sequence yields the same ids, the same geometry, and the same hash.
export function buildMeshLimbRig(): SkeletonDocument {
  const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
  const doc = createDocument(newDocState(MESH_LIMB_RIG_NAME), env);

  // Bone chain (parent-before-child, the validated invariant): root, upper (child of root), lower (child
  // of upper), plus a `target` the IK reaches and an `ik-target` handle to drive. The IK chain [upper,
  // lower] is parent-then-direct-child, which assertValidIkChain requires.
  const root = doc.ids.mint('bone');
  const upper = doc.ids.mint('bone');
  const lower = doc.ids.mint('bone');
  const target = doc.ids.mint('bone');
  const ikTarget = doc.ids.mint('bone');

  doc.history.execute(new CreateBoneCommand(root, null, geom({ name: 'root', length: 50 })));
  doc.history.execute(
    new CreateBoneCommand(upper, root, geom({ name: 'upper', x: 50, length: 50 })),
  );
  doc.history.execute(
    new CreateBoneCommand(lower, upper, geom({ name: 'lower', x: 50, length: 50 })),
  );
  doc.history.execute(
    new CreateBoneCommand(target, root, geom({ name: 'target', x: 120, y: 20, length: 20 })),
  );
  doc.history.execute(
    new CreateBoneCommand(ikTarget, root, geom({ name: 'ik-target', x: 120, y: -20, length: 20 })),
  );

  // The limb sprite: a slot riding `upper` with a region attachment whose path resolves to the atlas
  // region of the same name. The atlas is set first so the region exists before the attachment refers
  // to it (resolution is validated at export, ATTACHMENT_REGION_MISSING).
  doc.history.execute(
    new SetAtlasRefCommand({
      pages: [
        {
          file: 'mesh-limb-rig.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'limb',
              x: 0,
              y: 0,
              w: LIMB_W,
              h: LIMB_H,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: LIMB_W,
              originalH: LIMB_H,
            },
          ],
        },
      ],
    }),
  );

  const limbSlot = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(limbSlot, {
      name: 'limb',
      bone: upper,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: 'limb',
      blendMode: 'normal',
    }),
  );
  doc.history.execute(
    new AddRegionAttachmentCommand(limbSlot, {
      name: 'limb',
      path: 'limb',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: LIMB_W,
      height: LIMB_H,
      color: { r: 1, g: 1, b: 1, a: 1 },
    }),
  );

  // Make the region an editable mesh (a quad over the region), then bind it to [upper, lower] and seed
  // proximity weights, so the limb is a weighted, skinned mesh that follows the IK-driven bones.
  doc.history.execute(
    new GenerateMeshFromRegionCommand(limbSlot, 'limb', {
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: LIMB_W,
      height: LIMB_H,
      color: { r: 1, g: 1, b: 1, a: 1 },
      vertices: [0, 0, LIMB_W, 0, LIMB_W, LIMB_H, 0, LIMB_H],
    }),
  );
  doc.history.execute(new BindMeshToBonesCommand(limbSlot, 'limb', [upper, lower], 'equalSplit'));
  doc.history.execute(new AutoWeightFromProximityCommand(limbSlot, 'limb'));

  // The two-bone IK constraint on [upper, lower] reaching `target`.
  const ik = doc.ids.mint('ikConstraint');
  doc.history.execute(
    new CreateIkConstraintCommand(ik, 'limb-ik', [upper, lower], target, 1, true),
  );

  // The `wave` animation: the limb BENDS (IK mix ramps 0 -> 1, with bone rotates wobbling) and WOBBLES
  // (a deform pose grows then settles). Times are simple and matched-endpoint where seamless looping
  // matters: the IK mix and bone rotates return to their start at the duration so pose(0) == pose(dur).
  const wave = doc.ids.mint('animation');
  doc.history.execute(
    new CreateAnimationCommand(wave, MESH_LIMB_RIG_ANIMATION, MESH_LIMB_RIG_DURATION),
  );

  // IK mix ramp: 0 at the ends, 1 at the midpoint (a matched-endpoint bend that loops cleanly).
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 0, 0, true));
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 0.5, 1, true));
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 1, 0, true));

  // Bone rotates: the upper and lower bones wobble, matched endpoints (0 -> swing -> 0).
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: upper, channel: 'rotate' }, 0, {
      angle: 0,
    }),
  );
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: upper, channel: 'rotate' }, 0.5, {
      angle: 25,
    }),
  );
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: upper, channel: 'rotate' }, 1, {
      angle: 0,
    }),
  );
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: lower, channel: 'rotate' }, 0, {
      angle: 0,
    }),
  );
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: lower, channel: 'rotate' }, 0.5, {
      angle: -15,
    }),
  );
  doc.history.execute(
    new SetKeyframeCommand(wave, { kind: 'bone', boneId: lower, channel: 'rotate' }, 1, {
      angle: 0,
    }),
  );

  // Deform pose on the limb mesh (default skin): the 8 offsets (one (dx, dy) per logical vertex) grow at
  // the midpoint and settle back, so the mesh wobbles on TOP of the IK-driven skin. Matched endpoints
  // keep the loop seamless.
  const flat = [0, 0, 0, 0, 0, 0, 0, 0];
  const wobble = [0, 4, 6, 0, 6, 0, 0, 4];
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 0, flat));
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 0.5, wobble));
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 1, flat));

  return exportDocument(doc.model);
}
