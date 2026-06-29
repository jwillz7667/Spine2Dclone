import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectLifeCurveEntity, LifeCurveField } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId, LifeStopId } from '../model/ids';
import { locateStop } from './life-curve-support';
import type { EffectCommandSpec } from './effects-spec';

// Remove a life-curve stop by LifeStopId (section 10 RemoveLifeStop). Rejects, BEFORE any mutation:
//   - dropping the curve below its two-stop floor (lifeCurveMinStops), and
//   - removing the t=0 or t=1 anchor (the first/last stops are the curve endpoints; only interior stops
//     are removable, lifeStopOrder).
// The before memento is the prior whole curve plus the resolved field (the undo writes the curve back).
// Never coalesces.
export class RemoveLifeStopCommand implements Command {
  readonly kind = 'effect.lifeStop.remove';
  readonly label = 'Remove Life Stop';
  private before: EffectLifeCurveEntity | undefined;
  private field: LifeCurveField | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly stopId: LifeStopId,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      const located = locateStop(layer, this.stopId);
      if (!located)
        throw new EffectEditError('notFound', `life stop ${this.stopId} does not exist`);
      if (located.stops.length <= 2) {
        throw new EffectEditError('lifeCurveMinStops', 'a life curve cannot drop below 2 stops');
      }
      if (located.index === 0 || located.index === located.stops.length - 1) {
        throw new EffectEditError(
          'lifeStopOrder',
          'the t=0 and t=1 anchor stops are not removable',
        );
      }
      this.before = { stops: located.stops };
      this.field = located.field;
    }
    if (this.field === undefined) return;
    const stops = this.before.stops.filter((stop) => stop.id !== this.stopId);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, { stops });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined || this.field === undefined)
      throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, this.before);
  }
}

export const removeLifeStopSpec: EffectCommandSpec = {
  kind: 'effect.lifeStop.remove',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    // scaleOverLife is a three-stop curve in the seed; its middle stop (index 1) is removable.
    const curve = layer?.curves.get('scaleOverLife');
    const interior = curve?.stops[1];
    if (!interior) return null;
    return { command: new RemoveLifeStopCommand(target.id, layerId, interior.id) };
  },
  assertApplied: (before, after) => {
    const stopsOf = (snap: typeof before): number => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      return layer?.curves.find((c) => c.field === 'scaleOverLife')?.stops.length ?? 0;
    };
    if (stopsOf(after) !== stopsOf(before) - 1) {
      throw new Error('effect.lifeStop.remove did not remove exactly one stop');
    }
  },
};
