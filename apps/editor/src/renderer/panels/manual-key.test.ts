import { describe, expect, it } from 'vitest';
import type { AnimationId, BoneId, SlotId } from '../document';
import type { SetupTransform } from '../viewport/setup-delta';
import {
  buildBoneKeyCommands,
  buildSlotColorKeyCommand,
  buildSlotDarkKeyCommand,
} from './manual-key';
import { addAnimation, addBone, createEmptyDocument } from '../dopesheet/seed-document';

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
});
