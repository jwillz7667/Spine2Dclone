import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import { makeLifeStop } from '../effects-model/effects-state';
import type {
  EffectLifeCurveEntity,
  LifeCurveField,
  LifeStopValue,
} from '../effects-model/effects-state';
import type { EffectId, EffectLayerId, LifeStopId } from '../model/ids';
import { locateStop } from './life-curve-support';
import type { EffectCommandSpec } from './effects-spec';

// Set a life-curve stop's value (section 10 SetLifeStopValue, COALESCING). The value must match the curve's
// shape: a scalar value on a scalar curve, an RGB value on a color curve; a shape mismatch is rejected
// (lifeStopValueShape) BEFORE any mutation. A same-(effect, layer, stop) drag (a color picker or slider)
// coalesces to one undo step. `t` and `curve` are untouched; the before memento is the prior whole curve.
export class SetLifeStopValueCommand implements Command {
  readonly kind = 'effect.lifeStop.value';
  readonly label = 'Set Life Stop Value';
  private before: EffectLifeCurveEntity | undefined;
  private field: LifeCurveField | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly stopId: LifeStopId,
    private readonly value: LifeStopValue,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      const located = locateStop(layer, this.stopId);
      if (!located)
        throw new EffectEditError('notFound', `life stop ${this.stopId} does not exist`);
      if (typeof located.stop.value !== typeof this.value) {
        throw new EffectEditError('lifeStopValueShape', 'value shape does not match the curve');
      }
      this.before = { stops: located.stops };
      this.field = located.field;
    }
    if (this.field === undefined) return;
    const stops = this.before.stops.map((stop) =>
      stop.id === this.stopId ? makeLifeStop(stop.id, stop.t, this.value, stop.curve) : stop,
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
      prev instanceof SetLifeStopValueCommand &&
      prev.effectId === this.effectId &&
      prev.layerId === this.layerId &&
      prev.stopId === this.stopId
    ) {
      const merged = new SetLifeStopValueCommand(
        this.effectId,
        this.layerId,
        this.stopId,
        this.value,
      );
      merged.before = prev.before;
      merged.field = prev.field;
      return merged;
    }
    return null;
  }
}

export const setLifeStopValueSpec: EffectCommandSpec = {
  kind: 'effect.lifeStop.value',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    const stop = layer?.curves.get('alphaOverLife')?.stops[0];
    if (!stop || typeof stop.value !== 'number') return null;
    return {
      command: new SetLifeStopValueCommand(
        target.id,
        layerId,
        stop.id,
        stop.value === 0.5 ? 0.75 : 0.5,
      ),
    };
  },
  assertApplied: (before, after) => {
    const valueOf = (snap: typeof before): number | undefined => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      const v = layer?.curves.find((c) => c.field === 'alphaOverLife')?.stops[0]?.value;
      return typeof v === 'number' ? v : undefined;
    };
    if (valueOf(before) === valueOf(after)) {
      throw new Error('effect.lifeStop.value produced no value delta');
    }
  },
};
