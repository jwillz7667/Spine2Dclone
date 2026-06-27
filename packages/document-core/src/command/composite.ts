import type { Command, CommandContext, HistoryPhase, SelectionHint } from './command';

// An ordered list of child commands (command-history Section 4.4). `do` runs children forward; `undo`
// runs them in strict reverse. A composite pushes exactly one undo entry and never coalesces. It is
// the composition primitive for multi-step operations (and what an interaction session collapses to
// when it captured more than one distinct target).
export class CompositeCommand implements Command {
  readonly kind = 'composite';
  // Composites never coalesce: coalesceWith is intentionally omitted (an absent optional method).

  constructor(
    readonly label: string,
    private readonly children: readonly Command[],
    private readonly hint?: (phase: HistoryPhase) => SelectionHint | undefined,
  ) {}

  do(ctx: CommandContext): void {
    for (const child of this.children) child.do(ctx);
  }

  undo(ctx: CommandContext): void {
    for (let i = this.children.length - 1; i >= 0; i -= 1) {
      const child = this.children[i];
      if (child) child.undo(ctx);
    }
  }

  selectionHint(phase: HistoryPhase): SelectionHint | undefined {
    return this.hint?.(phase);
  }
}
