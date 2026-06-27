import { Container, Graphics, Sprite } from 'pixi.js';
import { parseDocument, type ValidateOptions } from '@marionette/format';
import type { RegionAttachment, SkeletonDocument, Skin } from '@marionette/format/types';
import {
  AnimationNotFoundError,
  buildPose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  resetToSetupPose,
  sampleSkeleton,
  SLOT_COLOR_STRIDE,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { applyWorldToTarget, mapWorldToDisplay, type DisplayTransform } from './map-transform';
import { drawBone } from './bone-graphics';
import { createAttachmentSprite, packTint } from './attachment-sprites';
import { computeRegionSized, placeRegion } from './region-placement';
import { loopTime } from '../transport';

// The headless description of a built scene. SkeletonView records this alongside the live PixiJS
// objects so tests (and the editor) can read the mapped transforms without a WebGL context, while the
// same values are what was assigned to the display objects (scene-graph.test.ts cross-checks both).
export interface BoneRender {
  readonly name: string;
  readonly length: number;
  readonly transform: DisplayTransform;
}

export interface AttachmentRender {
  readonly slot: string;
  readonly attachment: string;
  readonly width: number;
  readonly height: number;
  readonly tint: number; // 0xRRGGBB
  readonly alpha: number;
  readonly transform: DisplayTransform;
  // The sprite center in world space (the attachment origin), equal to the transform translation.
  readonly worldPosition: readonly [number, number];
}

export interface SceneDescription {
  readonly bones: readonly BoneRender[];
  readonly attachments: readonly AttachmentRender[];
}

// One bone's render binding: its pooled graphic plus its index into the pose's world buffer. Geometry
// (the tapered diamond) depends only on bone length, so it is drawn once at build time; per frame only
// the world transform is reapplied.
interface BoneRecord {
  readonly name: string;
  readonly length: number;
  readonly boneIndex: number;
  readonly graphics: Graphics;
}

// A region attachment resolved to its geometry and its constant sized-local matrix (computed once).
interface RegionEntry {
  readonly region: RegionAttachment;
  readonly sized: Mat2x3;
}

// One slot's render binding. A slot gets a record (and a pooled sprite) when its SETUP attachment
// resolves to a region in the default skin; `regionsByName` holds every region attachment under the
// slot so an authored attachment swap (Phase 2+) can re-resolve the active geometry per frame with no
// structural change. The mutable fields are the per-frame resolved state the scene description reads.
interface AttachmentRecord {
  readonly slot: string;
  readonly slotIndex: number;
  readonly boneIndex: number;
  readonly sprite: Sprite;
  readonly regionsByName: ReadonlyMap<string, RegionEntry>;
  visible: boolean;
  attachment: string;
  width: number;
  height: number;
  tint: number;
  alpha: number;
  spriteWorld: Mat2x3;
}

// The cached, document-keyed scene structure: the solve pose plus the render bindings. Built once per
// document identity and reused across every frame, so a steady-state animated frame rebuilds nothing
// (TASK-1.10.5). A new document object (a different load, or a re-parse) invalidates the cache.
interface CachedScene {
  readonly document: SkeletonDocument;
  readonly pose: Pose;
  readonly boneRecords: readonly BoneRecord[];
  readonly attachmentRecords: readonly AttachmentRecord[];
}

// PixiJS view of a skeleton, at its setup pose (WP-0.5) or sampled at an animation time (WP-1.10). It
// owns a container tree and renders the world matrices and per-slot color/attachment that runtime-core
// solves into a reused pose. It does NOT solve: solving is runtime-core's job, rendering is the
// renderer's job (INV-1). The setup-pose render and the animated render share ONE render-from-pose path
// (renderFromPose) and ONE region-placement math (region-placement.ts), so the editor viewport, which
// reuses this view, cannot drift from the player (TASK-1.10.3).
export class SkeletonView {
  // The scene root the host mounts. Attachments render under bones so bone chrome stays visible.
  readonly root: Container;
  private readonly attachmentsLayer: Container;
  private readonly bonesLayer: Container;

  // Display objects reused across syncs, index-aligned with the current bone and attachment records.
  private readonly boneGraphics: Graphics[] = [];
  private readonly attachmentSprites: Sprite[] = [];

  // The document-keyed solve + render bindings, or null when nothing is mounted.
  private cached: CachedScene | null = null;

  // Reused scratch for reading a bone's world matrix out of the pose buffer to feed placeRegion, so the
  // per-frame attachment loop allocates only the region product (runtime-core's multiply), nothing else.
  private readonly boneWorldScratch: [number, number, number, number, number, number] = [
    0, 0, 0, 0, 0, 0,
  ];

  constructor() {
    this.root = new Container();
    this.attachmentsLayer = new Container();
    this.bonesLayer = new Container();
    this.root.addChild(this.attachmentsLayer, this.bonesLayer);
  }

  // Validate, solve, and render a document at its SETUP pose. The document is validated via
  // packages/format BEFORE any solve (validate-before-solve boundary): invalid input throws a typed
  // FormatValidationError and never reaches runtime-core, so the solve can trust the
  // parent-precedes-child ordering invariant. Hash verification is off by default because runtimes
  // treat `hash` as opaque (format-contract section 9.3); the editor verifies it on load. Reuses the
  // cached scene when the same document object is passed again; a re-parse of the same input is a new
  // document object and rebuilds (resizing the pools to the same counts is a no-op).
  sync(input: unknown, options?: ValidateOptions): void {
    // Default verifyHash to false (runtimes treat `hash` as opaque), but let an explicit option win
    // so a caller can opt back into verification without the empty-options object silently re-enabling
    // it (parseDocument's own default is true).
    const document = parseDocument(input, { verifyHash: options?.verifyHash ?? false });

    const scene = this.ensureScene(document);
    // Setup pose = solve steps 1 and 4 with the slots reset to their setup color/attachment, so
    // rendering from the pose yields the identical setup result the animated path would at a no-op key.
    resetToSetupPose(scene.pose);
    resetSlotsToSetup(scene.pose);
    computeWorldTransforms(scene.pose);

    this.renderFromPose(scene);
  }

  // Sample `animationId` at single-period time `t` (seconds, in [0, duration]; this method does NOT
  // wrap, the caller maps elapsed time, see syncAnimatedLoop / loopTime) into the cached pose, then
  // render from it. The document MUST already be validated (the player validates on load): per-frame
  // re-validation is not a sane cost, so this trusts the typed SkeletonDocument. The pose is built once
  // per document and reused, so a steady-state frame allocates only the region products (TASK-1.10.5).
  syncAnimated(document: SkeletonDocument, animationId: string, t: number): void {
    const scene = this.ensureScene(document);
    sampleSkeleton(document, animationId, t, scene.pose);
    this.renderFromPose(scene);
  }

  // Convenience for a looping player: fold elapsed playback time into one period of the animation and
  // render that frame. A thin wrapper over loopTime + syncAnimated that reads the authored duration; it
  // owns no clock (the caller supplies `elapsed` from its own transport, TASK-1.6.6), so it stays
  // deterministic and testable. Throws AnimationNotFoundError for an unknown id, matching sampleSkeleton.
  syncAnimatedLoop(document: SkeletonDocument, animationId: string, elapsed: number): void {
    const animation = document.animations[animationId];
    if (animation === undefined) throw new AnimationNotFoundError(animationId);
    this.syncAnimated(document, animationId, loopTime(elapsed, animation.duration));
  }

  // A read-only snapshot of the current scene for tests and tooling (no WebGL needed). Computed from
  // the cached pose and the per-frame-resolved record state, so it reflects the last rendered frame
  // (animated color/attachment included), not the document's setup values.
  describe(): SceneDescription {
    const scene = this.cached;
    if (scene === null) return { bones: [], attachments: [] };

    const world = scene.pose.world;
    const bones: BoneRender[] = [];
    for (const record of scene.boneRecords) {
      const base = record.boneIndex * MAT2X3_STRIDE;
      const transform = mapWorldToDisplay([
        world[base]!,
        world[base + 1]!,
        world[base + 2]!,
        world[base + 3]!,
        world[base + 4]!,
        world[base + 5]!,
      ]);
      bones.push({ name: record.name, length: record.length, transform });
    }

    const attachments: AttachmentRender[] = [];
    for (const record of scene.attachmentRecords) {
      if (!record.visible) continue;
      const transform = mapWorldToDisplay(record.spriteWorld);
      attachments.push({
        slot: record.slot,
        attachment: record.attachment,
        width: record.width,
        height: record.height,
        tint: record.tint,
        alpha: record.alpha,
        transform,
        worldPosition: [transform.x, transform.y],
      });
    }
    return { bones, attachments };
  }

  // Clear the scene to empty: release every bone graphic and attachment sprite (resize the pools to
  // zero), drop the cached scene, so the editor viewport can show an empty scene for a zero-bone
  // document. Unlike destroy(), the container tree and the view stay reusable: a later sync() rebuilds
  // the pools from scratch through the same resize path.
  clear(): void {
    this.resizeBones(0);
    this.resizeAttachments(0);
    this.cached = null;
  }

  // Tear down the container tree and release every display object.
  destroy(): void {
    this.root.destroy({ children: true });
    this.boneGraphics.length = 0;
    this.attachmentSprites.length = 0;
    this.cached = null;
  }

  // Return the cached scene for this document, or build (and cache) it. Building allocates the pose and
  // the render bindings and resizes the pools; it runs once per document identity. The structure (bone
  // diamonds, which slots show a region) is fixed here, so per-frame rendering only reapplies values.
  private ensureScene(document: SkeletonDocument): CachedScene {
    const existing = this.cached;
    if (existing !== null && existing.document === document) return existing;

    const pose = buildPose(document);
    const boneRecords = this.buildBoneRecords(document);
    const attachmentRecords = this.buildAttachmentRecords(document, pose);
    const scene: CachedScene = { document, pose, boneRecords, attachmentRecords };
    this.cached = scene;
    return scene;
  }

  private buildBoneRecords(document: SkeletonDocument): BoneRecord[] {
    const count = document.bones.length;
    this.resizeBones(count);

    const records: BoneRecord[] = [];
    for (let i = 0; i < count; i += 1) {
      const bone = document.bones[i]!;
      const graphics = this.boneGraphics[i]!;
      // Geometry is length-only and constant for the document, so draw it once here, not per frame.
      drawBone(graphics, bone.length);
      records.push({ name: bone.name, length: bone.length, boneIndex: i, graphics });
    }
    return records;
  }

  // Build one record (and pooled sprite) per slot whose SETUP attachment resolves to a region in the
  // default skin, in slot (draw) order. This is exactly the Phase-0 visible set, so the pool size and
  // ordering are unchanged. `regionsByName` captures every region attachment under the slot so a future
  // swap timeline can re-resolve geometry per frame without growing the pool; null or an unresolved
  // active name hides the sprite (renderFromPose). The document is validated, so references resolve.
  private buildAttachmentRecords(document: SkeletonDocument, pose: Pose): AttachmentRecord[] {
    const defaultSkin = findDefaultSkin(document);
    if (defaultSkin === undefined) {
      this.resizeAttachments(0);
      return [];
    }

    const drafts: Omit<AttachmentRecord, 'sprite'>[] = [];
    for (let slotIndex = 0; slotIndex < document.slots.length; slotIndex += 1) {
      const slot = document.slots[slotIndex]!;
      const boneIndex = pose.slotBoneIndices[slotIndex]!;
      if (boneIndex < 0) continue;

      const bySlot = defaultSkin.attachments[slot.name];
      if (bySlot === undefined || slot.attachment === null) continue;
      const setupAttachment = bySlot[slot.attachment];
      if (setupAttachment === undefined || setupAttachment.type !== 'region') continue;

      const regionsByName = new Map<string, RegionEntry>();
      for (const [name, attachment] of Object.entries(bySlot)) {
        if (attachment.type !== 'region') continue;
        regionsByName.set(name, { region: attachment, sized: computeRegionSized(attachment) });
      }

      drafts.push({
        slot: slot.name,
        slotIndex,
        boneIndex,
        regionsByName,
        visible: false,
        attachment: '',
        width: 0,
        height: 0,
        tint: 0xffffff,
        alpha: 1,
        spriteWorld: [1, 0, 0, 1, 0, 0],
      });
    }

    this.resizeAttachments(drafts.length);
    return drafts.map((draft, i) => ({ ...draft, sprite: this.attachmentSprites[i]! }));
  }

  // Render the cached scene from its pose: bone diamonds at their world transforms, then each slot's
  // attachment at its world transform with the resolved per-slot color and active attachment. The pose
  // already carries the solve output (setup or sampled); this method reads it and never solves. The
  // only per-frame allocation is the region product matrix from runtime-core's multiply (the affine
  // library exposes no in-place product to this layer); the pose, records, and display objects are all
  // reused.
  private renderFromPose(scene: CachedScene): void {
    const world = scene.pose.world;

    for (const record of scene.boneRecords) {
      const base = record.boneIndex * MAT2X3_STRIDE;
      applyWorldToTarget(
        record.graphics,
        world[base]!,
        world[base + 1]!,
        world[base + 2]!,
        world[base + 3]!,
        world[base + 4]!,
        world[base + 5]!,
      );
    }

    const slotColor = scene.pose.slotColor;
    const slotAttachment = scene.pose.slotAttachment;
    const scratch = this.boneWorldScratch;
    for (const record of scene.attachmentRecords) {
      const activeName = slotAttachment[record.slotIndex];
      const entry =
        activeName === null || activeName === undefined
          ? undefined
          : record.regionsByName.get(activeName);
      if (entry === undefined || activeName === null || activeName === undefined) {
        record.visible = false;
        record.sprite.visible = false;
        continue;
      }

      const region = entry.region;
      const colorBase = record.slotIndex * SLOT_COLOR_STRIDE;
      const tint = packTint(
        slotColor[colorBase]! * region.color.r,
        slotColor[colorBase + 1]! * region.color.g,
        slotColor[colorBase + 2]! * region.color.b,
      );
      const alpha = slotColor[colorBase + 3]! * region.color.a;

      const boneBase = record.boneIndex * MAT2X3_STRIDE;
      scratch[0] = world[boneBase]!;
      scratch[1] = world[boneBase + 1]!;
      scratch[2] = world[boneBase + 2]!;
      scratch[3] = world[boneBase + 3]!;
      scratch[4] = world[boneBase + 4]!;
      scratch[5] = world[boneBase + 5]!;
      const spriteWorld = placeRegion(scratch, entry.sized);

      const sprite = record.sprite;
      sprite.visible = true;
      applyWorldToTarget(
        sprite,
        spriteWorld[0],
        spriteWorld[1],
        spriteWorld[2],
        spriteWorld[3],
        spriteWorld[4],
        spriteWorld[5],
      );
      sprite.tint = tint;
      sprite.alpha = alpha;

      record.visible = true;
      record.attachment = activeName;
      record.width = region.width;
      record.height = region.height;
      record.tint = tint;
      record.alpha = alpha;
      record.spriteWorld = spriteWorld;
    }
  }

  // Grow or shrink the pooled bone graphics to exactly `count`, adding to / removing from the layer.
  // Reuse means a repeated sync with the same structure creates no new display objects.
  private resizeBones(count: number): void {
    while (this.boneGraphics.length < count) {
      const graphics = new Graphics();
      this.boneGraphics.push(graphics);
      this.bonesLayer.addChild(graphics);
    }
    while (this.boneGraphics.length > count) {
      const graphics = this.boneGraphics.pop()!;
      this.bonesLayer.removeChild(graphics);
      graphics.destroy();
    }
  }

  private resizeAttachments(count: number): void {
    while (this.attachmentSprites.length < count) {
      const sprite = createAttachmentSprite();
      this.attachmentSprites.push(sprite);
      this.attachmentsLayer.addChild(sprite);
    }
    while (this.attachmentSprites.length > count) {
      const sprite = this.attachmentSprites.pop()!;
      this.attachmentsLayer.removeChild(sprite);
      sprite.destroy();
    }
  }
}

// Reset every slot's resolved color to its setup color and its active attachment to its setup name, so
// the setup-pose render reads the same pose fields the animated render does. This mirrors runtime-core's
// internal slot reset (sample.ts); it is a setup-snapshot copy, NOT solve math (no curves, no affine),
// and lives here because runtime-core does not export that internal. Allocation-free: the typed-array
// copy reuses slotColor and the name loop writes string refs in place.
function resetSlotsToSetup(pose: Pose): void {
  pose.slotColor.set(pose.slotSetupColor);
  for (let i = 0; i < pose.slotCount; i += 1) {
    pose.slotAttachment[i] = pose.slotSetupAttachment[i] ?? null;
  }
}

function findDefaultSkin(document: SkeletonDocument): Skin | undefined {
  return document.skins.find((skin) => skin.name === 'default');
}
