import type { BlendMode } from '@marionette/format/effects-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError } from '../command/errors';
import type { EffectEntity } from '../effects-model/effects-state';
import type { EffectId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// The meta a CreateEffect carries (the EffectConfig scalar fields; layers start empty and are added by
// AddLayer). `duration` null is endless emission; `simulationDt` defaults to 1/60 at the call site.
export interface CreateEffectInit {
  readonly name: string;
  readonly duration: number | null;
  readonly deterministic: boolean;
  readonly simulationDt: number;
  readonly blendMode: BlendMode;
}

// Create a new, layer-less effect in the library (section 10 CreateEffect). Mints the EffectId in `do` so a
// redo reuses the SAME id (a fresh mint each redo would orphan any later command that captured the id);
// the id is appended at the end of effectOrder. Name uniqueness is an EXPORT-only contract (section 8.1.1),
// so a duplicate name is NOT rejected here. Never coalesces; memento-based.
export class CreateEffectCommand implements Command {
  readonly kind = 'effect.create';
  readonly label = 'Create Effect';
  private id: EffectId | undefined;

  constructor(private readonly init: CreateEffectInit) {}

  do(ctx: CommandContext): void {
    if (this.id === undefined) this.id = ctx.ids.mint('effect');
    const entity: EffectEntity = {
      id: this.id,
      name: this.init.name,
      duration: this.init.duration,
      deterministic: this.init.deterministic,
      simulationDt: this.init.simulationDt,
      blendMode: this.init.blendMode,
      layerOrder: [],
      layers: new Map(),
    };
    ctx.effects.insertEffect(entity, ctx.effects.effects().length);
  }

  undo(ctx: CommandContext): void {
    if (this.id === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.removeEffect(this.id);
  }

  // Expose the minted id so a UI flow can select the new effect after execute (resolved off the model, not
  // written into the document); undefined before the first do.
  get createdId(): EffectId | undefined {
    return this.id;
  }
}

export const createEffectSpec: EffectCommandSpec = {
  kind: 'effect.create',
  representativeSeedId: 'library',
  fixture: () => ({
    command: new CreateEffectCommand({
      name: 'sparkle',
      duration: 1,
      deterministic: true,
      simulationDt: 1 / 60,
      blendMode: 'additive',
    }),
  }),
  assertApplied: (before, after) => {
    if (after.effects.length !== before.effects.length + 1) {
      throw new Error('effect.create did not add exactly one effect');
    }
    if (!after.effects.some((effect) => effect.name === 'sparkle')) {
      throw new Error('effect.create did not create the named effect');
    }
  },
};
