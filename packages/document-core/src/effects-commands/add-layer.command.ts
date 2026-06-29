import type { BlendMode } from '@marionette/format/effects-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, EffectEditError } from '../command/errors';
import type { EffectLayerEntity } from '../effects-model/effects-state';
import type { EffectId, EffectLayerId } from '../model/ids';
import { buildDefaultLayer, type NewLayerKind } from './layer-defaults';
import type { EffectCommandSpec } from './effects-spec';

// Add a default layer of the given kind to an effect (section 10 AddLayer: emitter / spriteAnimator /
// ribbonTrail). Builds the layer (minting an EffectLayerId and a LifeStopId per curve stop) once in the
// first `do`, so redo reuses the SAME ids; the layer is appended at the end of the effect's layerOrder (the
// top of the z order). Never coalesces; memento-based (the built layer entity + its id).
export class AddLayerCommand implements Command {
  readonly kind = 'effect.layer.add';
  readonly label = 'Add Layer';
  private built: EffectLayerEntity | undefined;

  constructor(
    private readonly effectId: EffectId,
    private readonly layerKind: NewLayerKind,
    private readonly blendMode: BlendMode,
    private readonly region: string,
  ) {}

  do(ctx: CommandContext): void {
    const effect = ctx.effects.getEffect(this.effectId);
    if (!effect) throw new EffectEditError('notFound', `effect ${this.effectId} does not exist`);
    if (this.built === undefined) {
      this.built = buildDefaultLayer(this.layerKind, this.blendMode, this.region, ctx.ids);
    }
    ctx.effects.insertLayer(this.effectId, this.built, effect.layerOrder.length);
  }

  undo(ctx: CommandContext): void {
    if (this.built === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.removeLayer(this.effectId, this.built.id);
  }

  get createdLayerId(): EffectLayerId | undefined {
    return this.built?.id;
  }
}

export const addLayerSpec: EffectCommandSpec = {
  kind: 'effect.layer.add',
  representativeSeedId: 'library',
  fixture: (effects) => {
    const target = effects.findEffectByName('coinShower');
    if (!target) return null;
    // 'coin' resolves in the library seed's atlas, so the new layer exports cleanly.
    return { command: new AddLayerCommand(target.id, 'emitter', 'additive', 'coin') };
  },
  assertApplied: (before, after) => {
    const b = before.effects.find((effect) => effect.name === 'coinShower');
    const a = after.effects.find((effect) => effect.name === 'coinShower');
    if (!a || !b) throw new Error('effect.layer.add target effect missing');
    if (a.layerOrder.length !== b.layerOrder.length + 1) {
      throw new Error('effect.layer.add did not add exactly one layer');
    }
  },
};
