import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import { makeLifeStop } from '../effects-model/effects-state';
import type {
  EffectLifeCurveEntity,
  EffectLifeStopEntity,
  LifeCurveField,
  LifeStopValue,
} from '../effects-model/effects-state';
import type { EffectId, EffectLayerId, LifeStopId } from '../model/ids';
import { assertValidStopOrder } from './life-curve-support';
import type { EffectCommandSpec } from './effects-spec';

// Add an interior stop to one of a layer's life curves (section 10 AddLifeStop, keeps t strictly
// increasing). Targets the curve by (layer, field) and inserts at a strictly-interior `t` in (0, 1), with a
// linear/stepped/bezier value+curve. The new LifeStopId is minted once in the first `do` (redo reuses it).
// The inserted stop is sorted into the curve by `t`; the candidate order is validated (the t=0/t=1 anchors
// stay first/last, t strictly ascends) BEFORE any mutation. The before memento is the prior whole curve.
export class AddLifeStopCommand implements Command {
  readonly kind = 'effect.lifeStop.add';
  readonly label = 'Add Life Stop';
  private id: LifeStopId | undefined;
  private before: EffectLifeCurveEntity | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly field: LifeCurveField,
    private readonly t: number,
    private readonly value: LifeStopValue,
    private readonly curve: EffectLifeStopEntity['curve'],
  ) {}

  do(ctx: CommandContext): void {
    if (this.id === undefined) this.id = ctx.ids.mint('lifeStop');
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      const current = layer?.curves.get(this.field);
      if (!current)
        throw new EffectEditError(
          'notFound',
          `curve ${this.field} on layer ${this.layerId} does not exist`,
        );
      this.before = current;
    }
    const stop = makeLifeStop(this.id, this.t, this.value, this.curve);
    const stops = [...this.before.stops, stop].sort((a, b) => a.t - b.t);
    assertValidStopOrder(stops);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, { stops });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, this.before);
  }
}

export const addLifeStopSpec: EffectCommandSpec = {
  kind: 'effect.lifeStop.add',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    if (!layer || !layer.curves.has('alphaOverLife')) return null;
    // Insert at t=0.5 (interior), value 0.5, on alphaOverLife (a two-stop curve in the seed).
    return {
      command: new AddLifeStopCommand(target.id, layerId, 'alphaOverLife', 0.5, 0.5, 'linear'),
    };
  },
  assertApplied: (before, after) => {
    const stopsOf = (snap: typeof before): number => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      return layer?.curves.find((c) => c.field === 'alphaOverLife')?.stops.length ?? 0;
    };
    if (stopsOf(after) !== stopsOf(before) + 1) {
      throw new Error('effect.lifeStop.add did not add exactly one stop');
    }
  },
};
