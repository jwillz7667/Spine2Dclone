import { describe, expect, it } from 'vitest';
import {
  AddBundleItemCommand,
  AddLifeStopCommand,
  EffectEditError,
  EffectsAtlasDanglingRegionError,
  MoveBoneCommand,
  MoveLifeStopCommand,
  RemoveLifeStopCommand,
  RenameEffectCommand,
  SetBundleItemCommand,
  SetEffectMetaCommand,
  SetEffectsAtlasCommand,
  SetLayerFieldCommand,
  SetLifeStopCurveCommand,
  SetLifeStopValueCommand,
  exportEffects,
  loadDocument,
  loadDocumentWithEffects,
  withEmitterDrag,
  type Document,
  type EffectId,
  type EffectLayerId,
} from '../src';
import {
  atlasDroppingRibbon,
  atlasKeepingRegions,
  effectsSeeds,
  makeEffectsTestEnv,
  minimalSkeletonJson,
} from './effects-seeds';
import { makeTestEnv, seeds } from './seeds';

function loadLibrary(env = makeEffectsTestEnv().env): Document {
  return loadDocumentWithEffects(minimalSkeletonJson, effectsSeeds.library, env);
}

function countUndoSteps(doc: Document): number {
  let steps = 0;
  while (doc.history.canUndo) {
    doc.history.undo();
    steps += 1;
  }
  return steps;
}

function coinShowerId(doc: Document): EffectId {
  const effect = doc.effects.findEffectByName('coinShower');
  if (!effect) throw new Error('seed missing coinShower');
  return effect.id;
}

function emitterLayerId(doc: Document): { effectId: EffectId; layerId: EffectLayerId } {
  const effectId = coinShowerId(doc);
  const layerId = doc.effects.getEffect(effectId)?.layerOrder[0];
  if (layerId === undefined) throw new Error('seed missing emitter layer');
  return { effectId, layerId };
}

describe('effects commands: coalescing (a drag is one undo step)', () => {
  it('collapses a 40-step SetLayerField drag into one undo entry with the original before-memento', () => {
    const t = makeEffectsTestEnv();
    const doc = loadLibrary(t.env);
    const { effectId, layerId } = emitterLayerId(doc);
    const before = doc.effects.snapshot();
    const startDrag = (() => {
      const layer = doc.effects.getLayer(effectId, layerId);
      if (!layer || layer.body.type !== 'emitter') throw new Error('expected emitter layer');
      return layer.body.drag;
    })();

    doc.history.beginInteraction();
    for (let i = 1; i <= 40; i += 1) {
      const layer = doc.effects.getLayer(effectId, layerId);
      if (!layer) throw new Error('layer vanished mid-drag');
      doc.history.execute(
        new SetLayerFieldCommand(
          effectId,
          layerId,
          'drag',
          withEmitterDrag(layer.body, startDrag + i),
        ),
      );
    }
    const event = doc.history.endInteraction('Set Layer Field');
    // A single distinct (effect, layer, field) target collapses to one command, not a composite of 40.
    expect(event?.kind).toBe('effect.layer.field');

    // The final drag value is applied.
    const after = doc.effects.getLayer(effectId, layerId);
    expect(after && after.body.type === 'emitter' ? after.body.drag : null).toBe(startDrag + 40);

    // Exactly one undo step, and it restores the pre-drag state (the ORIGINAL before-memento, not step 39).
    expect(countUndoSteps(doc)).toBe(1);
    expect(doc.effects.snapshot()).toEqual(before);
  });

  it('collapses a MoveLifeStop / SetLifeStopValue / SetLifeStopCurve / SetBundleItem drag to one step', () => {
    const cases: ReadonlyArray<{ kind: string; build: (doc: Document) => () => void }> = [
      {
        kind: 'effect.lifeStop.move',
        build: (doc) => {
          const { effectId, layerId } = emitterLayerId(doc);
          const stop = doc.effects.getLayer(effectId, layerId)?.curves.get('scaleOverLife')
            ?.stops[1];
          if (!stop) throw new Error('missing interior stop');
          let i = 0;
          return () => {
            i += 1;
            doc.history.execute(
              new MoveLifeStopCommand(effectId, layerId, stop.id, 0.1 + i * 0.01),
            );
          };
        },
      },
      {
        kind: 'effect.lifeStop.value',
        build: (doc) => {
          const { effectId, layerId } = emitterLayerId(doc);
          const stop = doc.effects.getLayer(effectId, layerId)?.curves.get('alphaOverLife')
            ?.stops[0];
          if (!stop) throw new Error('missing stop');
          let i = 0;
          return () => {
            i += 1;
            doc.history.execute(
              new SetLifeStopValueCommand(effectId, layerId, stop.id, (i % 100) / 100),
            );
          };
        },
      },
      {
        kind: 'effect.lifeStop.curve',
        build: (doc) => {
          const { effectId, layerId } = emitterLayerId(doc);
          const stop = doc.effects.getLayer(effectId, layerId)?.curves.get('alphaOverLife')
            ?.stops[0];
          if (!stop) throw new Error('missing stop');
          let i = 0;
          return () => {
            i += 1;
            const cx = (i % 9) / 10;
            doc.history.execute(
              new SetLifeStopCurveCommand(effectId, layerId, stop.id, {
                type: 'bezier',
                cx1: cx,
                cy1: 0,
                cx2: 1 - cx,
                cy2: 1,
              }),
            );
          };
        },
      },
      {
        kind: 'bundle.item.set',
        build: (doc) => {
          const bundle = doc.effects.getBundle('megaWin');
          const itemId = bundle?.itemOrder[0];
          if (itemId === undefined) throw new Error('missing bundle item');
          let i = 0;
          return () => {
            i += 1;
            doc.history.execute(
              new SetBundleItemCommand('megaWin', itemId, { startOffset: i * 0.01 }),
            );
          };
        },
      },
    ];

    for (const c of cases) {
      const doc = loadLibrary();
      const step = c.build(doc);
      const before = doc.effects.snapshot();
      doc.history.beginInteraction();
      for (let i = 0; i < 40; i += 1) step();
      const event = doc.history.endInteraction(`Edit ${c.kind}`);
      expect(event?.kind, `${c.kind} should collapse to one command`).toBe(c.kind);
      expect(countUndoSteps(doc)).toBe(1);
      expect(doc.effects.snapshot()).toEqual(before);
    }
  });
});

