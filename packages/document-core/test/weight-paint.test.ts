import {
  decodeWeightedVertices,
  WEIGHT_SUM_EPSILON,
  type PerVertexBindings,
} from '@marionette/format';
import { describe, expect, it } from 'vitest';
import {
  AutoWeightFromProximityCommand,
  NormalizeMeshWeightsCommand,
  PaintWeightStrokeCommand,
  loadDocument,
  type Document,
  type PaintMode,
  type SlotId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

function weightedTarget(doc: Document): { slotId: SlotId; name: string } {
  const slot = doc.model.slots()[0]!;
  const att = doc.model
    .attachments(slot.id)
    .find((a) => a.kind === 'mesh' && a.bones !== undefined);
  if (!att || att.kind !== 'mesh') throw new Error('seed has no weighted mesh');
  return { slotId: slot.id, name: att.name };
}

function meshBindings(doc: Document, slotId: SlotId, name: string): PerVertexBindings {
  const mesh = doc.model.getAttachment(slotId, name);
  if (mesh?.kind !== 'mesh') throw new Error('not a mesh');
  return decodeWeightedVertices({ vertices: [...mesh.vertices] });
}

function expectNormalizedAndCapped(bindings: PerVertexBindings): void {
  for (const influences of bindings) {
    expect(influences.length).toBeGreaterThanOrEqual(1);
    expect(influences.length).toBeLessThanOrEqual(4);
    const sum = influences.reduce((s, i) => s + i.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThanOrEqual(WEIGHT_SUM_EPSILON);
  }
}

// A deterministic PRNG so the random-stroke invariant test is reproducible (no Math.random in tests).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('PaintWeightStroke', () => {
  it('coalesces a 200-dab stroke with a mid-stroke pause into one undo step (TASK-2.4.6)', () => {
    const { env, advance } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);
    const active = doc.model.bones()[0]!.id;
    const before = doc.model.snapshot();

    doc.history.beginInteraction();
    for (let i = 0; i < 200; i += 1) {
      if (i === 100) advance(500); // a pause far beyond the 250ms window mid-stroke
      doc.history.execute(
        new PaintWeightStrokeCommand(
          slotId,
          name,
          active,
          [{ vertexIndex: i % 4, deltaWeight: 0.001 }],
          'add',
        ),
      );
    }
    const event = doc.history.endInteraction('Paint Weights');
    expect(event?.kind).toBe('mesh.paintWeight'); // one merged command, not a composite

    let steps = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      steps += 1;
    }
    expect(steps).toBe(1);
    expect(doc.model.snapshot()).toEqual(before); // one undo reverts the whole stroke
  });

  it('add raises and subtract lowers the active bone weight, staying normalized', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);
    const root = doc.model.bones()[0]!; // global bone index 0

    const weightAt = (): number =>
      meshBindings(doc, slotId, name)[0]!.find((i) => i.boneIndex === 0)?.weight ?? 0;

    const start = weightAt();
    doc.history.execute(
      new PaintWeightStrokeCommand(
        slotId,
        name,
        root.id,
        [{ vertexIndex: 0, deltaWeight: 0.3 }],
        'add',
      ),
    );
    const raised = weightAt();
    expect(raised).toBeGreaterThan(start);
    expectNormalizedAndCapped(meshBindings(doc, slotId, name));

    doc.history.execute(
      new PaintWeightStrokeCommand(
        slotId,
        name,
        root.id,
        [{ vertexIndex: 0, deltaWeight: 0.2 }],
        'subtract',
      ),
    );
    expect(weightAt()).toBeLessThan(raised);
    expectNormalizedAndCapped(meshBindings(doc, slotId, name));
  });

  it('smooth applies the supplied signed delta and keeps the vertex valid', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);
    const root = doc.model.bones()[0]!;
    const weightAt = (): number =>
      meshBindings(doc, slotId, name)[0]!.find((i) => i.boneIndex === 0)?.weight ?? 0;

    const start = weightAt();
    doc.history.execute(
      new PaintWeightStrokeCommand(
        slotId,
        name,
        root.id,
        [{ vertexIndex: 0, deltaWeight: -0.1 }],
        'smooth',
      ),
    );
    expect(weightAt()).toBeLessThan(start); // negative delta moves the active weight down
    expectNormalizedAndCapped(meshBindings(doc, slotId, name));
  });

  it('keeps every touched vertex summed to 1 and capped to 4 across random strokes', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);
    const boneIds = doc.model.bones().map((b) => b.id); // includes the unbound 'tip', so paint can add it
    const modes: PaintMode[] = ['add', 'subtract', 'smooth'];
    const rng = mulberry32(0xc0ffee);

    for (let stroke = 0; stroke < 80; stroke += 1) {
      const active = boneIds[Math.floor(rng() * boneIds.length)]!;
      const mode = modes[Math.floor(rng() * modes.length)]!;
      const vertexIndex = Math.floor(rng() * 4);
      const deltaWeight = (mode === 'smooth' ? rng() - 0.5 : rng()) * 0.8;
      doc.history.execute(
        new PaintWeightStrokeCommand(slotId, name, active, [{ vertexIndex, deltaWeight }], mode),
      );
      expectNormalizedAndCapped(meshBindings(doc, slotId, name));
    }
  });
});

describe('AutoWeightFromProximity', () => {
  it('produces a normalized, capped weight set', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);

    doc.history.execute(new AutoWeightFromProximityCommand(slotId, name));
    expectNormalizedAndCapped(meshBindings(doc, slotId, name));
  });
});

describe('NormalizeMeshWeights', () => {
  it('renormalizes a slightly-off weighted mesh so each vertex sums to 1', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.weighted, env);
    const { slotId, name } = weightedTarget(doc);

    doc.history.execute(new NormalizeMeshWeightsCommand(slotId, name));
    for (const influences of meshBindings(doc, slotId, name)) {
      expect(influences.reduce((s, i) => s + i.weight, 0)).toBeCloseTo(1, 9);
    }
  });
});
