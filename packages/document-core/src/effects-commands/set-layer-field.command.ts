import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectLayerBody } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId } from '../model/ids';
import type { EffectCommandSpec } from './effects-spec';

// Set a parametric field on an emitter / sprite-animator / ribbon-trail layer body (section 10
// SetLayerField, COALESCING). A field edit during a slider/number drag collapses to one undo step when it
// targets the SAME (effect, layer, field): the `field` string is the coalesce key, exactly as the skeletal
// SetCurve keys on (animation, target, keyframe). The caller hands the WHOLE rebuilt body (the panel patches
// one field on a copy of the current body), so the command stays type-safe over the body union without an
// `any`; the before memento is the prior body. The model replaces the body wholesale.
export class SetLayerFieldCommand implements Command {
  readonly kind = 'effect.layer.field';
  readonly label = 'Set Layer Field';
  private before: EffectLayerBody | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerId: EffectLayerId,
    private readonly field: string,
    private readonly body: EffectLayerBody,
  ) {}

  do(ctx: CommandContext): void {
    if (this.before === undefined) {
      const layer = ctx.effects.getLayer(this.effectId, this.layerId);
      if (!layer) throw new EffectEditError('notFound', `layer ${this.layerId} does not exist`);
      this.before = layer.body;
    }
    ctx.effects.setLayerBody(this.effectId, this.layerId, this.body);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setLayerBody(this.effectId, this.layerId, this.before);
  }

  // Coalesce a same-(effect, layer, field) edit so a 40-step drag is one undo step that restores the body
  // as it stood at the START of the drag (prev.before) and applies the final body (this.body), mirroring
  // the skeletal coalescing-command shape.
  coalesceWith(prev: Command): Command | null {
    if (
      prev instanceof SetLayerFieldCommand &&
      prev.effectId === this.effectId &&
      prev.layerId === this.layerId &&
      prev.field === this.field
    ) {
      const merged = new SetLayerFieldCommand(this.effectId, this.layerId, this.field, this.body);
      merged.before = prev.before;
      return merged;
    }
    return null;
  }
}

// Rebuild an emitter body with `drag` set to a new value (the parametric field the round-trip and coalesce
// tests exercise). Throws if the layer is not an emitter (the fixture targets the emitter layer).
export function withEmitterDrag(body: EffectLayerBody, drag: number): EffectLayerBody {
  if (body.type !== 'emitter') {
    throw new EffectEditError('notFound', 'withEmitterDrag expects an emitter layer');
  }
  return { ...body, drag };
}

export const setLayerFieldSpec: EffectCommandSpec = {
  kind: 'effect.layer.field',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    const layerId = target?.layerOrder[0];
    if (!target || layerId === undefined) return null;
    const layer = target.layers.get(layerId);
    if (!layer || layer.body.type !== 'emitter') return null;
    const nextDrag = layer.body.drag + 0.5;
    return {
      command: new SetLayerFieldCommand(
        target.id,
        layerId,
        'drag',
        withEmitterDrag(layer.body, nextDrag),
      ),
    };
  },
  assertApplied: (before, after) => {
    const dragOf = (snap: typeof before): number | undefined => {
      const effect = snap.effects.find((e) => e.name === 'coinShower');
      const layerId = effect?.layerOrder[0];
      const layer = effect?.layers.find((l) => l.id === layerId);
      return layer && layer.body.type === 'emitter' ? layer.body.drag : undefined;
    };
    if (dragOf(before) === dragOf(after)) {
      throw new Error('effect.layer.field produced no field delta');
    }
  },
};
