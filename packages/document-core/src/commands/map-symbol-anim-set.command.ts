import { symbolId } from '@marionette/format/slot';
import type { SceneRefs, SymbolAnimSet, SymbolId } from '@marionette/format/slot-types';
import type { Command, CommandContext } from '../command/command';
import { CommandNotAppliedError, SlotEditError } from '../command/errors';
import { cloneSceneRefs, cloneSymbolAnimSet } from '../model/slot-scene';
import type { CommandSpec } from './spec';

// The animation names available in the referenced skeleton, supplied at command construction so the command
// can validate that the chosen idle/land/win/anticipation names exist WITHOUT document-core gaining a
// filesystem dependency (the format slot-scene validator does the cross-document resolution via an injected
// resolver; document-core mirrors that by taking the names as a command-init argument, exactly how other
// commands that need external data take it as an init parameter). When omitted, only the STRUCTURAL floor
// (non-empty names) is enforced and the existence check is deferred to the import-time validator (noted in
// the WP report).
export interface MapSymbolAnimSetInit {
  // The mapping to set, or null to REMOVE the symbol's mapping.
  readonly animSet: SymbolAnimSet | null;
  // The known animation names in the referenced skeleton (the `skeletonRef`'s animations). When provided,
  // each chosen name must be a member; when omitted, only the non-empty structural check runs.
  readonly skeletonAnimationNames?: readonly string[];
  // The known content hash for the skeletonRef, used when this mapping introduces a NEW refs.skeletons
  // entry. Defaults to the empty string (an unhashed draft ref, mirroring the draft skeletal/effects hash).
  readonly skeletonHash?: string;
}

// The before-memento: the prior symbol entry at this SymbolId (null when the symbol was unmapped) and the
// prior whole SceneRefs, so undo restores BOTH the symbol mapping and the refs.skeletons add/prune in one
// step (the single-undo guarantee). Capturing the whole refs is the smallest correct memento: a map can add
// at most one ref and a remove can prune at most one, so the prior refs is the bit-exact reverse.
interface MapMemento {
  readonly priorSymbol: SymbolAnimSet | null;
  readonly priorRefs: SceneRefs;
}

// Add a skeletonRef to refs.skeletons if absent (a map that introduces a new skeleton). Returns the same
// refs object when already present (no change), else a fresh refs with the entry appended.
function withSkeletonRef(refs: SceneRefs, name: string, hash: string): SceneRefs {
  if (refs.skeletons.some((entry) => entry.name === name)) return refs;
  return { skeletons: [...refs.skeletons, { name, hash }], vfxPresets: refs.vfxPresets.slice() };
}

// Map a SymbolId to a SymbolAnimSet, or remove its mapping (command-history catalog MapSymbolAnimSet,
// `slot.symbol.map`; WP-4.6). The do sets/replaces/removes slotScene.symbols[symbolId]; the undo restores
// the prior entry (memento). It also maintains slotScene.refs.skeletons as ONE single-undo step: a mapping
// that introduces a skeletonRef not yet in refs ADDS it; removing the LAST symbol referencing a skeleton
// PRUNES its refs entry. The combined before-memento (prior symbol + prior refs) makes the do/undo
// round-trip bit-exact in one undo.
//
// Validation at command time (assertValidInit): the structural floor (non-empty skeletonRef and animation
// names) always runs; when `skeletonAnimationNames` is supplied, each chosen name must exist in that list
// (the author-time mirror of the format SYMBOL_ANIM_MISSING cross-reference, without a filesystem). NOT
// coalescing (a symbol mapping is a discrete edit, not a drag).
export class MapSymbolAnimSetCommand implements Command {
  readonly kind = 'slot.symbol.map';
  readonly label = 'Map Symbol Anim Set';
  private memento: MapMemento | undefined;
  private readonly animSet: SymbolAnimSet | null;
  private readonly animationNames: readonly string[] | undefined;
  private readonly skeletonHash: string;

  constructor(
    private readonly symbolId: SymbolId,
    init: MapSymbolAnimSetInit,
  ) {
    this.animSet = init.animSet === null ? null : cloneSymbolAnimSet(init.animSet);
    this.animationNames = init.skeletonAnimationNames;
    this.skeletonHash = init.skeletonHash ?? '';
  }