describe('effects commands: rename keeps bundle references (zero cascade)', () => {
  it('renaming an effect leaves every bundle-item reference intact (they hold an EffectId)', () => {
    const doc = loadLibrary();
    const effectId = coinShowerId(doc);
    const bundleItemsBefore = doc.effects.snapshot().bundles;

    doc.history.execute(new RenameEffectCommand(effectId, 'coinShowerLarge'));

    // The bundle item still references the SAME EffectId, and the bundle snapshot is unchanged.
    expect(doc.effects.snapshot().bundles).toEqual(bundleItemsBefore);
    // The renamed effect is still the bundle item's target, so export resolves it to the NEW name.
    const exported = exportEffects(doc.effects);
    expect(exported.bundles.megaWin?.items[0]?.effect).toBe('coinShowerLarge');
    expect(exported.effects.coinShowerLarge).toBeDefined();
    expect(exported.effects.coinShower).toBeUndefined();
  });

  it('a duplicate name is surfaced only by export, not by a mid-edit throw', () => {
    const doc = loadLibrary();
    const effectId = coinShowerId(doc);
    // Renaming to an existing name does NOT throw mid-edit (uniqueness is export-only, section 8.1.1).
    expect(() => doc.history.execute(new RenameEffectCommand(effectId, 'rayBurst'))).not.toThrow();
    // But export fails loudly on the duplicate.
    expect(() => exportEffects(doc.effects)).toThrow();
  });
});

