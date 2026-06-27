import type { AtlasRef } from '@marionette/format/types';
import type { Command, CommandContext, SelectionHint } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { CommandSpec } from './spec';

// Set the document's preserved atlas (command-history catalog SetAtlasRef, `atlas.set`). The atlas pack
// pipeline runs in the main process and hands a fresh AtlasRef in; this command is the only legal path
// that sets it on the live document (LAW 2), unblocking sprite attachment (WP-1.2). It never computes a
// content hash (the exporter is the sole hash owner, LAW 3); it only replaces the field. Never coalesces;
// memento-based, absolute before/after.
export class SetAtlasRefCommand implements Command {
  readonly kind = 'atlas.set';
  readonly label = 'Set Atlas';
  private before: AtlasRef | undefined;

  constructor(private readonly atlas: AtlasRef) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      // preserved().atlas is deeply frozen, so capturing the reference is a safe immutable memento that
      // cannot be mutated underneath us; redo replays the stored value rather than recapturing.
      this.before = ctx.mutate.preserved().atlas;
    }
    ctx.mutate.setAtlas(this.atlas);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setAtlas(this.before);
  }

  // An atlas import changes no bone/slot selection, so the current selection is preserved across the
  // do/undo/redo of this command.
  selectionHint(): SelectionHint {
    return { kind: 'preserve' };
  }
}

export const setAtlasRefSpec: CommandSpec = {
  kind: 'atlas.set',
  // 'minimal' seeds an empty atlas ({ pages: [] }); setting a one-page, one-region atlas is a real delta.
  representativeSeedId: 'minimal',
  fixture: () => ({
    command: new SetAtlasRefCommand({
      pages: [
        {
          file: 'atlas.png',
          width: 256,
          height: 256,
          regions: [
            {
              name: 'region_0',
              x: 4,
              y: 8,
              w: 32,
              h: 48,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 32,
              originalH: 48,
            },
          ],
        },
      ],
    }),
  }),
  assertApplied: (before, after) => {
    const totalRegions = (atlas: AtlasRef): number =>
      atlas.pages.reduce((sum, page) => sum + page.regions.length, 0);
    const b = before.preserved.atlas;
    const a = after.preserved.atlas;
    // The fixture atlas differs from every seed's atlas in its page count or region count, so equal
    // counts on both axes means the command produced no atlas delta.
    if (a.pages.length === b.pages.length && totalRegions(a) === totalRegions(b)) {
      throw new Error('atlas.set produced no atlas delta');
    }
    if (after.bones.length !== before.bones.length || after.slots.length !== before.slots.length) {
      throw new Error('atlas.set changed bones or slots outside the atlas');
    }
  },
};
