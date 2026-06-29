import { computeEffectsContentHash, validateEffectsDocument } from '@marionette/format/effects';
import type { AtlasRef, EffectsDocument } from '@marionette/format/effects-types';
import type { Command, CommandContext, SelectionHint } from '../command/command';
import { CommandNotAppliedError, EffectsAtlasDanglingRegionError } from '../command/errors';
import { exportEffects } from '../effects-model/effects-export';
import type { EffectCommandSpec } from './effects-spec';

// Set the effects document's VFX atlas after the pack (section 10 SetEffectsAtlas; mirrors Phase 1
// SetAtlasRef). Before mutating, it re-runs the WP-3.0 cross-reference check (TASK-3.7.7): it projects the
// CURRENT effects library to a candidate EffectsDocument carrying the PROPOSED atlas and validates it, so a
// layer `region` / `regions[]` that no longer resolves in the new atlas surfaces as a typed dangling-region
// error (EFFECT_REGION_MISSING) and the atlas is NOT swapped. A changed atlas can never silently leave a
// dangling reference. Never coalesces; memento-based (the prior atlas).
export class SetEffectsAtlasCommand implements Command {
  readonly kind = 'effects.atlas.set';
  readonly label = 'Set Effects Atlas';
  private before: AtlasRef | undefined;

  constructor(private readonly atlas: AtlasRef) {}

  do(ctx: CommandContext): void {
    // The cross-reference check runs on EVERY do (including redo): the proposed atlas must still resolve
    // every referenced region against the library as it stands now, so an intervening edit cannot make a
    // previously-valid swap dangle on redo. exportEffects projects the current library; we swap the atlas
    // on the projection and re-validate (the projection minus the new atlas already validated on export).
    const candidate: EffectsDocument = {
      ...exportEffects(ctx.effects),
      atlas: this.atlas,
      hash: '',
    };
    const withHash: EffectsDocument = { ...candidate, hash: computeEffectsContentHash(candidate) };
    const report = validateEffectsDocument(withHash, { verifyHash: true });
    if (!report.ok) {
      throw new EffectsAtlasDanglingRegionError(report);
    }
    if (this.before === undefined) this.before = ctx.effects.atlas();
    ctx.effects.setAtlas(this.atlas);
  }

  undo(ctx: CommandContext): void {
    if (this.before === undefined) throw new CommandNotAppliedError(this.kind);
    ctx.effects.setAtlas(this.before);
  }

  // An atlas swap changes no effect/bundle selection, so the current selection is preserved.
  selectionHint(): SelectionHint {
    return { kind: 'preserve' };
  }
}

// Build a one-page atlas that KEEPS the regions the library seed references (coin / ray-fan / ribbon) plus
// a differently-named spare, so the swap is a real delta yet leaves no dangling reference. Used by the
// round-trip fixture; the dangling-region negative case lives in the effect-command test (it must THROW,
// which the round-trip harness does not exercise).
function atlasKeepingSeedRegions(): AtlasRef {
  const region = (name: string): AtlasRef['pages'][number]['regions'][number] => ({
    name,
    x: 0,
    y: 0,
    w: 32,
    h: 32,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 32,
    originalH: 32,
  });
  return {
    pages: [
      {
        file: 'vfx-repacked.png',
        width: 512,
        height: 512,
        regions: [region('coin'), region('ray-fan'), region('ribbon'), region('different-spare')],
      },
    ],
  };
}

export const setEffectsAtlasSpec: EffectCommandSpec = {
  kind: 'effects.atlas.set',
  representativeSeedId: 'library',
  fixture: () => ({ command: new SetEffectsAtlasCommand(atlasKeepingSeedRegions()) }),
  assertApplied: (before, after) => {
    const bFile = before.atlas.pages[0]?.file;
    const aFile = after.atlas.pages[0]?.file;
    if (bFile === aFile) {
      throw new Error('effects.atlas.set produced no atlas delta');
    }
  },
};

export { atlasKeepingSeedRegions };
