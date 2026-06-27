import { Container, Graphics, Sprite } from 'pixi.js';
import { parseDocument, type ValidateOptions } from '@marionette/format';
import type { RGBA, RegionAttachment, SkeletonDocument, Skin } from '@marionette/format/types';
import {
  buildPose,
  compose,
  computeWorldTransforms,
  MAT2X3_STRIDE,
  multiply,
  resetToSetupPose,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { mapWorldToDisplay, type DisplayTransform } from './map-transform';
import { drawBone } from './bone-graphics';
import { applyAttachmentSprite, createAttachmentSprite, packTint } from './attachment-sprites';

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

// A region attachment resolved to its driving bone for one sync, in draw order (slot order).
interface VisibleRegion {
  readonly slot: string;
  readonly attachment: string;
  readonly region: RegionAttachment;
  readonly boneIndex: number;
  readonly slotColor: RGBA;
}

// PixiJS view of a skeleton at its setup pose (phase-0-foundations.md WP-0.5). It owns a container
// tree, validates and solves an incoming document, and maps the solved world matrices onto bone
// diamonds and region sprites. It does NOT solve: solving is runtime-core's job, rendering is the
// renderer's job (INV-1). The same view powers the editor viewport (WP-0.6), the project's largest
// leverage point. No animation: the pose is steps 1 and 4 only (reset, world transforms).
export class SkeletonView {
  // The scene root the host mounts. Attachments render under bones so bone chrome stays visible.
  readonly root: Container;
  private readonly attachmentsLayer: Container;
  private readonly bonesLayer: Container;

  // Display objects reused across syncs, index-aligned with the current bone and visible-region lists.
  private readonly boneGraphics: Graphics[] = [];
  private readonly attachmentSprites: Sprite[] = [];

  private boneRenders: BoneRender[] = [];
  private attachmentRenders: AttachmentRender[] = [];

  constructor() {
    this.root = new Container();
    this.attachmentsLayer = new Container();
    this.bonesLayer = new Container();
    this.root.addChild(this.attachmentsLayer, this.bonesLayer);
  }

  // Validate, solve, and render a document at its setup pose. The document is validated via
  // packages/format BEFORE any solve (validate-before-solve boundary): invalid input throws a typed
  // FormatValidationError and never reaches runtime-core, so the solve can trust the
  // parent-precedes-child ordering invariant. Hash verification is off by default because runtimes
  // treat `hash` as opaque (format-contract section 9.3); the editor verifies it on load. Reuses
  // existing display objects in place when the bone and region counts are unchanged.
  sync(input: unknown, options?: ValidateOptions): void {
    // Default verifyHash to false (runtimes treat `hash` as opaque), but let an explicit option win
    // so a caller can opt back into verification without the empty-options object silently re-enabling
    // it (parseDocument's own default is true).
    const document = parseDocument(input, { verifyHash: options?.verifyHash ?? false });

    const pose = buildPose(document);
    resetToSetupPose(pose);
    computeWorldTransforms(pose);

    this.syncBones(document, pose);
    this.syncAttachments(document, pose);
  }

  // A read-only snapshot of the current scene for tests and tooling (no WebGL needed).
  describe(): SceneDescription {
    return { bones: [...this.boneRenders], attachments: [...this.attachmentRenders] };
  }

  // Clear the scene to empty: release every bone graphic and attachment sprite (resize the pools to
  // zero) and drop the description records, so the editor viewport can show an empty scene for a
  // zero-bone document. Unlike destroy(), the container tree and the view stay reusable: a later
  // sync() rebuilds the pools from scratch through the same resize path.
  clear(): void {
    this.resizeBones(0);
    this.resizeAttachments(0);
    this.boneRenders = [];
    this.attachmentRenders = [];
  }

  // Tear down the container tree and release every display object.
  destroy(): void {
    this.root.destroy({ children: true });
    this.boneGraphics.length = 0;
    this.attachmentSprites.length = 0;
    this.boneRenders = [];
    this.attachmentRenders = [];
  }

  private syncBones(document: SkeletonDocument, pose: Pose): void {
    const count = document.bones.length;
    this.resizeBones(count);

    const renders: BoneRender[] = [];
    for (let i = 0; i < count; i += 1) {
      const bone = document.bones[i]!;
      const transform = mapWorldToDisplay(worldMatrix(pose, i));
      const graphics = this.boneGraphics[i]!;
      applyDisplayTransform(graphics, transform);
      drawBone(graphics, bone.length);
      renders.push({ name: bone.name, length: bone.length, transform });
    }
    this.boneRenders = renders;
  }

  private syncAttachments(document: SkeletonDocument, pose: Pose): void {
    const visible = collectVisibleRegions(document, poseIndexByName(pose));
    this.resizeAttachments(visible.length);

    const renders: AttachmentRender[] = [];
    for (let i = 0; i < visible.length; i += 1) {
      const item = visible[i]!;
      const region = item.region;

      // spriteWorld = boneWorld * attachmentLocal * scale(width, height). The size scale is innermost
      // so the 1x1 centered texture becomes a width-by-height quad in attachment-local axes before the
      // attachment offset and the bone world transform are applied (the Spine region convention).
      const attachmentLocal = compose(
        region.x,
        region.y,
        region.rotation,
        region.scaleX,
        region.scaleY,
        0,
        0,
      );
      const sized = multiply(attachmentLocal, [region.width, 0, 0, region.height, 0, 0]);
      const spriteWorld = multiply(worldMatrix(pose, item.boneIndex), sized);
      const transform = mapWorldToDisplay(spriteWorld);

      const tint = packTint(
        item.slotColor.r * region.color.r,
        item.slotColor.g * region.color.g,
        item.slotColor.b * region.color.b,
      );
      const alpha = item.slotColor.a * region.color.a;

      applyAttachmentSprite(this.attachmentSprites[i]!, transform, tint, alpha);
      renders.push({
        slot: item.slot,
        attachment: item.attachment,
        width: region.width,
        height: region.height,
        tint,
        alpha,
        transform,
        worldPosition: [transform.x, transform.y],
      });
    }
    this.attachmentRenders = renders;
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

// Read a solved bone world matrix out of the packed pose buffer as a Mat2x3 tuple.
function worldMatrix(pose: Pose, boneIndex: number): Mat2x3 {
  const base = boneIndex * MAT2X3_STRIDE;
  const w = pose.world;
  return [w[base]!, w[base + 1]!, w[base + 2]!, w[base + 3]!, w[base + 4]!, w[base + 5]!];
}

function poseIndexByName(pose: Pose): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < pose.boneCount; i += 1) {
    index.set(pose.boneNames[i]!, i);
  }
  return index;
}

// Resolve the slots that show a region attachment in setup pose, in slot (draw) order. A slot shows
// its setup attachment when `slot.attachment` is set and that name resolves to a region attachment in
// the default skin. Non-region kinds (mesh, clipping, point, boundingbox) are not rendered in Phase 0.
// The document is already validated, so every reference resolves; the guards are defensive only.
function collectVisibleRegions(
  document: SkeletonDocument,
  boneIndexByName: ReadonlyMap<string, number>,
): VisibleRegion[] {
  const defaultSkin = findDefaultSkin(document);
  if (defaultSkin === undefined) return [];

  const visible: VisibleRegion[] = [];
  for (const slot of document.slots) {
    if (slot.attachment === null) continue;
    const region = defaultSkin.attachments[slot.name]?.[slot.attachment];
    if (region === undefined || region.type !== 'region') continue;
    const boneIndex = boneIndexByName.get(slot.bone);
    if (boneIndex === undefined) continue;
    visible.push({
      slot: slot.name,
      attachment: slot.attachment,
      region,
      boneIndex,
      slotColor: slot.color,
    });
  }
  return visible;
}

function findDefaultSkin(document: SkeletonDocument): Skin | undefined {
  return document.skins.find((skin) => skin.name === 'default');
}

function applyDisplayTransform(target: Container, transform: DisplayTransform): void {
  target.position.set(transform.x, transform.y);
  target.rotation = transform.rotation;
  target.scale.set(transform.scaleX, transform.scaleY);
  target.skew.set(transform.skewX, transform.skewY);
}