  private assertValidInit(): void {
    if (this.animSet === null) return; // a removal needs no anim-name validation
    const set = this.animSet;
    const names: readonly (readonly [string, string])[] = [
      ['skeletonRef', set.skeletonRef],
      ['idle', set.idle],
      ['land', set.land],
      ['win', set.win],
      ...(set.anticipation !== undefined ? ([['anticipation', set.anticipation]] as const) : []),
    ];
    for (const [field, value] of names) {
      if (value.length === 0) throw new SlotEditError('emptyName', `${field} must be non-empty`);
    }
    // Animation-name existence check (only when the skeleton's animation names were injected).
    if (this.animationNames !== undefined) {
      const known = new Set(this.animationNames);
      for (const [field, value] of names) {
        if (field === 'skeletonRef') continue;
        if (!known.has(value)) {
          throw new SlotEditError(
            'animMissing',
            `animation "${value}" (${field}) is not in skeleton "${set.skeletonRef}"`,
          );
        }
      }
    }
  }

  do(ctx: CommandContext): void {
    this.assertValidInit();
    if (this.memento === undefined) {
      const priorSymbol = ctx.mutate.getSymbolAnimSet(this.symbolId) ?? null;
      this.memento = { priorSymbol, priorRefs: cloneSceneRefs(ctx.mutate.slotScene().refs) };
    }
    if (this.animSet === null) {
      this.removeMapping(ctx);
    } else {
      this.setMapping(ctx, this.animSet);
    }
  }

  // Set/replace the mapping, then add the skeletonRef to refs.skeletons if it is new (one composite step).
  private setMapping(ctx: CommandContext, set: SymbolAnimSet): void {
    ctx.mutate.setSymbolAnimSet(this.symbolId, set);
    const refs = ctx.mutate.slotScene().refs;
    const next = withSkeletonRef(refs, set.skeletonRef, this.skeletonHash);
    if (next !== refs) ctx.mutate.setSceneRefs(next);
  }

  // Remove the mapping, then prune the skeleton's refs entry if no remaining symbol references it.
  private removeMapping(ctx: CommandContext): void {
    const prior = ctx.mutate.getSymbolAnimSet(this.symbolId);
    if (prior === undefined) throw new SlotEditError('notMapped', this.symbolId);
    ctx.mutate.removeSymbolAnimSet(this.symbolId);
    const stillReferenced = Object.values(ctx.mutate.slotScene().symbols).some(
      (s) => s.skeletonRef === prior.skeletonRef,
    );
    if (!stillReferenced) {
      const refs = ctx.mutate.slotScene().refs;
      const skeletons = refs.skeletons.filter((entry) => entry.name !== prior.skeletonRef);
      if (skeletons.length !== refs.skeletons.length) {
        ctx.mutate.setSceneRefs({ skeletons, vfxPresets: refs.vfxPresets.slice() });
      }
    }
  }

  undo(ctx: CommandContext): void {
    if (this.memento === undefined) throw new CommandNotAppliedError(this.kind);
    // Restore the symbol mapping first (or remove a freshly-added one), then restore the prior refs
    // wholesale, so both the symbol map and the refs.skeletons add/prune reverse in one undo step.
    if (this.memento.priorSymbol !== null) {
      ctx.mutate.setSymbolAnimSet(this.symbolId, this.memento.priorSymbol);
    } else {
      ctx.mutate.removeSymbolAnimSet(this.symbolId);
    }
    ctx.mutate.setSceneRefs(this.memento.priorRefs);
  }
}

export const mapSymbolAnimSetSpec: CommandSpec = {
  kind: 'slot.symbol.map',
  // Every seed loads the default (empty) symbol library and empty refs, so 'minimal' is a clean target:
  // mapping a new symbol adds one symbol entry AND one refs.skeletons entry in one step.
  representativeSeedId: 'minimal',
  fixture: (model) => {
    const id = symbolId('sym_test');
    if (model.getSymbolAnimSet(id) !== undefined) return null;
    return {
      command: new MapSymbolAnimSetCommand(id, {
        animSet: { skeletonRef: 'hero', idle: 'idle', land: 'land', win: 'win' },
      }),
    };
  },
  assertApplied: (before, after) => {
    if (after.slotScene.symbols.length !== before.slotScene.symbols.length + 1) {
      throw new Error('slot.symbol.map did not add exactly one symbol mapping');
    }
    if (after.slotScene.skeletons.length !== before.slotScene.skeletons.length + 1) {
      throw new Error('slot.symbol.map did not add the new skeletonRef to refs.skeletons');
    }
  },
};
