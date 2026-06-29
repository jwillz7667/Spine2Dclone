import type { CurveType } from '@marionette/format/effects-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import { makeLifeStop } from '../effects-model/effects-state';
import type { EffectLifeCurveEntity, LifeCurveField } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId, LifeStopId } from '../model/ids';
import { locateStop } from './life-curve-support';
import type { EffectCommandSpec } from './effects-spec';

// Set a life-curve stop's outgoing easing (section 10 SetLifeStopCurve, COALESCING): linear / stepped /
// bezier (reuses the shared CurveType). Targets the stop by LifeStopId; `t` and value are untouched. A
// bezier-handle drag on the SAME (effect, layer, stop) coalesces to one undo step. The before memento is
// the prior whole curve.
export class SetLifeStopCurveCommand implements Command {
  readonly kind = 'effect.lifeStop.curve';
  readonly label = 'Set Life Stop Curve';
  private before: EffectLifeCurveEntity | undefined;
  private field: LifeCurveField | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly stopId: LifeStopId,
    private readonly curve: CurveType,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      const located = locateStop(layer, this.stopId);
      if (!located)
        throw new EffectEditError('notFound', `life stop ${this.stopId} does not exist`);
      this.before = { stops: located.stops };
      this.field = located.field;
    }
    if (this.field === undefined) return;
    const stops = this.before.stops.map((stop) =>
      stop.id === this.stopId ? makeLifeStop(stop.id, stop.t, stop.value, this.curve) : stop,
    );
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, { stops });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined || this.field === undefined)
      throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetLifeStopCurveCommand &&
      prev.effectId === this.effectId &&
      prev.layerId === this.layerId &&
      prev.stopId === this.stopId
    ) {
      const merged = new SetLifeStopCurveCommand(
        this.effectId,
        this.layerId,
        this.stopId,
        this.curve,
      );
      merged.before = prev.before;
      merged.field = prev.field;
      return merged;
    }
    return null;
  }
}

export const setLifeStopCurveSpec: EffectCommandSpec = {
  kind: 'effect.lifeStop.curve',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    const stop = layer?.curves.get('alphaOverLife')?.stops[0];
    if (!stop) return null;
    const next: CurveType = stop.curve === 'stepped' ? 'linear' : 'stepped';
    return { command: new SetLifeStopCurveCommand(target.id, layerId, stop.id, next) };
  },
  assertApplied: (before, after) => {
    const curveOf = (snap: typeof before): string => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      return JSON.stringify(
        layer?.curves.find((c) => c.field === 'alphaOverLife')?.stops[0]?.curve,
      );
    };
    if (curveOf(before) === curveOf(after)) {
      throw new Error('effect.lifeStop.curve produced no curve delta');
    }
  },
};
