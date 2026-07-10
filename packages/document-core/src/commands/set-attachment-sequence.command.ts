import type { Sequence } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SequenceError } from '../command/errors';
import type { SlotId } from '../model/ids';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Set or CLEAR the Stage F2 frame-sequence block on a region or mesh attachment (`attach.sequence.set`,
// PP-D10; ADR-0009 section 3). A non-null sequence describes frame playback (count/start/digits/setupIndex);
// null clears it. The command validates the shape at the boundary mirroring the format schema: count >= 1,
// start/digits/setupIndex are non-negative integers, and setupIndex is in [0, count) (SEQUENCE_SETUP_RANGE).
// A bad shape or a missing/non-region-mesh target is rejected BEFORE any mutation with a typed SequenceError.
// before/after are the exact prior sequence (or absent), so undo is bit-exact. Never coalesces.
export class SetAttachmentSequenceCommand implements Command {
  readonly kind = 'attach.sequence.set';
  readonly label = 'Set Attachment Sequence';
  private before: Sequence | undefined;
  private beforeCaptured = false;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly sequence: Sequence | null,
  ) {}

  do(ctx: CommandContext): void {
    if (!this.beforeCaptured) {
      const att = ctx.mutate.getAttachment(this.slotId, this.name);
      if (att === undefined || (att.kind !== 'region' && att.kind !== 'mesh')) {
        throw new SequenceError('notFound', `${this.name} on slot ${this.slotId}`);
      }
      if (this.sequence !== null) assertValidSequence(this.sequence);
      this.before = att.sequence;
      this.beforeCaptured = true;
    }
    ctx.mutate.setAttachmentSequence(this.slotId, this.name, this.sequence ?? undefined);
  }

  undo(ctx: CommandContext): void {
    if (!this.beforeCaptured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setAttachmentSequence(this.slotId, this.name, this.before);
  }
}

// Reject a malformed sequence at the command boundary (the author-time mirror of the format's structural
// checks). A negative/non-integer count/start/digits/setupIndex is 'shape'; an out-of-range setupIndex is
// 'setupRange' (the format's SEQUENCE_SETUP_RANGE).
function assertValidSequence(seq: Sequence): void {
  const nonNegInt = (v: number): boolean => Number.isInteger(v) && v >= 0;
  if (!Number.isInteger(seq.count) || seq.count < 1) {
    throw new SequenceError('shape', `count ${seq.count} must be an integer >= 1`);
  }
  if (!nonNegInt(seq.start) || !nonNegInt(seq.digits) || !nonNegInt(seq.setupIndex)) {
    throw new SequenceError('shape', 'start/digits/setupIndex must be non-negative integers');
  }
  if (seq.setupIndex >= seq.count) {
    throw new SequenceError(
      'setupRange',
      `setupIndex ${seq.setupIndex} must be in [0, ${seq.count})`,
    );
  }
}

export const setAttachmentSequenceSpec: CommandSpec = {
  kind: 'attach.sequence.set',
  // 'linked' carries the plain mesh 'panel' on 'mesh_slot' to attach a sequence to.
  representativeSeedId: 'linked',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const mesh = model.attachments(slot.id).find((a) => a.kind === 'mesh');
      if (mesh === undefined) continue;
      return {
        command: new SetAttachmentSequenceCommand(slot.id, mesh.name, {
          count: 4,
          start: 0,
          digits: 2,
          setupIndex: 0,
        }),
      };
    }
    return null;
  },
  assertApplied: (before, after) => {
    for (const slot of before.slots) {
      const mesh = before.attachments.find((a) => a.slotId === slot.id && a.kind === 'mesh');
      if (mesh === undefined) continue;
      const updated = findAttachmentSnapshot(after, slot.id, mesh.name);
      if (updated === undefined || updated.kind !== 'mesh' || updated.sequence === undefined) {
        throw new Error('attach.sequence.set did not set the sequence');
      }
      if (updated.sequence.count !== 4) {
        throw new Error('attach.sequence.set did not store the fixture sequence');
      }
      return;
    }
    throw new Error('attach.sequence.set fixture seed had no mesh');
  },
};
