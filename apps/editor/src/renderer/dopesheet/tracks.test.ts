import { describe, expect, it } from 'vitest';
import type { BoneId, DeformSkinKey, IkConstraintId, SlotId, TransformConstraintId } from '../document';
import { buildTracks, visibleRowRange, type TrackNames } from './tracks';
import {
  addAnimation,
  addBone,
  addIkConstraint,
  addSlot,
  addTransformConstraint,
  createEmptyDocument,
  setAttachmentKeys,
  setIkKeys,
  setRotateKeys,
  setTransformKeys,
} from './seed-document';

function names(doc: ReturnType<typeof createEmptyDocument>): TrackNames {
  return {
    boneName: (id: BoneId) => doc.model.getBone(id)?.name ?? id,
    slotName: (id: SlotId) => doc.model.getSlot(id)?.name ?? id,
    ikName: (id: IkConstraintId) => doc.model.getIkConstraint(id)?.name ?? id,
    transformName: (id: TransformConstraintId) => doc.model.getTransformConstraint(id)?.name ?? id,
    skinName: (key: DeformSkinKey) =>
      key === 'default' ? 'default' : (doc.model.getSkin(key)?.name ?? key),
  };
}

describe('dopesheet tracks', () => {
  it('emits a group row plus only the non-empty channel rows for an animated bone', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const anim = addAnimation(doc, 'idle', 1.2);
    setRotateKeys(doc, anim, bone, [
      { time: 0, value: { angle: 0 } },
      { time: 0.6, value: { angle: 8 } },
    ]);

    const rows = buildTracks(doc.model.getAnimation(anim)!, names(doc));

    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual(['group:root', 'channel:Rotate']);
    const channel = rows[1];
    expect(channel?.kind).toBe('channel');
    if (channel?.kind === 'channel') {
      expect(channel.target).toEqual({ kind: 'bone', boneId: bone, channel: 'rotate' });
      expect(channel.keyframes).toHaveLength(2);
    }
  });

  it('emits attachment, IK, and transform timeline rows alongside bone channels', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const tip = addBone(doc, 'tip');
    const slot = addSlot(doc, 'body', bone);
    const anim = addAnimation(doc, 'idle', 2);
    setRotateKeys(doc, anim, bone, [{ time: 0, value: { angle: 0 } }]);
    setAttachmentKeys(doc, anim, slot, [0, 1]);
    const ik = addIkConstraint(doc, 'reach', bone, tip);
    setIkKeys(doc, anim, ik, [0.5]);
    const tc = addTransformConstraint(doc, 'copy', bone, tip);
    setTransformKeys(doc, anim, tc, [0.25, 0.75]);

    const rows = buildTracks(doc.model.getAnimation(anim)!, names(doc));

    expect(rows.map((row) => `${row.kind}:${row.label}`)).toEqual([
      'group:root',
      'channel:Rotate',
      'group:body',
      'timeline:Attachment',
      'group:reach',
      'timeline:Mix',
      'group:copy',
      'timeline:Mix',
    ]);
    const attachment = rows[3];
    expect(attachment?.kind).toBe('timeline');
    if (attachment?.kind === 'timeline') expect(attachment.keyframes).toHaveLength(2);
    const transformRow = rows[7];
    if (transformRow?.kind === 'timeline') expect(transformRow.keyframes).toHaveLength(2);
  });

  it('returns no rows for an animation with no keyframes', () => {
    const doc = createEmptyDocument();
    addBone(doc, 'root');
    const anim = addAnimation(doc, 'empty', 1);
    expect(buildTracks(doc.model.getAnimation(anim)!, names(doc))).toEqual([]);
  });

  it('clamps the visible row range and pads by one row each side', () => {
    expect(visibleRowRange(0, 100, 20, 10)).toEqual([0, 6]);
    expect(visibleRowRange(40, 100, 20, 10)).toEqual([1, 8]);
    expect(visibleRowRange(0, 0, 20, 10)).toEqual([0, 0]);
    expect(visibleRowRange(0, 100, 20, 0)).toEqual([0, 0]);
  });
});
