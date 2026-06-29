import type { EffectsMutator } from '../effects-model/effects-mutator';
import type { BoneId, IdFactory, SlotId } from '../model/ids';
import type { Mutator } from '../model/mutator';

// The privileged context a command sees (command-history Section 4.1). It carries the skeletal Mutator, the
// effects EffectsMutator (WP-3.7: effect edits share the SAME History and CommandContext as skeleton edits,
// so one project undo stack), and an IdFactory, and NOTHING else: no SpinResult, no board, no RNG, no clock,
// no Zustand. A command therefore cannot read or influence an outcome (LAW 1, structural) and cannot mutate
// anything except through one of the two mutators (LAW 2, structural). A skeleton command ignores
// `ctx.effects`; an effect command ignores `ctx.mutate`; History builds both from the document's two models.
export interface CommandContext {
  readonly mutate: Mutator;
  readonly effects: EffectsMutator;
  readonly ids: IdFactory;
}

export type HistoryPhase = 'execute' | 'undo' | 'redo';

// A selection target carries an entity REFERENCE (internal id plus kind), never document data, so the
// non-undoable selection store can reselect after an undo/redo. Phase 1 (WP-1.2) makes slots
// selectable; later phases add further kinds (keyframes in WP-1.5, constraints in Phase 2) (LAW 5).
export type EntityRef =
  | { readonly type: 'bone'; readonly id: BoneId }
  | { readonly type: 'slot'; readonly id: SlotId };

export type SelectionHint =
  | { readonly kind: 'select'; readonly entities: readonly EntityRef[] }
  | { readonly kind: 'clear' }
  | { readonly kind: 'preserve' };

export interface Command {
  readonly kind: string; // stable discriminant, e.g. 'bone.move'
  readonly label: string; // human label for the undo menu (no em-dashes)
  do(ctx: CommandContext): void;
  undo(ctx: CommandContext): void;
  // If THIS command can absorb `prev` into one undo step, return the merged command; else null. Same
  // kind + same target only (command-history Section 5.3). Omitted means never coalesces.
  coalesceWith?(prev: Command): Command | null;
  // Optional read-only UX hint resolved PER history phase; NEVER written into the document. History
  // resolves it in commit() and puts it on HistoryEvent.selectionHint.
  selectionHint?(phase: HistoryPhase): SelectionHint | undefined;
}

export interface HistoryEvent {
  readonly phase: HistoryPhase;
  readonly kind: string;
  readonly label: string;
  readonly selectionHint?: SelectionHint; // resolved for this phase
}
