import type { SkeletonMeta } from '@marionette/format/types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { CommandSpec } from './spec';

// Set the document metadata block (command-history Stage F1, `document.setMetadata`; PP-D9): the authoring
// frame rate (fps) and the project-relative source-asset directories (imagesPath / audioPath). The value is
// replaced WHOLESALE (undefined clears the block). before/after are value mementos, and it COALESCES with a
// prior SetDocumentMetadata (there is only one metadata block, so it is always the same target) so an fps
// slider drag folds to a single undo step.
export class SetDocumentMetadataCommand implements Command {
  readonly kind = 'document.setMetadata';
  readonly label = 'Set Document Metadata';
  private before: SkeletonMeta | undefined;
  private captured = false;

  constructor(private readonly metadata: SkeletonMeta | undefined) {}

  do(ctx: CommandContext): void {
    if (!this.captured) {
      this.before = ctx.mutate.metadata();
      this.captured = true;
    }
    ctx.mutate.setMetadata(this.metadata);
  }

  undo(ctx: CommandContext): void {
    if (!this.captured) throw new CommandNotAppliedError(this.kind);
    ctx.mutate.setMetadata(this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (prev instanceof SetDocumentMetadataCommand && prev.captured) {
      const merged = new SetDocumentMetadataCommand(this.metadata);
      merged.before = prev.before;
      merged.captured = true;
      return merged;
    }
    return null;
  }
}

export const setDocumentMetadataSpec: CommandSpec = {
  kind: 'document.setMetadata',
  // 'minimal' has no metadata block (undefined), so setting one is a real delta; the round-trip also
  // exercises the undefined-restore on undo. On 'evented' (which has a block) the fixture bumps fps instead.
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const current = model.metadata();
    const nextFps = current?.fps === undefined ? 30 : current.fps + 30;
    return { command: new SetDocumentMetadataCommand({ fps: nextFps }) };
  },
  assertApplied: (before, after) => {
    if (after.metadata?.fps === undefined) {
      throw new Error('document.setMetadata did not set the fps');
    }
    if (after.metadata.fps === before.metadata?.fps) {
      throw new Error('document.setMetadata produced no metadata delta');
    }
  },
};
