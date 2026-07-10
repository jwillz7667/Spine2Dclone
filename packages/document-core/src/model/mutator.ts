import type { AtlasRef, Sequence, SkeletonMeta } from '@marionette/format/types';
import type {
  FeatureFlowGraph,
  GridConfig,
  SceneRefs,
  SymbolAnimSet,
  SymbolId,
  TumbleChoreography,
  WinSequenceConfig,
} from '@marionette/format/slot-types';
import type {
  AnimationEntity,
  AttachmentEntity,
  AttachmentFrameEntity,
  BoneChannel,
  BoneEntity,
  BoneTimelineSet,
  DeformKeyframeEntity,
  DeformSkinKey,
  DrawOrderKeyEntity,
  EventDefEntity,
  EventKeyEntity,
  IkConstraintEntity,
  IkKeyframeEntity,
  KeyframeEntity,
  MeshGeometry,
  PathGeometry,
  RegionAttachmentEntity,
  SkinEntity,
  SequenceKeyframeEntity,
  SlotEntity,
  SlotTimelineSet,
  TransformConstraintEntity,
  TransformKeyframeEntity,
} from './doc-state';
import type {
  AnimationId,
  BoneId,
  EventDefId,
  IkConstraintId,
  SkinId,
  SlotId,
  TransformConstraintId,
} from './ids';
import type { DocumentModelInternal } from './internal';
import type { DocumentReadModel } from './read-model';

// The unforgeable witness for the privileged write surface (command-history Section 3.3). It is a
// real runtime symbol (so createMutator can stamp it) whose TYPE is a `unique symbol` (so the brand
// cannot be satisfied without it). Neither the symbol nor the Mutator type nor createMutator is
// re-exported through the package barrel, so UI code can obtain a Mutator only by being handed one,
// and `someObject as Mutator` cannot fabricate the brand. This is the structural half of LAW 2.
const MUTATOR_BRAND: unique symbol = Symbol('document-core.mutator');

export interface Mutator extends DocumentReadModel {
  readonly [MUTATOR_BRAND]: true;
  insertBone(entity: BoneEntity, index: number): void;
  removeBone(id: BoneId): void;
  patchBone(id: BoneId, patch: Partial<Omit<BoneEntity, 'id'>>): void;
  setBoneOrder(order: readonly BoneId[]): void;
  insertSlot(entity: SlotEntity, index: number): void;
  removeSlot(id: SlotId): void;
  patchSlot(id: SlotId, patch: Partial<Omit<SlotEntity, 'id' | 'attachment'>>): void;
  setActiveAttachment(id: SlotId, name: string | null): void;
  setSlotOrder(order: readonly SlotId[]): void;
  addAttachment(slotId: SlotId, entity: AttachmentEntity): void;
  removeAttachment(slotId: SlotId, name: string): void;
  patchAttachment(
    slotId: SlotId,
    name: string,
    patch: Partial<Omit<RegionAttachmentEntity, 'kind' | 'name'>>,
  ): void;
  setMeshGeometry(slotId: SlotId, name: string, geometry: MeshGeometry): void;
  setPathGeometry(slotId: SlotId, name: string, geometry: PathGeometry): void;
  setAttachmentSequence(slotId: SlotId, name: string, sequence: Sequence | undefined): void;
  insertAnimation(entity: AnimationEntity): void;
  removeAnimation(id: AnimationId): void;
  patchAnimation(
    id: AnimationId,
    patch: { readonly name?: string; readonly duration?: number },
  ): void;
  setBoneChannel(
    animId: AnimationId,
    boneId: BoneId,
    channel: BoneChannel,
    keyframes: readonly KeyframeEntity[],
  ): void;
  setSlotColorChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void;
  setSlotDarkChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void;
  setSlotRgbChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void;
  setSlotAlphaChannel(
    animId: AnimationId,
    slotId: SlotId,
    keyframes: readonly KeyframeEntity[],
  ): void;
  setSlotAttachmentChannel(
    animId: AnimationId,
    slotId: SlotId,
    frames: readonly AttachmentFrameEntity[],
  ): void;
  setSlotSequenceChannel(
    animId: AnimationId,
    slotId: SlotId,
    keys: readonly SequenceKeyframeEntity[],
  ): void;
  setBoneTimelines(animId: AnimationId, boneId: BoneId, set: BoneTimelineSet | null): void;
  setSlotTimelines(animId: AnimationId, slotId: SlotId, set: SlotTimelineSet | null): void;
  setIkChannel(
    animId: AnimationId,
    constraintId: IkConstraintId,
    keyframes: readonly IkKeyframeEntity[],
  ): void;
  setTransformChannel(
    animId: AnimationId,
    constraintId: TransformConstraintId,
    keyframes: readonly TransformKeyframeEntity[],
  ): void;
  setDeformChannel(
    animId: AnimationId,
    skinKey: DeformSkinKey,
    slotId: SlotId,
    attachmentName: string,
    keyframes: readonly DeformKeyframeEntity[],
  ): void;
  insertIkConstraint(entity: IkConstraintEntity, index: number): void;
  removeIkConstraint(id: IkConstraintId): void;
  patchIkConstraint(id: IkConstraintId, patch: Partial<Omit<IkConstraintEntity, 'id'>>): void;
  setIkConstraintOrder(id: IkConstraintId, order: number | undefined): void;
  insertTransformConstraint(entity: TransformConstraintEntity, index: number): void;
  removeTransformConstraint(id: TransformConstraintId): void;
  patchTransformConstraint(
    id: TransformConstraintId,
    patch: Partial<Omit<TransformConstraintEntity, 'id'>>,
  ): void;
  setTransformConstraintOrder(id: TransformConstraintId, order: number | undefined): void;
  insertSkin(entity: SkinEntity, index: number): void;
  removeSkin(id: SkinId): void;
  patchSkin(id: SkinId, patch: { readonly name?: string }): void;
  // Set (or clear) a named skin's Stage F2 (ADR-0009 section 5) scoping list. `names === undefined` (or an
  // empty list) removes the scoping dimension; otherwise it stores the name list verbatim.
  setSkinScope(
    skinId: SkinId,
    scope: 'bones' | 'constraints',
    names: readonly string[] | undefined,
  ): void;
  setSkinAttachment(skinId: SkinId, slotId: SlotId, entity: AttachmentEntity): void;
  removeSkinAttachment(skinId: SkinId, slotId: SlotId, name: string): void;
  // Event-definition + metadata + per-animation event/draw-order write surface (Stage F1, PP-D9).
  insertEventDef(entity: EventDefEntity, index: number): void;
  removeEventDef(id: EventDefId): void;
  setEventDef(id: EventDefId, entity: EventDefEntity): void;
  setMetadata(metadata: SkeletonMeta | undefined): void;
  setEventTimeline(animId: AnimationId, keys: readonly EventKeyEntity[]): void;
  setDrawOrderTimeline(animId: AnimationId, keys: readonly DrawOrderKeyEntity[]): void;
  // Slot-scene write surface (phase-4 WP-4.5 / WP-4.6 / WP-4.8).
  setSlotGrid(grid: GridConfig): void;
  setSymbolAnimSet(symbolId: SymbolId, set: SymbolAnimSet): void;
  removeSymbolAnimSet(symbolId: SymbolId): void;
  setSceneRefs(refs: SceneRefs): void;
  setSlotWinSequencer(config: WinSequenceConfig): void;
  setSlotFeatureFlows(graph: FeatureFlowGraph): void;
  setSlotTumble(tumble: TumbleChoreography): void;
  setAtlas(atlas: AtlasRef): void;
}

