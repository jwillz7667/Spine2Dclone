import type {
  BoneChannel,
  BoneId,
  KeyframeEntity,
  KeyframeTarget,
  KeyframeValue,
  SlotId,
} from '../document';

// One copied keyframe held in the editor-state clipboard (section 6 keyClipboard). It carries the entity
// ref + channel it came from, its time RELATIVE to the earliest copied key (`relTime`, so a multi-key
// copy keeps its internal spacing), and its value + curve. Paste mints brand-new keyframes at
// `playhead + relTime`, so the clipboard holds values, never live KeyframeIds. The targetRef/channel
// pairing is a discriminated union so a bone ref is type-locked to a bone channel and a slot ref to
// 'color'.
export type CopiedKeyframe =
  | {
      readonly targetRef: { readonly kind: 'bone'; readonly boneId: BoneId };
      readonly channel: BoneChannel;
      readonly relTime: number;
      readonly value: KeyframeValue;
      readonly curve: KeyframeEntity['curve'];
    }
  | {
      readonly targetRef: { readonly kind: 'slot'; readonly slotId: SlotId };
      readonly channel: 'color';
      readonly relTime: number;
      readonly value: KeyframeValue;
      readonly curve: KeyframeEntity['curve'];
    };

// Reconstruct the absolute channel target a copied keyframe pastes into. `channel` is the discriminant:
// 'color' belongs only to the slot variant, every other channel to the bone variant.
export function pasteTargetOf(copied: CopiedKeyframe): KeyframeTarget {
  if (copied.channel === 'color') {
    return { kind: 'slot', slotId: copied.targetRef.slotId, channel: 'color' };
  }
  return { kind: 'bone', boneId: copied.targetRef.boneId, channel: copied.channel };
}
