import {
  CreateAnimationCommand,
  CreateBoneCommand,
  SetKeyframeCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type AnimationId,
  type BoneId,
  type Document,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
} from '../document';

// Test-only support: builds live Documents through the real command spine so the dopesheet tests exercise
// genuine AnimationEntity/History behavior (no hand-mocked model). Imported by *.test.ts only; the app
// bundle never references it. A fixed zero clock keeps the window-coalescer out of the way (each distinct
// SetKeyframe insert mints a new KeyframeId, so they never merge), which makes undo-step counts exact.

export interface SeedKey {
  readonly time: number;
  readonly value: KeyframeValue;
}

export function createEmptyDocument(): Document {
  return createDocument(newDocState('test'), { now: () => 0, createIds: makeIdFactory });
}

export function addBone(doc: Document, name: string): BoneId {
  const id = doc.ids.mint('bone');
  doc.history.execute(
    new CreateBoneCommand(id, null, {
      name,
      length: 100,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    }),
  );
  return id;
}

export function addAnimation(doc: Document, name: string, duration: number): AnimationId {
  const id = doc.ids.mint('animation');
  doc.history.execute(new CreateAnimationCommand(id, name, duration));
  return id;
}

export function setRotateKeys(
  doc: Document,
  animId: AnimationId,
  boneId: BoneId,
  keys: readonly SeedKey[],
): void {
  const target: KeyframeTarget = { kind: 'bone', boneId, channel: 'rotate' };
  for (const key of keys) {
    doc.history.execute(new SetKeyframeCommand(animId, target, key.time, key.value));
  }
}

export function rotateKeyframes(
  doc: Document,
  animId: AnimationId,
  boneId: BoneId,
): readonly { id: KeyframeId; time: number }[] {
  const set = doc.model.getAnimation(animId)?.bones.get(boneId);
  return set ? set.rotate.map((kf) => ({ id: kf.id, time: kf.time })) : [];
}
