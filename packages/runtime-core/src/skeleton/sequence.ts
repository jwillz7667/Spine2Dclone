import type { SequenceMode, SkeletonDocument } from '@marionette/format/types';
import type { Pose } from './pose';
import { AnimationNotFoundError } from './sample';

// Sequence-attachment frame resolution (ADR-0009 section 3, ADR-0011 section 2). A region or mesh
// attachment may carry a `sequence` block (count frames, a setup frame, a naming template); a per-slot
// `sequence` timeline then drives which frame is shown over time, in one of seven playback modes. The
// resolved frame is a DISCRETE integer in [0, count), computed by pure integer arithmetic so all three
// runtimes agree EXACTLY (no float tolerance). This file resolves the integer frame; turning it into an
// atlas region name (path + zero-padded start + frame) is a renderer concern, not a solve concern.

// Non-negative modulo (JavaScript `%` keeps the sign of the dividend; sequence wrapping needs a
// non-negative residue for the reverse modes where `index - advanced` can go negative).
function mod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

// Triangle wave over [0, count-1] with period 2*(count-1): 0,1,...,count-1,count-2,...,1,0,1,... It maps a
// monotonically advancing position onto a bouncing frame index (pingpong). Symmetric, so feeding it a
// descending position (index - advanced) yields the reverse-direction bounce (pingpongReverse).
function triangle(position: number, count: number): number {
  const period = 2 * (count - 1);
  const m = mod(position, period);
  return m <= count - 1 ? m : period - m;
}

// Resolve the frame index for an active sequence key. `elapsed` is time since the key (>= 0), `delay` is
// seconds per frame, `index` the key's starting frame, `count` the sequence length. A non-positive delay
// (or count 1) advances no frames (holds). Every branch returns an integer in [0, count).
export function resolveSequenceFrame(
  mode: SequenceMode,
  index: number,
  delay: number,
  count: number,
  elapsed: number,
): number {
  if (count <= 1) return 0;
  const last = count - 1;
  const advanced = delay > 0 && elapsed > 0 ? Math.floor(elapsed / delay) : 0;
  switch (mode) {
    case 'hold':
      return index < 0 ? 0 : index > last ? last : index;
    case 'once':
      return Math.min(index + advanced, last);
    case 'loop':
      return mod(index + advanced, count);
    case 'pingpong':
      return triangle(index + advanced, count);
    case 'onceReverse':
      return Math.max(index - advanced, 0);
    case 'loopReverse':
      return mod(index - advanced, count);
    case 'pingpongReverse':
      return triangle(index - advanced, count);
  }
}

// The `sequence` block (count + setup frame) of the slot's ACTIVE attachment, searched across skins. A
// region or mesh attachment may carry it; the first attachment named `attachmentName` under `slotName`
// that has a sequence wins (conformance rigs define it in one skin). Null when the active attachment has
// no sequence block.
function findSequenceBlock(
  document: SkeletonDocument,
  slotName: string,
  attachmentName: string,
): { count: number; setupIndex: number } | null {
  for (const skin of document.skins) {
    const attachment = skin.attachments[slotName]?.[attachmentName];
    if (attachment === undefined) continue;
    if (attachment.type === 'region' || attachment.type === 'mesh') {
      const sequence = attachment.sequence;
      if (sequence !== undefined) return { count: sequence.count, setupIndex: sequence.setupIndex };
    }
  }
  return null;
}

// Resolve the discrete sequence FRAME INDEX for a slot at time t. Reuses a pose already solved by
// sampleSkeleton (it reads the slot's resolved active attachment). Returns -1 when the slot has no active
// sequence attachment (nothing to resolve); the attachment's `setupIndex` when the slot has a sequence
// attachment but no active timeline key at t (before the first key, or no `sequence` timeline); otherwise
// the mode-resolved frame from the active key. Allocation-free: a linear scan of the (short) key list.
export function sampleSlotSequenceFrame(
  document: SkeletonDocument,
  animationId: string,
  t: number,
  pose: Pose,
  slotName: string,
): number {
  const slotIndex = pose.slotNames.indexOf(slotName);
  if (slotIndex < 0) return -1;
  const attachmentName = pose.slotAttachment[slotIndex];
  if (attachmentName === null || attachmentName === undefined) return -1;

  const block = findSequenceBlock(document, slotName, attachmentName);
  if (block === null) return -1;

  const animation = document.animations[animationId];
  if (animation === undefined) throw new AnimationNotFoundError(animationId);
  const timeline = animation.slots[slotName]?.sequence;
  if (timeline === undefined || timeline.length === 0) return block.setupIndex;

  // The active key is the last one whose time is at or before t (keys are strict-ascending). Before the
  // first key the sequence shows its setup frame.
  let active: (typeof timeline)[number] | null = null;
  for (let i = 0; i < timeline.length; i += 1) {
    const key = timeline[i]!;
    if (key.time <= t) active = key;
    else break;
  }
  if (active === null) return block.setupIndex;
  return resolveSequenceFrame(
    active.mode,
    active.index,
    active.delay,
    block.count,
    t - active.time,
  );
}
