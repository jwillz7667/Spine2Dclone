import type { Attachment, Skin } from '@marionette/format/types';
import { describe, expect, it } from 'vitest';
import {
  buildPose,
  MeshAttachmentError,
  sampleMeshVertices,
  sampleSkeleton,
  skinMeshInto,
  transformPoint,
} from '../src';
import type { Mat2x3, Pose } from '../src';
import { rotateKey } from './anim-fixtures';
import { worldOf } from './rig';
import { anim, bone, deformKey, fullDoc, meshAttachment, slot } from './constraint-fixtures';

// WP-2.x sampleMeshVertices: solve-order step 5. Skin a mesh into world space using a pose already
// solved by sampleSkeleton, then ADD the deform offsets post-skin (ADR-0003 section 9). The skinning
// primitives are unit-tested in skin.test.ts; here we test the full integration path.

const skinName = 'default';
const slotName = 's';
const attachmentName = 'm';

const meshSkin = (attachment: Attachment): Skin => ({
  name: skinName,
  attachments: { [slotName]: { [attachmentName]: attachment } },
});

const worldMatOf = (pose: Pose, name: string): Mat2x3 => worldOf(pose, name);

// Expected unweighted skin: each (x, y) setup vertex mapped by the bone world matrix.
const expectUnweighted = (boneWorld: Mat2x3, verts: readonly number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < verts.length; i += 2) {
    const [x, y] = transformPoint(boneWorld, verts[i]!, verts[i + 1]!);
    out.push(x, y);
  }
  return out;
};

describe('sampleMeshVertices unweighted (rigid) mesh', () => {
  it('equals the bone world matrix applied to each setup vertex across times', () => {
    const verts = [10, 0, 0, 10, 5, 5];
    const document = fullDoc({
      bones: [bone('b', null, { x: 4, y: -2, rotation: 15, scaleX: 1.3 })],
      slots: [slot(slotName, 'b')],
      skins: [meshSkin(meshAttachment({ vertices: verts, uvs: [0, 0, 1, 0, 0, 1] }))],
      animations: {
        spin: anim({
          duration: 1,
          bones: { b: { rotate: [rotateKey(0, 0, 'linear'), rotateKey(1, 90, 'linear')] } },
        }),
      },
    });
    const pose = buildPose(document);
    const out = new Float32Array(verts.length);

    for (const t of [0, 0.5, 1]) {
      sampleSkeleton(document, 'spin', t, pose);
      const count = sampleMeshVertices(
        document,
        'spin',
        t,
        pose,
        skinName,
        slotName,
        attachmentName,
        out,
      );
      expect(count).toBe(3);

      const expected = expectUnweighted(worldMatOf(pose, 'b'), verts);
      for (let i = 0; i < expected.length; i += 1) {
        expect(out[i]).toBeCloseTo(expected[i]!, 3);
      }
    }
  });
});

