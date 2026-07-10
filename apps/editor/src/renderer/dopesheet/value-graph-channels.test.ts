import { describe, expect, it } from 'vitest';
import {
  SetKeyframeCommand,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeTarget,
  type KeyframeValue,
} from '../document';
import type { TrackNames } from './tracks';
import {
  buildValueLanes,
  laneTimeExtent,
  laneValueExtent,
  readComponent,
  writeComponent,
  type ComponentField,
} from './value-graph-channels';
import { addAnimation, addBone, createEmptyDocument, setRotateKeys } from './seed-document';

// A TrackNames that resolves bones/slots from the model and stubs the constraint/skin names the value graph
// never reads (only boneName/slotName are used by buildValueLanes).
function namesOf(doc: Document): TrackNames {
  return {
    boneName: (id) => doc.model.getBone(id)?.name ?? String(id),
    slotName: (id) => doc.model.getSlot(id)?.name ?? String(id),
    ikName: (id) => String(id),
    transformName: (id) => String(id),
    pathName: (id) => String(id),
    physicsName: (id) => String(id),
    skinName: (key) => String(key),
  };
}

function setChannelKeys(
  doc: Document,
  animId: AnimationId,
  target: KeyframeTarget,
  keys: readonly { time: number; value: KeyframeValue }[],
): void {
  for (const key of keys) {
    doc.history.execute(new SetKeyframeCommand(animId, target, key.time, key.value));
  }
}

describe('value-graph component read/write', () => {
  it('reads each value shape by its component field', () => {
    expect(readComponent({ angle: 42 }, { shape: 'rotate' })).toBe(42);
    expect(readComponent({ x: 3, y: 7 }, { shape: 'vec2', axis: 'x' })).toBe(3);
    expect(readComponent({ x: 3, y: 7 }, { shape: 'vec2', axis: 'y' })).toBe(7);
    expect(readComponent({ value: 9 }, { shape: 'scalar' })).toBe(9);
    expect(
      readComponent({ color: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 } }, { shape: 'color', axis: 'b' }),
    ).toBe(0.3);
    expect(readComponent({ rgb: { r: 0.5, g: 0.6, b: 0.7 } }, { shape: 'rgb', axis: 'g' })).toBe(
      0.6,
    );
    expect(readComponent({ alpha: 0.8 }, { shape: 'alpha' })).toBe(0.8);
  });

  it('reads 0 for a value whose shape does not match the field (total, never throws)', () => {
    expect(readComponent({ angle: 5 }, { shape: 'vec2', axis: 'x' })).toBe(0);
    expect(readComponent({ x: 1, y: 2 }, { shape: 'color', axis: 'r' })).toBe(0);
  });

  it('writes one component while preserving every untouched component of a multi-field value', () => {
    // vec2: writing x keeps y.
    expect(writeComponent({ x: 3, y: 7 }, { shape: 'vec2', axis: 'x' }, 11)).toEqual({
      x: 11,
      y: 7,
    });
    expect(writeComponent({ x: 3, y: 7 }, { shape: 'vec2', axis: 'y' }, 11)).toEqual({
      x: 3,
      y: 11,
    });
    // rgba: writing g keeps r, b, a.
    expect(
      writeComponent(
        { color: { r: 0.1, g: 0.2, b: 0.3, a: 0.4 } },
        { shape: 'color', axis: 'g' },
        0.9,
      ),
    ).toEqual({ color: { r: 0.1, g: 0.9, b: 0.3, a: 0.4 } });
    // rgb triple: writing b keeps r, g.
    expect(
      writeComponent({ rgb: { r: 0.1, g: 0.2, b: 0.3 } }, { shape: 'rgb', axis: 'b' }, 0.9),
    ).toEqual({
      rgb: { r: 0.1, g: 0.2, b: 0.9 },
    });
    // Lone shapes replace wholesale.
    expect(writeComponent({ angle: 1 }, { shape: 'rotate' }, 2)).toEqual({ angle: 2 });
    expect(writeComponent({ value: 1 }, { shape: 'scalar' }, 2)).toEqual({ value: 2 });
    expect(writeComponent({ alpha: 0.1 }, { shape: 'alpha' }, 0.2)).toEqual({ alpha: 0.2 });
  });

  it('round-trips read(write(prev, f, s), f) === s for every shape', () => {
    const cases: { prev: KeyframeValue; field: ComponentField; scalar: number }[] = [
      { prev: { angle: 0 }, field: { shape: 'rotate' }, scalar: -12.5 },
      { prev: { x: 1, y: 2 }, field: { shape: 'vec2', axis: 'x' }, scalar: 3.25 },
      { prev: { x: 1, y: 2 }, field: { shape: 'vec2', axis: 'y' }, scalar: -4.75 },
      { prev: { value: 0 }, field: { shape: 'scalar' }, scalar: 100 },
      {
        prev: { color: { r: 0, g: 0, b: 0, a: 1 } },
        field: { shape: 'color', axis: 'a' },
        scalar: 0.33,
      },
      { prev: { rgb: { r: 0, g: 0, b: 0 } }, field: { shape: 'rgb', axis: 'r' }, scalar: 0.66 },
      { prev: { alpha: 1 }, field: { shape: 'alpha' }, scalar: 0.5 },
    ];
    for (const { prev, field, scalar } of cases) {
      expect(readComponent(writeComponent(prev, field, scalar), field)).toBe(scalar);
    }
  });
});