// The ONLY factory that can produce a Mutator. History receives the Mutator at construction; nothing
// else imports this. The returned object delegates reads and writes to the internal model and carries
// the brand. `revision` is a live getter so a command always sees the current value.
export function createMutator(model: DocumentModelInternal): Mutator {
  return {
    [MUTATOR_BRAND]: true,
    get revision(): number {
      return model.revision;
    },
    get name(): string {
      return model.name;
    },
    getBone: (id) => model.getBone(id),
    bones: () => model.bones(),
    findBoneByName: (name) => model.findBoneByName(name),
    getSlot: (id) => model.getSlot(id),
    slots: () => model.slots(),
    attachments: (slotId) => model.attachments(slotId),
    getAttachment: (slotId, name) => model.getAttachment(slotId, name),
    getAnimation: (id) => model.getAnimation(id),
    animations: () => model.animations(),
    getIkConstraint: (id) => model.getIkConstraint(id),
    ikConstraints: () => model.ikConstraints(),
    getTransformConstraint: (id) => model.getTransformConstraint(id),
    transformConstraints: () => model.transformConstraints(),
    getSkin: (id) => model.getSkin(id),
    skins: () => model.skins(),
    getEventDef: (id) => model.getEventDef(id),
    eventDefs: () => model.eventDefs(),
    findEventDefByName: (name) => model.findEventDefByName(name),
    metadata: () => model.metadata(),
    slotScene: () => model.slotScene(),
    slotGrid: () => model.slotGrid(),
    slotTumble: () => model.slotTumble(),
    getSymbolAnimSet: (symbolId) => model.getSymbolAnimSet(symbolId),
    preserved: () => model.preserved(),
    snapshot: () => model.snapshot(),
    insertBone: (entity, index) => model.insertBone(entity, index),
    removeBone: (id) => model.removeBone(id),
    patchBone: (id, patch) => model.patchBone(id, patch),
    setBoneOrder: (order) => model.setBoneOrder(order),
    insertSlot: (entity, index) => model.insertSlot(entity, index),
    removeSlot: (id) => model.removeSlot(id),
    patchSlot: (id, patch) => model.patchSlot(id, patch),
    setActiveAttachment: (id, name) => model.setActiveAttachment(id, name),
    setSlotOrder: (order) => model.setSlotOrder(order),
    addAttachment: (slotId, entity) => model.addAttachment(slotId, entity),
    removeAttachment: (slotId, name) => model.removeAttachment(slotId, name),
    patchAttachment: (slotId, name, patch) => model.patchAttachment(slotId, name, patch),
    setMeshGeometry: (slotId, name, geometry) => model.setMeshGeometry(slotId, name, geometry),
    setPathGeometry: (slotId, name, geometry) => model.setPathGeometry(slotId, name, geometry),
    setAttachmentSequence: (slotId, name, sequence) =>
      model.setAttachmentSequence(slotId, name, sequence),
    insertAnimation: (entity) => model.insertAnimation(entity),
    removeAnimation: (id) => model.removeAnimation(id),
    patchAnimation: (id, patch) => model.patchAnimation(id, patch),
    setBoneChannel: (animId, boneId, channel, keyframes) =>
      model.setBoneChannel(animId, boneId, channel, keyframes),
    setSlotColorChannel: (animId, slotId, keyframes) =>
      model.setSlotColorChannel(animId, slotId, keyframes),
    setSlotDarkChannel: (animId, slotId, keyframes) =>
      model.setSlotDarkChannel(animId, slotId, keyframes),
    setSlotRgbChannel: (animId, slotId, keyframes) =>
      model.setSlotRgbChannel(animId, slotId, keyframes),
    setSlotAlphaChannel: (animId, slotId, keyframes) =>
      model.setSlotAlphaChannel(animId, slotId, keyframes),
    setSlotAttachmentChannel: (animId, slotId, frames) =>
      model.setSlotAttachmentChannel(animId, slotId, frames),
    setSlotSequenceChannel: (animId, slotId, keys) =>
      model.setSlotSequenceChannel(animId, slotId, keys),
    setBoneTimelines: (animId, boneId, set) => model.setBoneTimelines(animId, boneId, set),
    setSlotTimelines: (animId, slotId, set) => model.setSlotTimelines(animId, slotId, set),
    setIkChannel: (animId, constraintId, keyframes) =>
      model.setIkChannel(animId, constraintId, keyframes),
    setTransformChannel: (animId, constraintId, keyframes) =>
      model.setTransformChannel(animId, constraintId, keyframes),
    setDeformChannel: (animId, skinKey, slotId, name, keyframes) =>
      model.setDeformChannel(animId, skinKey, slotId, name, keyframes),
    insertIkConstraint: (entity, index) => model.insertIkConstraint(entity, index),
    removeIkConstraint: (id) => model.removeIkConstraint(id),
    patchIkConstraint: (id, patch) => model.patchIkConstraint(id, patch),
    setIkConstraintOrder: (id, order) => model.setIkConstraintOrder(id, order),
    insertTransformConstraint: (entity, index) => model.insertTransformConstraint(entity, index),
    removeTransformConstraint: (id) => model.removeTransformConstraint(id),
    patchTransformConstraint: (id, patch) => model.patchTransformConstraint(id, patch),
    setTransformConstraintOrder: (id, order) => model.setTransformConstraintOrder(id, order),
    insertSkin: (entity, index) => model.insertSkin(entity, index),
    removeSkin: (id) => model.removeSkin(id),
    patchSkin: (id, patch) => model.patchSkin(id, patch),
    setSkinScope: (skinId, scope, names) => model.setSkinScope(skinId, scope, names),
    setSkinAttachment: (skinId, slotId, entity) => model.setSkinAttachment(skinId, slotId, entity),
    removeSkinAttachment: (skinId, slotId, name) =>
      model.removeSkinAttachment(skinId, slotId, name),
    insertEventDef: (entity, index) => model.insertEventDef(entity, index),
    removeEventDef: (id) => model.removeEventDef(id),
    setEventDef: (id, entity) => model.setEventDef(id, entity),
    setMetadata: (metadata) => model.setMetadata(metadata),
    setEventTimeline: (animId, keys) => model.setEventTimeline(animId, keys),
    setDrawOrderTimeline: (animId, keys) => model.setDrawOrderTimeline(animId, keys),
    setSlotGrid: (grid) => model.setSlotGrid(grid),
    setSymbolAnimSet: (symbolId, set) => model.setSymbolAnimSet(symbolId, set),
    removeSymbolAnimSet: (symbolId) => model.removeSymbolAnimSet(symbolId),
    setSceneRefs: (refs) => model.setSceneRefs(refs),
    setSlotWinSequencer: (config) => model.setSlotWinSequencer(config),
    setSlotFeatureFlows: (graph) => model.setSlotFeatureFlows(graph),
    setSlotTumble: (tumble) => model.setSlotTumble(tumble),
    setAtlas: (atlas) => model.setAtlas(atlas),
  };
}
