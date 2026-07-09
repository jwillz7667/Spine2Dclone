import type { RGBA } from '@marionette/format/types';
import {
  SetKeyframeCommand,
  type AnimationId,
  type BoneId,
  type KeyframeTarget,
  type SlotId,
} from '../document';
import { setupDelta, type BoneTransformEdit, type SetupTransform } from '../viewport/setup-delta';

// Manual keyframe buttons (PP-D2): key a bone's current local transform or a slot's current color at the
// playhead ON DEMAND, independent of the auto-key gizmo path. Auto-key writes a keyframe only when a value
// CHANGES; a manual key plants one at the current value so an author can hold a pose or a color across a
// span without nudging it. Every mutation is a document-core SetKeyframe command (LAW 2); this module only
// BUILDS the commands so the decision logic is unit-tested with no React or History. The panel wraps a
// multi-channel bone key in one History interaction session so it is a single undo step.

export type BoneKeyChannel = 'rotate' | 'translate' | 'scale' | 'shear';

export const ALL_BONE_CHANNELS: readonly BoneKeyChannel[] = ['rotate', 'translate', 'scale', 'shear'];

// The desired local transform for a channel, taken from the bone's CURRENT (inspector-displayed) values.
function editForChannel(channel: BoneKeyChannel, t: SetupTransform): BoneTransformEdit {
  switch (channel) {
    case 'rotate':
      return { channel: 'rotate', rotation: t.rotation };
    case 'translate':
      return { channel: 'translate', x: t.x, y: t.y };
    case 'scale':
      return { channel: 'scale', scaleX: t.scaleX, scaleY: t.scaleY };
    case 'shear':
      return { channel: 'shear', shearX: t.shearX, shearY: t.shearY };
  }
}

// One SetKeyframe per requested channel, keying the bone's current transform at `time`. The stored value is
// the setup-relative delta (setupDelta, the sampler's exact inverse) computed against the SAME transform,
// so keying the current value plants a keyframe that reproduces the present pose at `time` (an identity
// delta while the inspector shows the setup pose; the formula stays correct if a posed value is ever fed).
export function buildBoneKeyCommands(
  animationId: AnimationId,
  boneId: BoneId,
  transform: SetupTransform,
  time: number,
  channels: readonly BoneKeyChannel[] = ALL_BONE_CHANNELS,
): SetKeyframeCommand[] {
  return channels.map((channel) => {
    const target: KeyframeTarget = { kind: 'bone', boneId, channel };
    const value = setupDelta(editForChannel(channel, transform), transform);
    return new SetKeyframeCommand(animationId, target, time, value);
  });
}

// A single SetKeyframe keying the slot's current color at `time`. Slot color is stored absolutely (the
// sampler reads the color value directly), so the keyed value is the color as-is.
export function buildSlotColorKeyCommand(
  animationId: AnimationId,
  slotId: SlotId,
  color: RGBA,
  time: number,
): SetKeyframeCommand {
  const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'color' };
  return new SetKeyframeCommand(animationId, target, time, { color });
}
