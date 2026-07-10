import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import { pathGeometryOf, type PathGeometry } from '../model/doc-state';
import type { SlotId } from '../model/ids';
import { requirePath } from './path-support';
import { findAttachmentSnapshot, type CommandSpec } from './spec';

// Set a path spline's `constantSpeed` flag (command-history catalog SetPathConstantSpeed,
// `path.setConstantSpeed`; PP-D11). The flag selects arc-length (uniform-speed) vs naive-`t`
// parametrization at solve time (Lane B); it changes neither the control points nor the arc-length table,
// so this is a pure flag flip. Setting it to its current value is a no-op. undo restores the prior geometry.
export class SetPathConstantSpeedCommand implements Command {
  readonly kind = 'path.setConstantSpeed';
  readonly label = 'Set Path Constant Speed';
  private before: PathGeometry | undefined;
  private after: PathGeometry | undefined;

  constructor(
    private readonly slotId: SlotId,
    private readonly name: string,
    private readonly constantSpeed: boolean,
  ) {}

  do(ctx: CommandContext): void {
    const path = requirePath(ctx, this.slotId, this.name);
    if (this.before === undefined || this.after === undefined) {
      const before = pathGeometryOf(path);
      this.before = before;
      this.after =
        before.constantSpeed === this.constantSpeed
          ? before
          : { ...before, constantSpeed: this.constantSpeed };
    }
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.after);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setPathGeometry(this.slotId, this.name, this.before);
  }
}

export const setPathConstantSpeedSpec: CommandSpec = {
  kind: 'path.setConstantSpeed',
  representativeSeedId: 'pathed',
  fixture: (model) => {
    for (const slot of model.slots()) {
      const att = model.attachments(slot.id).find((a) => a.kind === 'path');
      if (att && att.kind === 'path') {
        return { command: new SetPathConstantSpeedCommand(slot.id, att.name, !att.constantSpeed) };
      }
    }
    return null;
  },
  assertApplied: (before, after) => {
    let toggled = false;
    for (const b of before.attachments) {
      if (b.kind !== 'path') continue;
      const a = findAttachmentSnapshot(after, b.slotId, b.name);
      if (!a || a.kind !== 'path') continue;
      if (a.constantSpeed !== b.constantSpeed) toggled = true;
    }
    if (!toggled) throw new Error('path.setConstantSpeed did not change the flag');
  },
};
