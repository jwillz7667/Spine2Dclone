import type { DocumentModelInternal } from '../model/internal';
import { createMutator, type Mutator } from '../model/mutator';
import type { Command, CommandContext, HistoryEvent, HistoryPhase } from './command';
import { CompositeCommand } from './composite';
import { HistoryReentrancyError } from './errors';

// Single source of truth for the two tunables (command-history D6). DocumentEnvironment and HistoryDeps
// forward optional overrides; History is the ONLY place a default is applied.
export const HISTORY_DEFAULTS = { maxDepth: 500, coalesceWindowMs: 250 } as const;

export interface HistoryDeps {
  readonly model: DocumentModelInternal;
  readonly now: () => number; // injected clock; no default here (no performance.now in this module)
  readonly maxDepth?: number;
  readonly coalesceWindowMs?: number;
}

// The undo/redo engine (command-history Section 5). It owns the privileged Mutator (the only one in
// the system), the past/future stacks, the coalescing policy, and the commit notification channel.
// All time comes from the injected clock, so tests are reproducible and no hidden global is read.
export class History {
  private past: Command[] = [];
  private future: Command[] = [];
  private readonly mutator: Mutator;
  private readonly ctx: CommandContext;
  private readonly windowMs: number;
  private readonly maxDepthValue: number;
  private lastAt = 0;
  private session: Command[] | null = null; // non-null while inside begin/endInteraction
  private notifying = false; // commit re-entrancy guard
  private readonly listeners = new Set<(event: HistoryEvent) => void>();

  constructor(private readonly deps: HistoryDeps) {
    this.mutator = createMutator(deps.model);
    this.ctx = { mutate: this.mutator, ids: deps.model.ids };
    this.windowMs = deps.coalesceWindowMs ?? HISTORY_DEFAULTS.coalesceWindowMs;
    this.maxDepthValue = deps.maxDepth ?? HISTORY_DEFAULTS.maxDepth;
  }

  // COMMITTED == mutates committed state and updates the stacks. Discrete execute (push or
  // window-merge), endInteraction (push), undo, and redo are committed and fire exactly one
  // HistoryEvent. In-session execute is NOT committed (it only applies the mutation for live feedback)
  // and fires no HistoryEvent.
  execute(cmd: Command): HistoryEvent | null {
    // Reject a re-entrant call (a commit listener that mutates history) BEFORE any mutation, so the
    // model and the stacks are never left in a corrupted state (the guard prevents, not just detects).
    this.assertNotNotifying(cmd.kind);
    cmd.do(this.ctx); // applies the mutation; bumps model.revision
    if (this.session) {
      this.coalesceIntoSession(cmd);
      return null;
    }
    const now = this.deps.now();
    const prev = this.past[this.past.length - 1];
    if (prev && cmd.coalesceWith && now - this.lastAt < this.windowMs) {
      const merged = cmd.coalesceWith(prev);
      if (merged) this.past[this.past.length - 1] = merged;
      else this.past.push(cmd);
    } else {
      this.past.push(cmd);
    }
    this.future.length = 0; // a new action clears redo
    this.lastAt = now;
    this.enforceDepth();
    return this.commit('execute', cmd);
  }

  beginInteraction(): void {
    this.assertNotNotifying('beginInteraction');
    this.session = [];
    this.deps.model.beginBatch(); // switch to in-place mutation for this gesture
  }

  endInteraction(label: string): HistoryEvent | null {
    this.assertNotNotifying('endInteraction');
    const batch = this.session ?? [];
    this.session = null;
    this.deps.model.commitBatch(); // single copy-on-write boundary, exit batch mode
    if (batch.length === 0) return null;
    const first = batch[0];
    const entry = batch.length === 1 && first ? first : new CompositeCommand(label, batch);
    this.past.push(entry); // exactly ONE undo step for the whole gesture
    this.future.length = 0;
    // A completed gesture is a deterministic undo boundary: prevent a later discrete same-target edit
    // from window-merging into it (sessions are primary, the window is a fallback for gestureless
    // edits, command-history Section 5.2). A sentinel lastAt makes the next execute start a new step.
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.enforceDepth();
    return this.commit('execute', entry);
  }

