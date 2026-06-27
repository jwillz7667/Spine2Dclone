import type {
  AnimationEntity,
  BoneChannel,
  BoneId,
  KeyframeId,
  KeyframeTarget,
  SlotId,
} from '../document';

// Pure track-tree derivation for the dopesheet (WP-1.6, TASK-1.6.1). The active animation's timelines
// project to a flat row list: one group row per animated bone/slot, then one channel row per non-empty
// channel under it. Empty channels and entities with no keyframes are omitted. Ordering is stable and
// rename-responsive (group rows sort by resolved name, then by branded id as a tiebreak) so the rows do
// not jump around between revisions.

export interface GroupRow {
  readonly kind: 'group';
  readonly key: string;
  readonly label: string;
}

export interface ChannelKey {
  readonly id: KeyframeId;
  readonly time: number;
}

export interface ChannelRow {
  readonly kind: 'channel';
  readonly key: string;
  readonly label: string;
  readonly target: KeyframeTarget;
  readonly keyframes: readonly ChannelKey[];
}

export type TrackRow = GroupRow | ChannelRow;

export interface TrackNames {
  boneName(id: BoneId): string;
  slotName(id: SlotId): string;
}

const BONE_CHANNELS: readonly BoneChannel[] = ['rotate', 'translate', 'scale', 'shear'];
const BONE_CHANNEL_LABELS: Record<BoneChannel, string> = {
  rotate: 'Rotate',
  translate: 'Translate',
  scale: 'Scale',
  shear: 'Shear',
};

function compareLabel(aName: string, aId: string, bName: string, bId: string): number {
  if (aName !== bName) return aName < bName ? -1 : 1;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function buildTracks(animation: AnimationEntity, names: TrackNames): TrackRow[] {
  const rows: TrackRow[] = [];

  const boneGroups = [...animation.bones.entries()]
    .map(([boneId, set]) => ({ boneId, set, name: names.boneName(boneId) }))
    .sort((a, b) => compareLabel(a.name, a.boneId, b.name, b.boneId));
  for (const { boneId, set, name } of boneGroups) {
    const channels = BONE_CHANNELS.filter((channel) => set[channel].length > 0);
    if (channels.length === 0) continue;
    rows.push({ kind: 'group', key: `bone:${boneId}`, label: name });
    for (const channel of channels) {
      rows.push({
        kind: 'channel',
        key: `bone:${boneId}:${channel}`,
        label: BONE_CHANNEL_LABELS[channel],
        target: { kind: 'bone', boneId, channel },
        keyframes: set[channel].map((kf) => ({ id: kf.id, time: kf.time })),
      });
    }
  }

  const slotGroups = [...animation.slots.entries()]
    .map(([slotId, set]) => ({ slotId, set, name: names.slotName(slotId) }))
    .sort((a, b) => compareLabel(a.name, a.slotId, b.name, b.slotId));
  for (const { slotId, set, name } of slotGroups) {
    if (set.color.length === 0) continue;
    rows.push({ kind: 'group', key: `slot:${slotId}`, label: name });
    rows.push({
      kind: 'channel',
      key: `slot:${slotId}:color`,
      label: 'Color',
      target: { kind: 'slot', slotId, channel: 'color' },
      keyframes: set.color.map((kf) => ({ id: kf.id, time: kf.time })),
    });
  }

  return rows;
}

// The inclusive row index range visible in a viewport of `heightPx` pixels scrolled by `scrollY`, padded
// by one row each side so partially-scrolled rows render (vertical virtualization, TASK-1.6.8).
export function visibleRowRange(
  scrollY: number,
  heightPx: number,
  rowHeight: number,
  rowCount: number,
): readonly [number, number] {
  if (rowCount === 0 || heightPx <= 0) return [0, 0];
  const first = Math.max(0, Math.floor(scrollY / rowHeight) - 1);
  const last = Math.min(rowCount, Math.ceil((scrollY + heightPx) / rowHeight) + 1);
  return [first, last];
}
