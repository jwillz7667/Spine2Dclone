import { describe, expect, it } from 'vitest';
import type { AnimationId, BoneId, SlotId } from '../document';
import type { SetupTransform } from '../viewport/setup-delta';
import {
  ALL_BONE_COMPONENT_CHANNELS,
  buildBoneComponentKeyCommands,
  buildBoneKeyCommands,
  buildSlotColorKeyCommand,
  buildSlotColorSplitKeyCommands,
  buildSlotDarkKeyCommand,
} from './manual-key';
import { addAnimation, addBone, addSlot, createEmptyDocument } from '../dopesheet/seed-document';

// A non-identity setup pose: keying its current values must reproduce it, so every delta is identity.
const pose: SetupTransform = {
  rotation: 40,
  x: 12,
  y: -8,
  scaleX: 2,
  scaleY: 0.5,
  shearX: 5,
  shearY: -3,
};

describe('manual keyframe commands (PP-D2)', () => {
  it('keys every bone channel at the playhead as a setup-relative identity delta', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', 2);

    const commands = buildBoneKeyCommands(animId, bone, pose, 0.5);
    expect(commands.map((c) => c.kind)).toEqual(['kf.set', 'kf.set', 'kf.set', 'kf.set']);
    for (const command of commands) doc.history.execute(command);

    // Keying the current value against the same setup is the identity delta on every channel: rotate/
    // shear/translate add (so 0), scale multiplies (so 1). That plants a keyframe reproducing the pose.
    const set = doc.model.getAnimation(animId)!.bones.get(bone)!;
    expect(set.rotate[0]!.value).toEqual({ angle: 0 });
    expect(set.translate[0]!.value).toEqual({ x: 0, y: 0 });
    expect(set.scale[0]!.value).toEqual({ x: 1, y: 1 });
    expect(set.shear[0]!.value).toEqual({ x: 0, y: 0 });
    expect(set.rotate[0]!.time).toBe(0.5);
  });

  it('keys only the requested channels', () => {
    const animId = 'animation_1' as AnimationId;
    const commands = buildBoneKeyCommands(animId, 'bone_1' as BoneId, pose, 0, ['rotate']);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.kind).toBe('kf.set');
  });

  it('keys the slot color as one SetKeyframe at the playhead', () => {
    const animId = 'animation_1' as AnimationId;
    const command = buildSlotColorKeyCommand(
      animId,
      'slot_1' as SlotId,
      { r: 0.2, g: 0.4, b: 0.6, a: 1 },
      1,
    );
    expect(command.kind).toBe('kf.set');
  });

  it('keys the slot dark color as one SetKeyframe at the playhead (PP-D10)', () => {
    const animId = 'animation_1' as AnimationId;
    const command = buildSlotDarkKeyCommand(
      animId,
      'slot_1' as SlotId,
      { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      0.5,
    );
    expect(command.kind).toBe('kf.set');
  });

  it('keys the per-component split channels as scalar setup-relative identity deltas (Stage F2)', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const animId = addAnimation(doc, 'idle', 2);

    const commands = buildBoneComponentKeyCommands(animId, bone, pose, 0.5);
    expect(commands).toHaveLength(ALL_BONE_COMPONENT_CHANNELS.length);
    for (const command of commands) doc.history.execute(command);

    const set = doc.model.getAnimation(animId)!.bones.get(bone)!;
    // translate/shear deltas add (identity 0), scale multiplies (identity 1).
    expect(set.translateX[0]!.value).toEqual({ value: 0 });
    expect(set.translateY[0]!.value).toEqual({ value: 0 });
    expect(set.scaleX[0]!.value).toEqual({ value: 1 });
    expect(set.scaleY[0]!.value).toEqual({ value: 1 });
    expect(set.shearX[0]!.value).toEqual({ value: 0 });
    expect(set.shearY[0]!.value).toEqual({ value: 0 });
    expect(set.translateX[0]!.time).toBe(0.5);
  });

  it('keys only the requested split components', () => {
    const animId = 'animation_1' as AnimationId;
    const commands = buildBoneComponentKeyCommands(animId, 'bone_1' as BoneId, pose, 0, ['scaleX']);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.kind).toBe('kf.set');
  });

  it('keys the slot color as split rgb + alpha SetKeyframes (Stage F2)', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const slot = addSlot(doc, 'body', bone);
    const animId = addAnimation(doc, 'idle', 2);

    const commands = buildSlotColorSplitKeyCommands(
      animId,
      slot,
      { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
      1,
    );
    expect(commands).toHaveLength(2);
    for (const command of commands) doc.history.execute(command);

    const set = doc.model.getAnimation(animId)!.slots.get(slot)!;
    expect(set.rgb[0]!.value).toEqual({ rgb: { r: 0.2, g: 0.4, b: 0.6 } });
    expect(set.alpha[0]!.value).toEqual({ alpha: 0.8 });
    expect(set.color).toHaveLength(0);
  });
});