  // Discard the open interaction group (command-history Section 5.7, TASK-2.1.0): on Escape mid-drag,
  // undo every command applied during the session in REVERSE order, then exit batch mode and drop the
  // session. Each command was applied in-place (batch mode), so undoing in-place restores the live model
  // to the pre-interaction state deep-equal. NOTHING is pushed to the undo/redo stacks (a cancelled
  // gesture is not an undo step), and the coalescing sentinel is reset (like endInteraction) so the next
  // discrete execute starts a fresh step instead of window-merging into a pre-session command. A no-op
  // when no session is open.
  cancelInteraction(): void {
    this.assertNotNotifying('cancelInteraction');
    const batch = this.session;
    if (batch === null) return;
    this.session = null;
    for (let i = batch.length - 1; i >= 0; i -= 1) {
      const cmd = batch[i];
      if (cmd) cmd.undo(this.ctx); // reverse order, still in batch mode (in-place undo)
    }
    this.deps.model.cancelBatch(); // exit batch mode; the live model now equals the pre-session state
    this.lastAt = Number.NEGATIVE_INFINITY; // a cancelled gesture is a fresh boundary for the next edit
  }

  undo(): HistoryEvent | null {
    this.assertNotNotifying('undo');
    const cmd = this.past.pop();
    if (!cmd) return null;
    cmd.undo(this.ctx);
    this.future.push(cmd);
    return this.commit('undo', cmd);
  }

  redo(): HistoryEvent | null {
    this.assertNotNotifying('redo');
    const cmd = this.future.pop();
    if (!cmd) return null;
    cmd.do(this.ctx);
    this.past.push(cmd);
    return this.commit('redo', cmd);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoLabel(): string | null {
    return this.past.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future.at(-1)?.label ?? null;
  }

  get maxDepth(): number {
    return this.maxDepthValue;
  }

  subscribe(fn: (event: HistoryEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private coalesceIntoSession(cmd: Command): void {
    // Merge with the most recent same-kind/same-target command already in the session, so a
    // single-target drag of N moves keeps ONE memento while a multi-target gesture keeps one per
    // distinct target. coalesceWith returns null on a different target, so the search is bounded by
    // the number of distinct targets, not by pointer-move count.
    const session = this.session;
    if (!session) return;
    if (cmd.coalesceWith) {
      for (let i = session.length - 1; i >= 0; i -= 1) {
        const candidate = session[i];
        if (!candidate) continue;
        const merged = cmd.coalesceWith(candidate);
        if (merged) {
          session[i] = merged;
          return;
        }
      }
    }
    session.push(cmd);
  }

  // Reject re-entrant history mutation. Called at the entry of every mutating method, so a commit
  // listener that calls execute/undo/redo/begin/endInteraction is rejected BEFORE it can mutate the
  // model or touch the stacks (command-history Section 5.1: a typed error, not stack corruption).
  private assertNotNotifying(kind: string): void {
    if (this.notifying) throw new HistoryReentrancyError(kind);
  }

  private commit(phase: HistoryPhase, cmd: Command): HistoryEvent {
    const hint = cmd.selectionHint?.(phase);
    const event: HistoryEvent =
      hint === undefined
        ? { phase, kind: cmd.kind, label: cmd.label }
        : { phase, kind: cmd.kind, label: cmd.label, selectionHint: hint };
    this.notifying = true;
    try {
      for (const listener of this.listeners) listener(event);
    } finally {
      this.notifying = false;
    }
    return event;
  }

  private enforceDepth(): void {
    while (this.past.length > this.maxDepthValue) this.past.shift();
  }
}
