import {
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateIkConstraintCommand,
  CreateSlotCommand,
  CreateTransformConstraintCommand,
  DefineEventCommand,
  SetAttachmentKeyframeCommand,
  SetDrawOrderKeyCommand,
  SetEventKeyCommand,
  SetIkKeyframeCommand,
  SetKeyframeCommand,
  SetSequenceKeyframeCommand,
  SetTransformKeyframeCommand,
  createDocument,
  makeIdFactory,
  newDocState,
  type AnimationId,
  type BoneComponentChannel,
  type BoneId,
  type Document,
  type EventDefId,
  type IkConstraintId,
  type KeyframeId,
  type KeyframeTarget,
  type KeyframeValue,
  type SlotId,
  type TransformConstraintId,
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

// Key a per-component bone channel (Stage F2, ADR-0009 section 4.1) with scalar values, for the split-track
// dopesheet tests.
export function setComponentKeys(
  doc: Document,
  animId: AnimationId,
  boneId: BoneId,
  channel: BoneComponentChannel,
  keys: readonly { readonly time: number; readonly value: number }[],
): void {
  const target: KeyframeTarget = { kind: 'bone', boneId, channel };
  for (const key of keys) {
    doc.history.execute(new SetKeyframeCommand(animId, target, key.time, { value: key.value }));
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

// Key the slot color channel at each of `times` (opaque white), for the delete/prune tests.
export function setColorKeys(
  doc: Document,
  animId: AnimationId,
  slotId: SlotId,
  times: readonly number[],
): void {
  const target: KeyframeTarget = { kind: 'slot', slotId, channel: 'color' };
  for (const time of times) {
    doc.history.execute(
      new SetKeyframeCommand(animId, target, time, { color: { r: 1, g: 1, b: 1, a: 1 } }),
    );
  }
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

// Insert stepped attachment-swap frames on `slotId`, each hiding the slot (name null, always valid without
// a real attachment), for the dopesheet attachment-row tests.
export function setAttachmentKeys(
  doc: Document,
  animId: AnimationId,
  slotId: SlotId,
  times: readonly number[],
): void {
  for (const time of times) {
    doc.history.execute(new SetAttachmentKeyframeCommand(animId, slotId, time, null));
  }
}

// Key the frame-sequence timeline at each of `times` (loop mode from frame 0), for the dopesheet
// sequence-row tests.
export function setSequenceKeys(
  doc: Document,
  animId: AnimationId,
  slotId: SlotId,
  times: readonly number[],
): void {
  for (const time of times) {
    doc.history.execute(new SetSequenceKeyframeCommand(animId, slotId, time, 'loop', 0, 0.1));
  }
}

// Create a 1-bone IK constraint reaching `target`, for the dopesheet IK-row tests.
export function addIkConstraint(
  doc: Document,
  name: string,
  chain: BoneId,
  target: BoneId,
): IkConstraintId {
  const id = doc.ids.mint('ikConstraint');
  doc.history.execute(new CreateIkConstraintCommand(id, name, [chain], target, 1, true));
  return id;
}

// Key the IK mix/bend timeline at each of `times`.
export function setIkKeys(
  doc: Document,
  animId: AnimationId,
  constraintId: IkConstraintId,
  times: readonly number[],
): void {
  for (const time of times) {
    doc.history.execute(new SetIkKeyframeCommand(animId, constraintId, time, 1, true));
  }
}

// Create a 1-bone transform constraint driving `chain` from `target`, all channels zeroed, for the
// dopesheet transform-row tests.
export function addTransformConstraint(
  doc: Document,
  name: string,
  chain: BoneId,
  target: BoneId,
): TransformConstraintId {
  const id = doc.ids.mint('transformConstraint');
  doc.history.execute(
    new CreateTransformConstraintCommand(id, name, [chain], target, {
      mixRotate: 0,
      mixX: 0,
      mixY: 0,
      mixScaleX: 0,
      mixScaleY: 0,
      mixShearY: 0,
      offsetRotation: 0,
      offsetX: 0,
      offsetY: 0,
      offsetScaleX: 0,
      offsetScaleY: 0,
      offsetShearY: 0,
    }),
  );
  return id;
}

// Key the transform-constraint mix timeline at each of `times` (only mixRotate present per key).
export function setTransformKeys(
  doc: Document,
  animId: AnimationId,
  constraintId: TransformConstraintId,
  times: readonly number[],
): void {
  for (const time of times) {
    doc.history.execute(
      new SetTransformKeyframeCommand(animId, constraintId, time, {
        mixRotate: 1,
        mixX: undefined,
        mixY: undefined,
        mixScaleX: undefined,
        mixScaleY: undefined,
        mixShearY: undefined,
      }),
    );
  }
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
