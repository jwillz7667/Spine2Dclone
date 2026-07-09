import {
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateSlotCommand,
  DefineEventCommand,
  SetDrawOrderKeyCommand,
  SetEventKeyCommand,
  SetKeyframeCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type AnimationId,
  type BoneId,
  type Document,
  type EventDefId,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
  type SlotId,
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

// Add a slot riding `boneId`, for the draw-order/special-timeline tests (a draw-order key references slots).
export function addSlot(doc: Document, name: string, boneId: BoneId): SlotId {
  const id = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(id, {
      name,
      bone: boneId,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: null,
      blendMode: 'normal',
    }),
  );
  return id;
}

// Define a document-level event with cleared payload defaults and no audio hint.
export function defineEvent(doc: Document, name: string): EventDefId {
  const id = doc.ids.mint('eventDef');
  doc.history.execute(
    new DefineEventCommand(id, name, {
      int: undefined,
      float: undefined,
      string: undefined,
      audio: undefined,
    }),
  );
  return id;
}

// Fire `eventId` at each of `times`, then return the resulting event-key ids and times.
export function setEventKeys(
  doc: Document,
  animId: AnimationId,
  eventId: EventDefId,
  times: readonly number[],
): void {
  for (const time of times) {
    doc.history.execute(
      new SetEventKeyCommand(animId, eventId, time, {
        int: undefined,
        float: undefined,
        string: undefined,
      }),
    );
  }
}

export function eventKeys(
  doc: Document,
  animId: AnimationId,
): readonly { id: KeyframeId; time: number }[] {
  const animation = doc.model.getAnimation(animId);
  return animation ? animation.events.map((key) => ({ id: key.id, time: key.time })) : [];
}

// Insert a draw-order key at `time` moving `slotId` by `offset` positions from its setup index.
export function setDrawOrderKey(
  doc: Document,
  animId: AnimationId,
  time: number,
  slotId: SlotId,
  offset: number,
): void {
  doc.history.execute(new SetDrawOrderKeyCommand(animId, time, [{ slot: slotId, offset }]));
}

export function drawOrderKeys(
  doc: Document,
  animId: AnimationId,
): readonly { id: KeyframeId; time: number }[] {
  const animation = doc.model.getAnimation(animId);
  return animation ? animation.drawOrder.map((key) => ({ id: key.id, time: key.time })) : [];
}
