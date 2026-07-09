import type { RGBA } from '@marionette/format/types';
import {
  SetKeyframeCommand,
  type AnimationId,
  type BoneComponentChannel,
  type BoneId,
  type KeyframeTarget,
  type SlotId,
} from '../document';
import {
  setupComponentDelta,
  setupDelta,
  type BoneTransformEdit,
  type SetupTransform,
} from '../viewport/setup-delta';

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

// The six per-component bone channels (Stage F2, ADR-0009 section 4.1) and their inspector labels. A bone
// keys a joint channel OR its split components, never both (TIMELINE_COMPONENT_CONFLICT), so the panel
// offers the split Key buttons as an alternative to the joint ones; the command rejects a conflicting mix.
export const ALL_BONE_COMPONENT_CHANNELS: readonly BoneComponentChannel[] = [
  'translateX',
  'translateY',
  'scaleX',
  'scaleY',
  'shearX',
  'shearY',
];

// One SetKeyframe per requested per-component channel, keying that axis of the bone's current transform at
// `time` as a scalar setup-relative delta (setupComponentDelta, the per-axis analogue of buildBoneKeyCommands).
export function buildBoneComponentKeyCommands(
  animationId: AnimationId,
  boneId: BoneId,
  transform: SetupTransform,
  time: number,
  channels: readonly BoneComponentChannel[] = ALL_BONE_COMPONENT_CHANNELS,
): SetKeyframeCommand[] {
  return channels.map((channel) => {
    const target: KeyframeTarget = { kind: 'bone', boneId, channel };
    const value = setupComponentDelta(channel, transform, transform);
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

// A single SetKeyframe keying the slot's current two-color DARK tint at `time` (PP-D10). The command rejects
// keying a slot with no setup dark color (ANIM_DARK_NO_SETUP), so the panel offers this only when the slot
// has one; the value is the dark color as-is (stored absolutely, like the joint color).
export function buildSlotDarkKeyCommand(
  animationId: AnimationId,
  slotId: SlotId,
  darkColor: RGBA,
  time: number,
): SetKeyframeCommand {
  const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'dark' };
  return new SetKeyframeCommand(animationId, target, time, { color: darkColor });
}
