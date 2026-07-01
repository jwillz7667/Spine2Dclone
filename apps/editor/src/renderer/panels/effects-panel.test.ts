import { describe, expect, it } from 'vitest';
import {
  AddLayerCommand,
  CreateEffectCommand,
  DeleteEffectCommand,
  RemoveLayerCommand,
  RenameEffectCommand,
  SetEffectMetaCommand,
  SetLayerBlendModeCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type Document,
  type EffectId,
} from '@marionette/document-core';

// Prove the Effects panel's command wiring at the LOGIC level (the panel .tsx cannot render in the Node test
// env). Each test builds a fresh Document through the same factory the composition root uses (an empty effects
// library shares the ONE History with the skeleton) and drives the exact commands the panel dispatches, then
// asserts Document.effects reflects the change and that a single undo reverses it (LAW 2: every mutation is a
// reversible command). The commands are the SAME classes the panel imports from ../document, so a green test
// here is the panel's wiring proven correct even though the GUI is not exercised.
function freshDocument(): Document {
  return createDocument(newDocState('untitled'), {
    now: () => 0,
    createIds: makeIdFactory,
  });
}

// Create an effect exactly as the panel's New Effect button does, returning the minted id read off the command.
function createEffect(doc: Document, name: string): EffectId {
  const command = new CreateEffectCommand({
    name,
    duration: null,
    deterministic: true,
    simulationDt: 1 / 60,
    blendMode: 'additive',
  });
  doc.history.execute(command);
  const id = command.createdId;
  if (id === undefined) throw new Error('CreateEffectCommand did not mint an id');
  return id;
}

describe('EffectsPanel command wiring', () => {
  it('creates an effect through History and undo removes it', () => {
    const doc = freshDocument();
    expect(doc.effects.effects()).toHaveLength(0);

    const id = createEffect(doc, 'effect_1');

    const created = doc.effects.getEffect(id);
    expect(created?.name).toBe('effect_1');
    expect(created?.deterministic).toBe(true);
    expect(created?.duration).toBeNull();
    expect(created?.simulationDt).toBeCloseTo(1 / 60);
    expect(created?.blendMode).toBe('additive');
    expect(doc.effects.effects()).toHaveLength(1);

    doc.history.undo();
    expect(doc.effects.effects()).toHaveLength(0);
    expect(doc.effects.getEffect(id)).toBeUndefined();
  });

  it('renames an effect and undo restores the prior name (zero cascade)', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');

    doc.history.execute(new RenameEffectCommand(id, 'coinShower'));
    expect(doc.effects.getEffect(id)?.name).toBe('coinShower');

    doc.history.undo();
    expect(doc.effects.getEffect(id)?.name).toBe('effect_1');
  });

  it('sets effect meta (duration, deterministic, simulationDt) and undo restores each', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');

    doc.history.execute(new SetEffectMetaCommand(id, { duration: 3 }));
    doc.history.execute(new SetEffectMetaCommand(id, { deterministic: false }));
    doc.history.execute(new SetEffectMetaCommand(id, { simulationDt: 1 / 120 }));

    const edited = doc.effects.getEffect(id);
    expect(edited?.duration).toBe(3);
    expect(edited?.deterministic).toBe(false);
    expect(edited?.simulationDt).toBeCloseTo(1 / 120);

    doc.history.undo(); // undo simulationDt
    expect(doc.effects.getEffect(id)?.simulationDt).toBeCloseTo(1 / 60);
    doc.history.undo(); // undo deterministic
    expect(doc.effects.getEffect(id)?.deterministic).toBe(true);
    doc.history.undo(); // undo duration
    expect(doc.effects.getEffect(id)?.duration).toBeNull();
  });

  it('adds a layer of each kind through History and undo removes it', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');
    expect(doc.effects.getEffect(id)?.layerOrder).toHaveLength(0);

    // An empty atlas means the panel passes an empty placeholder region; the command accepts it at author
    // time (export, not the command, enforces region resolvability).
    doc.history.execute(new AddLayerCommand(id, 'emitter', 'additive', ''));
    doc.history.execute(new AddLayerCommand(id, 'spriteAnimator', 'normal', ''));
    doc.history.execute(new AddLayerCommand(id, 'ribbonTrail', 'screen', ''));

    const withLayers = doc.effects.getEffect(id);
    expect(withLayers?.layerOrder).toHaveLength(3);
    const kinds = withLayers?.layerOrder.map(
      (layerId) => withLayers.layers.get(layerId)?.body.type,
    );
    expect(kinds).toEqual(['emitter', 'spriteAnimator', 'ribbonTrail']);

    doc.history.undo();
    expect(doc.effects.getEffect(id)?.layerOrder).toHaveLength(2);
  });

  it('sets a layer blend mode and undo restores the prior mode', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');
    const add = new AddLayerCommand(id, 'emitter', 'additive', '');
    doc.history.execute(add);
    const layerId = add.createdLayerId;
    if (layerId === undefined) throw new Error('AddLayerCommand did not mint a layer id');
    expect(doc.effects.getLayer(id, layerId)?.blendMode).toBe('additive');

    doc.history.execute(new SetLayerBlendModeCommand(id, layerId, 'normal'));
    expect(doc.effects.getLayer(id, layerId)?.blendMode).toBe('normal');

    doc.history.undo();
    expect(doc.effects.getLayer(id, layerId)?.blendMode).toBe('additive');
  });

  it('removes a layer through History and undo restores it at its z position', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');
    const first = new AddLayerCommand(id, 'emitter', 'additive', '');
    const second = new AddLayerCommand(id, 'spriteAnimator', 'normal', '');
    doc.history.execute(first);
    doc.history.execute(second);
    const firstLayerId = first.createdLayerId;
    if (firstLayerId === undefined) throw new Error('AddLayerCommand did not mint a layer id');

    doc.history.execute(new RemoveLayerCommand(id, firstLayerId));
    expect(doc.effects.getEffect(id)?.layerOrder).toHaveLength(1);
    expect(doc.effects.getLayer(id, firstLayerId)).toBeUndefined();

    doc.history.undo();
    const restored = doc.effects.getEffect(id);
    expect(restored?.layerOrder).toHaveLength(2);
    // The removed layer returns at its original z index (index 0, top of the pre-remove order).
    expect(restored?.layerOrder[0]).toBe(firstLayerId);
  });

  it('deletes an effect through History and undo restores it', () => {
    const doc = freshDocument();
    const id = createEffect(doc, 'effect_1');
    doc.history.execute(new AddLayerCommand(id, 'emitter', 'additive', ''));
    expect(doc.effects.effects()).toHaveLength(1);

    doc.history.execute(new DeleteEffectCommand(id));
    expect(doc.effects.effects()).toHaveLength(0);
    expect(doc.effects.getEffect(id)).toBeUndefined();

    doc.history.undo();
    const restored = doc.effects.getEffect(id);
    expect(restored).toBeDefined();
    // The delete captured the whole effect, so its layer returns with it in one undo step.
    expect(restored?.layerOrder).toHaveLength(1);
  });
});
