import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import { makeLifeStop } from '../effects-model/effects-state';
import type { EffectLifeCurveEntity, LifeCurveField } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId, LifeStopId } from '../model/ids';
import { assertValidStopOrder, locateStop } from './life-curve-support';
import type { EffectCommandSpec } from './effects-spec';

// Move a life-curve stop's `t` (section 10 MoveLifeStop, COALESCING). An interior stop's `t` is clamped to
// the open interval (0, 1); the t=0 / t=1 anchors do not move (moving an anchor is rejected). The candidate
// order is re-validated (strict ascending) BEFORE any mutation, so a drag past a sibling fails loudly. A
// same-(effect, layer, stop) drag coalesces to one undo step. The before memento is the prior whole curve.
export class MoveLifeStopCommand implements Command {
  readonly kind = 'effect.lifeStop.move';
  readonly label = 'Move Life Stop';
  private before: EffectLifeCurveEntity | undefined;
  private field: LifeCurveField | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly stopId: LifeStopId,
    private readonly t: number,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      const located = locateStop(layer, this.stopId);
      if (!located)
        throw new EffectEditError('notFound', `life stop ${this.stopId} does not exist`);
      if (located.index === 0 || located.index === located.stops.length - 1) {
        throw new EffectEditError('lifeStopOrder', 'the t=0 and t=1 anchor stops cannot be moved');
      }
      this.before = { stops: located.stops };
      this.field = located.field;
    }
    if (this.field === undefined) return;
    if (this.t <= 0 || this.t >= 1) {
      throw new EffectEditError(
        'lifeStopOrder',
        `interior stop t must be in (0, 1), got ${this.t}`,
      );
    }
    const stops = this.before.stops
      .map((stop) =>
        stop.id === this.stopId ? makeLifeStop(stop.id, this.t, stop.value, stop.curve) : stop,
      )
      .sort((a, b) => a.t - b.t);
    assertValidStopOrder(stops);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, { stops });
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined || this.field === undefined)
      throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLifeCurve(this.effectId, this.layerId, this.field, this.before);
  }

  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof MoveLifeStopCommand &&
      prev.effectId === this.effectId &&
      prev.layerId === this.layerId &&
      prev.stopId === this.stopId
    ) {
      const merged = new MoveLifeStopCommand(this.effectId, this.layerId, this.stopId, this.t);
      merged.before = prev.before;
      merged.field = prev.field;
      return merged;
    }
    return null;
  }
}

export const moveLifeStopSpec: EffectCommandSpec = {
  kind: 'effect.lifeStop.move',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    const interior = layer?.curves.get('scaleOverLife')?.stops[1];
    if (!interior) return null;
    // Move the interior stop from t=0.5 to t=0.7.
    return { command: new MoveLifeStopCommand(target.id, layerId, interior.id, 0.7) };
  },
  assertApplied: (before, after) => {
    const tOf = (snap: typeof before): number | undefined => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      return layer?.curves.find((c) => c.field === 'scaleOverLife')?.stops[1]?.t;
    };
    if (tOf(before) === tOf(after)) {
      throw new Error('effect.lifeStop.move produced no t delta');
    }
  },
};