describe('value-graph lane derivation', () => {
  function rig(): { doc: Document; animId: AnimationId; boneId: BoneId } {
    const doc = createEmptyDocument();
    const boneId = addBone(doc, 'arm');
    const animId = addAnimation(doc, 'idle', 2);
    return { doc, animId, boneId };
  }

  it('expands a rotate channel to one lane and a translate channel to X and Y lanes', () => {
    const { doc, animId, boneId } = rig();
    setRotateKeys(doc, animId, boneId, [
      { time: 0, value: { angle: 0 } },
      { time: 1, value: { angle: 30 } },
    ]);
    setChannelKeys(doc, animId, { kind: 'bone', boneId, channel: 'translate' }, [
      { time: 0, value: { x: 0, y: 0 } },
      { time: 1, value: { x: 10, y: -5 } },
    ]);

    const anim = doc.model.getAnimation(animId)!;
    const lanes = buildValueLanes(anim, namesOf(doc));
    const labels = lanes.map((l) => l.label);

    expect(labels).toEqual(['Rotate', 'Translate X', 'Translate Y']);
    // The translate X and Y lanes read the two components of the same vec2 keyframes.
    const tx = lanes.find((l) => l.label === 'Translate X')!;
    const ty = lanes.find((l) => l.label === 'Translate Y')!;
    expect(tx.keys.map((k) => k.value)).toEqual([0, 10]);
    expect(ty.keys.map((k) => k.value)).toEqual([0, -5]);
    // Both share the same channel target and the same keyframe ids (one keyframe, two lanes).
    expect(tx.target).toEqual(ty.target);
    expect(tx.keys.map((k) => k.id)).toEqual(ty.keys.map((k) => k.id));
  });

  it('omits empty channels and keeps lane keys stable across a rename', () => {
    const { doc, animId, boneId } = rig();
    setRotateKeys(doc, animId, boneId, [{ time: 0, value: { angle: 0 } }]);
    const anim = doc.model.getAnimation(animId)!;
    const before = buildValueLanes(anim, namesOf(doc));
    expect(before).toHaveLength(1);
    expect(before[0]!.key).toBe(`bone:${boneId}:rotate:angle`);
    // The lane key is id-based, so a display-name change does not perturb it.
    const renamed = buildValueLanes(anim, { ...namesOf(doc), boneName: () => 'renamed' });
    expect(renamed[0]!.key).toBe(before[0]!.key);
    expect(renamed[0]!.group).toBe('renamed');
  });

  it('computes value and time extents across lanes, and null when empty', () => {
    const { doc, animId, boneId } = rig();
    setRotateKeys(doc, animId, boneId, [
      { time: 0, value: { angle: -20 } },
      { time: 1.5, value: { angle: 40 } },
    ]);
    const anim = doc.model.getAnimation(animId)!;
    const lanes = buildValueLanes(anim, namesOf(doc));
    expect(laneValueExtent(lanes)).toEqual([-20, 40]);
    expect(laneTimeExtent(lanes)).toEqual([0, 1.5]);
    expect(laneValueExtent([])).toBeNull();
    expect(laneTimeExtent([])).toBeNull();
  });
});