describe('sampleMeshVertices weighted mesh', () => {
  it('reflects linear blend skinning across two bones', () => {
    // One logical vertex, 50/50 between bone 0 (a) and bone 1 (b), bind position (8, 3) in each.
    const bindX = 8;
    const bindY = 3;
    const document = fullDoc({
      bones: [
        bone('a', null, { rotation: 20 }),
        bone('b', 'a', { x: 50, rotation: -35, scaleX: 1.2 }),
      ],
      slots: [slot(slotName, 'a')],
      skins: [
        meshSkin(
          meshAttachment({
            uvs: [0, 0],
            vertices: [2, 0, bindX, bindY, 0.5, 1, bindX, bindY, 0.5],
            bones: [0, 1],
          }),
        ),
      ],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);
    const out = new Float32Array(2);

    sampleSkeleton(document, 'pose', 0, pose);
    const count = sampleMeshVertices(
      document,
      'pose',
      0,
      pose,
      skinName,
      slotName,
      attachmentName,
      out,
    );
    expect(count).toBe(1);

    const [ax, ay] = transformPoint(worldMatOf(pose, 'a'), bindX, bindY);
    const [bx, by] = transformPoint(worldMatOf(pose, 'b'), bindX, bindY);
    expect(out[0]).toBeCloseTo(0.5 * ax + 0.5 * bx, 3);
    expect(out[1]).toBeCloseTo(0.5 * ay + 0.5 * by, 3);
  });

  it('a single full-weight influence equals the unweighted result on that bone', () => {
    const bindX = 12;
    const bindY = -5;
    const sharedBones = [bone('a', null, { x: 3, y: 7, rotation: 25, scaleX: 1.4, scaleY: 0.8 })];
    const slots = [slot(slotName, 'a')];

    const weighted = fullDoc({
      bones: sharedBones,
      slots,
      skins: [
        meshSkin(meshAttachment({ uvs: [0, 0], vertices: [1, 0, bindX, bindY, 1], bones: [0] })),
      ],
      animations: { pose: anim() },
    });
    const unweighted = fullDoc({
      bones: sharedBones,
      slots,
      skins: [meshSkin(meshAttachment({ uvs: [0, 0], vertices: [bindX, bindY] }))],
      animations: { pose: anim() },
    });

    const wPose = buildPose(weighted);
    sampleSkeleton(weighted, 'pose', 0, wPose);
    const wOut = new Float32Array(2);
    sampleMeshVertices(weighted, 'pose', 0, wPose, skinName, slotName, attachmentName, wOut);

    const uPose = buildPose(unweighted);
    sampleSkeleton(unweighted, 'pose', 0, uPose);
    const uOut = new Float32Array(2);
    sampleMeshVertices(unweighted, 'pose', 0, uPose, skinName, slotName, attachmentName, uOut);

    expect(wOut[0]).toBeCloseTo(uOut[0]!, 4);
    expect(wOut[1]).toBeCloseTo(uOut[1]!, 4);
  });
});

describe('sampleMeshVertices deform', () => {
  it('adds the interpolated offsets on top of skinning (post-skin, world space)', () => {
    const verts = [10, 0, 0, 10, 5, 5];
    const full = [10, -4, 2, 2, 0, 6];
    const document = fullDoc({
      bones: [bone('b', null, { rotation: 30, scaleX: 1.2 })],
      slots: [slot(slotName, 'b')],
      skins: [meshSkin(meshAttachment({ vertices: verts, uvs: [0, 0, 1, 0, 0, 1] }))],
      animations: {
        d: anim({
          duration: 1,
          deform: {
            [skinName]: {
              [slotName]: {
                [attachmentName]: [deformKey(0, [0, 0, 0, 0, 0, 0]), deformKey(1, full)],
              },
            },
          },
        }),
      },
    });
    const pose = buildPose(document);
    const out = new Float32Array(verts.length);

    sampleSkeleton(document, 'd', 0.5, pose);
    sampleMeshVertices(document, 'd', 0.5, pose, skinName, slotName, attachmentName, out);

    const skinned = expectUnweighted(worldMatOf(pose, 'b'), verts);
    for (let i = 0; i < skinned.length; i += 1) {
      expect(out[i]).toBeCloseTo(skinned[i]! + full[i]! * 0.5, 3); // linear half offset added on top
    }
  });

  it('leaves the skin unchanged when there is no deform track', () => {
    const verts = [10, 0, 0, 10];
    const document = fullDoc({
      bones: [bone('b', null, { rotation: 40 })],
      slots: [slot(slotName, 'b')],
      skins: [meshSkin(meshAttachment({ vertices: verts, uvs: [0, 0, 1, 0] }))],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);
    sampleSkeleton(document, 'pose', 0, pose);

    const sampled = new Float32Array(verts.length);
    sampleMeshVertices(document, 'pose', 0, pose, skinName, slotName, attachmentName, sampled);

    const skinnedOnly = new Float32Array(verts.length);
    const slotBoneIndex = pose.slotBoneIndices[pose.slotNames.indexOf(slotName)]!;
    skinMeshInto(
      meshAttachment({ vertices: verts, uvs: [0, 0, 1, 0] }),
      pose,
      slotBoneIndex,
      skinnedOnly,
    );

    expect(Array.from(sampled)).toEqual(Array.from(skinnedOnly));
  });

  it('applies deform after skin (world space), not before', () => {
    // A rotated + scaled bone makes skin order observable: deform-after adds the raw world offset,
    // deform-before would push the offset through the bone matrix and land elsewhere.
    const bindX = 3;
    const dx = 5;
    const dy = 7;
    const document = fullDoc({
      bones: [bone('b', null, { rotation: 90, scaleX: 2 })],
      slots: [slot(slotName, 'b')],
      skins: [meshSkin(meshAttachment({ vertices: [bindX, 0], uvs: [0, 0] }))],
      animations: {
        d: anim({
          duration: 1,
          deform: { [skinName]: { [slotName]: { [attachmentName]: [deformKey(0, [dx, dy])] } } },
        }),
      },
    });
    const pose = buildPose(document);
    sampleSkeleton(document, 'd', 0, pose);
    const out = new Float32Array(2);
    sampleMeshVertices(document, 'd', 0, pose, skinName, slotName, attachmentName, out);

    const boneWorld = worldMatOf(pose, 'b');
    const [sx, sy] = transformPoint(boneWorld, bindX, 0);
    const [beforeX, beforeY] = transformPoint(boneWorld, bindX + dx, 0 + dy); // the wrong (pre-skin) order

    expect(out[0]).toBeCloseTo(sx + dx, 6);
    expect(out[1]).toBeCloseTo(sy + dy, 6);
    expect(out[0]).not.toBeCloseTo(beforeX, 3);
    expect(out[1]).not.toBeCloseTo(beforeY, 3);
  });
});

describe('sampleMeshVertices errors', () => {
  const base = fullDoc({
    bones: [bone('b', null)],
    slots: [slot(slotName, 'b')],
    skins: [meshSkin(meshAttachment({ vertices: [1, 0], uvs: [0, 0] }))],
    animations: { pose: anim() },
  });

  it('throws MeshAttachmentError (not-found) for an unknown attachment', () => {
    const pose = buildPose(base);
    sampleSkeleton(base, 'pose', 0, pose);
    const out = new Float32Array(2);

    let thrown: unknown;
    try {
      sampleMeshVertices(base, 'pose', 0, pose, skinName, slotName, 'missing', out);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MeshAttachmentError);
    expect((thrown as MeshAttachmentError).reason).toBe('not-found');
  });

  it('throws MeshAttachmentError (not-a-mesh) for a region attachment', () => {
    const region: Attachment = {
      type: 'region',
      path: 'r',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: 10,
      height: 10,
      color: { r: 1, g: 1, b: 1, a: 1 },
    };
    const document = fullDoc({
      bones: [bone('b', null)],
      slots: [slot(slotName, 'b')],
      skins: [meshSkin(region)],
      animations: { pose: anim() },
    });
    const pose = buildPose(document);
    sampleSkeleton(document, 'pose', 0, pose);
    const out = new Float32Array(2);

    let thrown: unknown;
    try {
      sampleMeshVertices(document, 'pose', 0, pose, skinName, slotName, attachmentName, out);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MeshAttachmentError);
    expect((thrown as MeshAttachmentError).reason).toBe('not-a-mesh');
  });
});