describe('effects commands: SetEffectsAtlas dangling-region guard (TASK-3.7.7)', () => {
  it('accepts an atlas that keeps every referenced region', () => {
    const doc = loadLibrary();
    expect(() =>
      doc.history.execute(new SetEffectsAtlasCommand(atlasKeepingRegions())),
    ).not.toThrow();
    expect(doc.effects.atlas().pages[0]?.file).toBe('vfx2.png');
  });

  it('rejects an atlas missing a referenced region with a typed dangling-region error and no mutation', () => {
    const doc = loadLibrary();
    const before = doc.effects.snapshot();
    let caught: unknown;
    try {
      doc.history.execute(new SetEffectsAtlasCommand(atlasDroppingRibbon()));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EffectsAtlasDanglingRegionError);
    if (caught instanceof EffectsAtlasDanglingRegionError) {
      expect(caught.report.errors.some((e) => e.code === 'EFFECT_REGION_MISSING')).toBe(true);
    }
    // The atlas was NOT swapped and no history entry was created (the do threw before mutating).
    expect(doc.effects.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
  });
});

describe('effects commands: typed-error guards (TASK-3.7.5)', () => {
  it('RemoveLifeStop rejects dropping below 2 stops and removing the t=0/t=1 anchors', () => {
    const doc = loadLibrary();
    const { effectId, layerId } = emitterLayerId(doc);
    // alphaOverLife is a two-stop curve; removing either endpoint would drop below 2 (lifeCurveMinStops).
    const alpha = doc.effects.getLayer(effectId, layerId)?.curves.get('alphaOverLife');
    const endpoint = alpha?.stops[0];
    if (!endpoint) throw new Error('missing stop');
    expect(() =>
      doc.history.execute(new RemoveLifeStopCommand(effectId, layerId, endpoint.id)),
    ).toThrow(EffectEditError);

    // scaleOverLife is three stops; its t=0 anchor (index 0) is not removable (lifeStopOrder).
    const scale = doc.effects.getLayer(effectId, layerId)?.curves.get('scaleOverLife');
    const anchor = scale?.stops[0];
    if (!anchor) throw new Error('missing anchor');
    expect(() =>
      doc.history.execute(new RemoveLifeStopCommand(effectId, layerId, anchor.id)),
    ).toThrow(EffectEditError);
    expect(doc.history.canUndo).toBe(false); // both rejections left no history entry
  });

  it('AddLifeStop / MoveLifeStop reject an order or anchor violation', () => {
    const doc = loadLibrary();
    const { effectId, layerId } = emitterLayerId(doc);
    // Adding a stop at t=0 collides with the existing t=0 anchor (strict ascending) -> lifeStopOrder.
    expect(() =>
      doc.history.execute(
        new AddLifeStopCommand(effectId, layerId, 'alphaOverLife', 0, 0.5, 'linear'),
      ),
    ).toThrow(EffectEditError);

    // Moving the t=0 anchor is rejected (anchors do not move).
    const anchor = doc.effects.getLayer(effectId, layerId)?.curves.get('scaleOverLife')?.stops[0];
    if (!anchor) throw new Error('missing anchor');
    expect(() =>
      doc.history.execute(new MoveLifeStopCommand(effectId, layerId, anchor.id, 0.5)),
    ).toThrow(EffectEditError);
  });

  it('SetEffectMeta rejects a non-positive simulationDt', () => {
    const doc = loadLibrary();
    const effectId = coinShowerId(doc);
    expect(() =>
      doc.history.execute(new SetEffectMetaCommand(effectId, { simulationDt: 0 })),
    ).toThrow(EffectEditError);
  });

  it('AddBundleItem rejects an unknown effect reference', () => {
    const doc = loadLibrary();
    const ghost = 'effect_does_not_exist' as EffectId;
    expect(() =>
      doc.history.execute(
        new AddBundleItemCommand('megaWin', {
          effect: ghost,
          startOffset: 0,
          anchorRole: 'center',
          seedSalt: 0,
        }),
      ),
    ).toThrow(EffectEditError);
  });
});

describe('effects commands: shared History with skeleton commands (TASK-3.7.6)', () => {
  it('effect and skeleton edits interleave cleanly on ONE undo stack', () => {
    const { env } = makeEffectsTestEnv();
    const doc = loadDocumentWithEffects(minimalSkeletonJson, effectsSeeds.library, env);
    const boneId = doc.model.bones()[0]!.id;
    const effectId = coinShowerId(doc);

    const skeletonBefore = doc.model.snapshot();
    const effectsBefore = doc.effects.snapshot();

    // Interleave: skeleton move, effect rename, skeleton move, effect meta.
    doc.history.execute(new MoveBoneCommand(boneId, { x: 10, y: 0 }));
    doc.history.execute(new RenameEffectCommand(effectId, 'coinShowerLarge'));
    doc.history.execute(new MoveBoneCommand(boneId, { x: 20, y: 0 }));
    doc.history.execute(new SetEffectMetaCommand(effectId, { duration: 5 }));

    // Four edits, four undo steps on the shared stack.
    expect(doc.history.canUndo).toBe(true);

    doc.history.undo(); // undo SetEffectMeta
    expect(doc.effects.getEffect(effectId)?.duration).toBe(2);
    doc.history.undo(); // undo second move
    expect(doc.model.getBone(boneId)?.x).toBe(10);
    doc.history.undo(); // undo rename
    expect(doc.effects.findEffectByName('coinShower')).toBeDefined();
    doc.history.undo(); // undo first move

    // Back to the pre-session state on BOTH models with one shared stack.
    expect(doc.model.snapshot()).toEqual(skeletonBefore);
    expect(doc.effects.snapshot()).toEqual(effectsBefore);
    expect(doc.history.canUndo).toBe(false);

    // Redo walks the same stack forward.
    doc.history.redo();
    expect(doc.model.getBone(boneId)?.x).toBe(10);
    doc.history.redo();
    expect(doc.effects.findEffectByName('coinShowerLarge')).toBeDefined();
  });

  it('a skeleton-only Document (no effects seed) leaves an empty effects library that still exports', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    expect(doc.effects.effects()).toHaveLength(0);
    expect(doc.effects.bundles()).toHaveLength(0);
    // An empty library exports to a valid (if empty) EffectsDocument.
    const exported = exportEffects(doc.effects);
    expect(exported.effectsFormatVersion).toBe('1.0.0');
    expect(Object.keys(exported.effects)).toHaveLength(0);
  });
});

describe('effects commands: import/export round-trip (section 8.1.1 identity)', () => {
  it('exportEffects(load(x)) deep-equals canonical x despite ids being regenerated on import', () => {
    const doc = loadLibrary();
    const exported = exportEffects(doc.effects);
    // The seed carries a recomputed hash; export recomputes it too, so the documents are deep-equal.
    expect(exported).toEqual(effectsSeeds.library);
  });
});
