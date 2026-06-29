import type { Command } from '../command/command';
import type { EffectsReadModel, EffectsSnapshot } from '../effects-model/effects-read-model';
import type { IdFactory } from '../model/ids';

// A representative, ready-to-apply effect command (the effects mirror of CommandFixture). The effect
// commands are addressed entirely within the effects model, so the fixture sees only the EffectsReadModel
// and the id factory (never the skeletal model).
export interface EffectCommandFixture {
  readonly command: Command;
}

// The registration record every effect command file exports and appends to effectsCommandRegistry (the
// effects mirror of CommandSpec). The effects round-trip harness discovers commands through this and runs
// each against the effect seed it declares: do then undo must deep-equal the prior effects snapshot, and
// the command must produce its representative delta.
export interface EffectCommandSpec {
  readonly kind: string; // unique; matches Command.kind
  // The effect seed (an effects-seed id, e.g. 'library') this command is GUARANTEED applicable on. The
  // discovery guard requires fixture() to be non-null here, so a command inapplicable on every seed cannot
  // pass with zero round-trip coverage.
  readonly representativeSeedId: string;
  // Produce a valid, representative command against an effects model (one that yields a real delta), or
  // null when not applicable to that seed.
  readonly fixture: (effects: EffectsReadModel, ids: IdFactory) => EffectCommandFixture | null;
  // Assert the SPECIFIC delta this command must produce (the mutated fields differ; unrelated state is
  // unchanged). Throws on a missing or wrong delta, so a trivial fixture cannot pass.
  readonly assertApplied: (before: EffectsSnapshot, after: EffectsSnapshot) => void;
}
