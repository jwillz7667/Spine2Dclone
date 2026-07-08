import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { parseDocument, type ValidateOptions } from '@marionette/format';
import type { AtlasRegion, RegionAttachment, SkeletonDocument, Skin } from '@marionette/format/types';
import {
  AnimationNotFoundError,
  applyAnimationState,
  buildPose,
  computeWorldTransforms,
  getTrackEntry,
  MAT2X3_STRIDE,
  resetToSetupPose,
  sampleMeshVertices,
  sampleSkeleton,
  skinMeshInto,
  SLOT_COLOR_STRIDE,
  type AnimationState,
  type Mat2x3,
  type Pose,
} from '@marionette/runtime-core';
import { applyWorldToTarget, mapWorldToDisplay, type DisplayTransform } from './map-transform';
import { drawBone } from './bone-graphics';
import { blendModeToPixi } from './blend-mode';
import {
  createAttachmentSprite,
  packTint,
  sizeForTexture,
  type RegionTrim,
} from './attachment-sprites';
import { createMeshDisplay, markMeshPositionsDirty, type MeshDisplay } from './mesh-display';
import { computeRegionSized, placeRegion } from './region-placement';
import type { RegionTextureResolver } from './region-textures';
import { loopTime } from '../transport';

// The one skin the view renders (skin switching is a later Phase 2 authoring surface; the solve and the
// records resolve attachments through this name, matching the headless parity sampler).
const DEFAULT_SKIN_NAME = 'default';

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

// The headless snapshot of one rendered MESH attachment (WP-2.11 renderer slice). `vertices` is a copy
// of the final world-space position lanes the geometry buffer holds ([x0, y0, x1, y1, ...]), which is
// exactly the runtime-core solve output (skinned, plus deform when animated), so tests can assert the
// rendered geometry against a direct sampleMeshVertices call without a WebGL context.
export interface MeshRender {
  readonly slot: string;
  readonly attachment: string;
  readonly vertexCount: number;
  readonly tint: number; // 0xRRGGBB
  readonly alpha: number;
  readonly vertices: readonly number[];
}

export interface SceneDescription {
  readonly bones: readonly BoneRender[];
  readonly attachments: readonly AttachmentRender[];
  readonly meshes: readonly MeshRender[];
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

// A region attachment resolved to the texture that fills it and its constant sprite-sizing matrix.
// `texture` is the host-resolved atlas Texture, or null when none is available (the sprite then shows
// Texture.WHITE as a placeholder). `sizedForSprite` is computeRegionSized normalized by the texture's
// pixel size (handoff 8.9, sizeForTexture), so the sprite draws its texture into the authored width x
// height world quad regardless of the texture's dimensions. Both are constant per scene, so they are
// computed ONCE at scene build; the per-frame loop only multiplies the bone world by `sizedForSprite`.
interface RegionEntry {
  readonly region: RegionAttachment;
  readonly texture: Texture | null;
  readonly sizedForSprite: Mat2x3;
}

// One slot's render binding. A slot gets a record when its SETUP attachment resolves to a region OR a
// mesh in the default skin; `regionsByName` and `meshesByName` hold every region / mesh attachment
// under the slot so an authored attachment swap can re-resolve the active geometry per frame with no
// structural change (including a region-to-mesh swap: the sprite and the mesh displays coexist, one
// visible at a time). The pooled sprite serves the region path; each mesh attachment owns its scene-built
// Mesh display (mesh-display.ts). `activeMesh` tracks the currently shown mesh so swapping away hides it
// in O(1) without iterating the map per frame. The mutable fields are the per-frame resolved state the
// scene description reads; `kind` says which lane (attachments or meshes) the record renders into.
interface AttachmentRecord {
  readonly slot: string;
  readonly slotIndex: number;
  readonly boneIndex: number;
  readonly sprite: Sprite;
  readonly regionsByName: ReadonlyMap<string, RegionEntry>;
  readonly meshesByName: ReadonlyMap<string, MeshDisplay>;
  activeMesh: MeshDisplay | null;
  kind: 'region' | 'mesh';
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

  // The current scene's mesh displays (flat, for teardown). Unlike the sprite pool these are built per
  // scene, because a mesh's geometry (uvs, triangles, vertex count) is document-specific; the per-frame
  // path only writes into their position buffers, so scene-build-time construction still satisfies the
  // no-per-frame-allocation rule.
  private readonly meshDisplays: MeshDisplay[] = [];

  // The document-keyed solve + render bindings, or null when nothing is mounted.
  private cached: CachedScene | null = null;

  // The host-injected region -> Texture resolver, or null for the placeholder (Texture.WHITE) behavior.
  // Region textures are bound at scene build, so changing the resolver invalidates the cached scene.
  private resolver: RegionTextureResolver | null = null;

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

  // Inject (or clear) the host's region -> Texture resolver. Region textures are resolved once when the
  // scene is built, so this invalidates the cached scene: the next sync / syncAnimated rebuilds the
  // attachment bindings against the new resolver (re-slicing nothing, just re-binding textures and
  // recomputing each region's size normalization). Passing null restores the placeholder (Texture.WHITE)
  // behavior. The view does NOT auto-re-render; the host re-syncs to repaint, matching how a document
  // change repaints. This never destroys host textures (the host owns the atlas page sources).
  setTextureResolver(resolver: RegionTextureResolver | null): void {
    this.resolver = resolver;
    this.cached = null;
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

    // No animation context: meshes render as the pure skin of the setup pose (deform is a timeline
    // concept and is zero at setup by definition).
    this.renderFromPose(scene, null, 0);
  }

  // Sample `animationId` at single-period time `t` (seconds, in [0, duration]; this method does NOT
  // wrap, the caller maps elapsed time, see syncAnimatedLoop / loopTime) into the cached pose, then
  // render from it. The document MUST already be validated (the player validates on load): per-frame
  // re-validation is not a sane cost, so this trusts the typed SkeletonDocument. The pose is built once
  // per document and reused, so a steady-state frame allocates only the region products (TASK-1.10.5).
  syncAnimated(document: SkeletonDocument, animationId: string, t: number): void {
    const scene = this.ensureScene(document);
    sampleSkeleton(document, animationId, t, scene.pose);
    this.renderFromPose(scene, animationId, t);
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

  // Solve and render a multi-track AnimationState (ADR-0005) through the SAME render-from-pose path the
  // single-animation player uses. applyAnimationState runs the locked solve with a blended step 2 into the
  // cached pose (bones, slot color, discrete attachments), then renderFromPose draws it. `document` MUST be
  // the same validated document the state was built from (state.document); the view trusts it, exactly as
  // syncAnimated does. The pose is built once per document and reused, so a steady-state frame allocates
  // only the region products.
  //
  // Mesh DEFORM scoping (v1): ADR-0005 does not define cross-track deform blending, so deform under
  // AnimationState is sampled from the TRACK-0 current entry's animation and trackTime ONLY (the base
  // layer), on top of the state-solved skin. A crossfade on track 0 uses its incoming (current) entry.
  // When track 0 is empty, meshes render as the pure skin of the state-solved pose (no deform). This is a
  // deliberate, documented scope, NOT invented cross-track deform math.
  syncState(document: SkeletonDocument, state: AnimationState): void {
    const scene = this.ensureScene(document);
    applyAnimationState(state, scene.pose);
    const track0 = getTrackEntry(state, 0);
    if (track0 === null) {
      this.renderFromPose(scene, null, 0);
    } else {
      this.renderFromPose(scene, track0.animationId, track0.trackTime);
    }
  }

  // A read-only snapshot of the current scene for tests and tooling (no WebGL needed). Computed from
  // the cached pose and the per-frame-resolved record state, so it reflects the last rendered frame
  // (animated color/attachment included), not the document's setup values.
  describe(): SceneDescription {
    const scene = this.cached;
    if (scene === null) return { bones: [], attachments: [], meshes: [] };

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
    const meshes: MeshRender[] = [];
    for (const record of scene.attachmentRecords) {
      if (!record.visible) continue;
      if (record.kind === 'mesh') {
        const active = record.activeMesh!;
        meshes.push({
          slot: record.slot,
          attachment: record.attachment,
          vertexCount: active.vertexCount,
          tint: record.tint,
          alpha: record.alpha,
          vertices: Array.from(active.positions),
        });
        continue;
      }
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
    return { bones, attachments, meshes };
  }

  // Clear the scene to empty: release every bone graphic and attachment sprite (resize the pools to
  // zero), drop the cached scene, so the editor viewport can show an empty scene for a zero-bone
  // document. Unlike destroy(), the container tree and the view stay reusable: a later sync() rebuilds
  // the pools from scratch through the same resize path.
  clear(): void {
    this.resizeBones(0);
    this.resizeAttachments(0);
    this.releaseMeshDisplays();
    this.cached = null;
  }

  // Tear down the container tree and release every display object. Mesh geometries are released first
  // (we own their buffers; root.destroy would drop the displays but not the geometry).
  destroy(): void {
    this.releaseMeshDisplays();
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

  // Build one record (and pooled sprite) per slot whose SETUP attachment resolves to a region or a mesh
  // in the default skin, in slot (draw) order. `regionsByName` and `meshesByName` capture every region /
  // mesh attachment under the slot so a swap timeline can re-resolve the active geometry per frame
  // without any structural change; null or an unresolved active name hides the slot (renderFromPose).
  // The document is validated, so references resolve. After the sprite pool is sized, the layer children
  // are re-appended in record order, each slot's sprite and mesh displays adjacent, so the layer's child
  // order IS the draw order whichever kind a slot currently shows.
  private buildAttachmentRecords(document: SkeletonDocument, pose: Pose): AttachmentRecord[] {
    this.releaseMeshDisplays();
    const defaultSkin = findDefaultSkin(document);
    if (defaultSkin === undefined) {
      this.resizeAttachments(0);
      return [];
    }

    // Region-name -> AtlasRegion, so a region attachment can read its trim (PP-C1) off the document atlas
    // (the resolver hands back only a Texture, never the trim). Built once per scene, not per attachment.
    const atlasRegions = buildAtlasRegionIndex(document);

    const drafts: Omit<AttachmentRecord, 'sprite'>[] = [];
    for (let slotIndex = 0; slotIndex < document.slots.length; slotIndex += 1) {
      const slot = document.slots[slotIndex]!;
      const boneIndex = pose.slotBoneIndices[slotIndex]!;
      if (boneIndex < 0) continue;

      const bySlot = defaultSkin.attachments[slot.name];
      if (bySlot === undefined || slot.attachment === null) continue;
      const setupAttachment = bySlot[slot.attachment];
      if (
        setupAttachment === undefined ||
        (setupAttachment.type !== 'region' && setupAttachment.type !== 'mesh')
      ) {
        continue;
      }

      const regionsByName = new Map<string, RegionEntry>();
      const meshesByName = new Map<string, MeshDisplay>();
      for (const [name, attachment] of Object.entries(bySlot)) {
        if (attachment.type === 'region') {
          // Resolve the region's texture now (constant per scene). Normalize the unit-quad sizing by the
          // ACTUAL texture dimensions, using Texture.WHITE's dimensions when there is no resolved texture,
          // so the placeholder and a real texture land the quad in the same world place (handoff 8.9). A
          // trimmed region (PP-C1) additionally offsets the quad to where its untrimmed original sat; the
          // trim comes from the document atlas (undefined for an untrimmed region, keeping that path
          // byte-identical). For a rotated texture, texture.width/height report the LOGICAL (unrotated)
          // size PixiJS's rotate=2 reconstructs, so the trim math is orientation-independent here.
          const texture = this.resolver?.(attachment.path) ?? null;
          const source = texture ?? Texture.WHITE;
          const trim = regionTrimFor(atlasRegions.get(attachment.path));
          const sizedForSprite = sizeForTexture(
            computeRegionSized(attachment),
            source.width,
            source.height,
            trim,
          );
          regionsByName.set(name, { region: attachment, texture, sizedForSprite });
        } else if (attachment.type === 'mesh') {
          const entry = createMeshDisplay(attachment, this.resolver?.(attachment.path) ?? null);
          meshesByName.set(name, entry);
          this.meshDisplays.push(entry);
        }
      }

      drafts.push({
        slot: slot.name,
        slotIndex,
        boneIndex,
        regionsByName,
        meshesByName,
        activeMesh: null,
        kind: 'region',
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
    const records = drafts.map((draft, i) => ({ ...draft, sprite: this.attachmentSprites[i]! }));

    // Re-append in draw order (addChild moves an existing child to the end, so this is a pure reorder),
    // and stamp the slot's blend mode onto its displays. Blend mode is per-slot document state (not
    // animatable in this format version), so build time is the one place it is assigned; the mapping is
    // the same blendModeToPixi the particle renderer uses (phase-3 section 7.4: no second blend path).
    // Sprites are pooled across documents, so the assignment must not be skipped on rebuild.
    for (const record of records) {
      const pixiBlend = blendModeToPixi(document.slots[record.slotIndex]!.blendMode);
      record.sprite.blendMode = pixiBlend;
      this.attachmentsLayer.addChild(record.sprite);
      for (const entry of record.meshesByName.values()) {
        entry.display.blendMode = pixiBlend;
        this.attachmentsLayer.addChild(entry.display);
      }
    }
    return records;
  }

  // Render the cached scene from its pose: bone diamonds at their world transforms, then each slot's
  // attachment with the resolved per-slot color and active attachment: a region as its sprite at the
  // bone world transform, a mesh as its display with the solve's world-space vertices written into the
  // geometry's position buffer in place (solve-order steps 5 and 6). The pose already carries the
  // skeleton solve output (setup or sampled); the mesh vertex solve runs here through the SAME public
  // runtime-core symbols the parity harness asserts (skinMeshInto at setup, sampleMeshVertices when
  // animated), so what the renderer draws is by construction the parity-tested output. `animationId`
  // null means setup pose (skin only; deform is zero at setup). The only per-frame allocation is the
  // region product matrix from runtime-core's multiply (the affine library exposes no in-place product
  // to this layer); the pose, records, display objects, and mesh position buffers are all reused.
  private renderFromPose(scene: CachedScene, animationId: string | null, t: number): void {
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
      const meshEntry =
        entry !== undefined || activeName === null || activeName === undefined
          ? undefined
          : record.meshesByName.get(activeName);

      // Swapping away from a mesh (to a region, another mesh, or nothing) hides the old display in O(1).
      if (record.activeMesh !== null && record.activeMesh !== meshEntry) {
        record.activeMesh.display.visible = false;
        record.activeMesh = null;
      }

      if (meshEntry !== undefined && activeName !== null && activeName !== undefined) {
        this.renderMesh(scene, record, meshEntry, activeName, animationId, t);
        continue;
      }

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
      // sizedForSprite is sized * scale(1/texW, 1/texH), so this single multiply (the only per-frame
      // allocation, unchanged from the placeholder path) lands the texture in the same world quad the
      // unit-quad placeholder occupied. The size normalization was precomputed at scene build.
      const spriteWorld = placeRegion(scratch, entry.sizedForSprite);

      const sprite = record.sprite;
      sprite.visible = true;
      // Bind the resolved texture, or Texture.WHITE when the region has none (resolver null / not loaded).
      // Pixi's texture setter early-returns when the value is unchanged, so a steady-state frame (the same
      // active attachment) does no work and allocates nothing here.
      sprite.texture = entry.texture ?? Texture.WHITE;
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

      record.kind = 'region';
      record.visible = true;
      record.attachment = activeName;
      record.width = region.width;
      record.height = region.height;
      record.tint = tint;
      record.alpha = alpha;
      record.spriteWorld = spriteWorld;
    }
  }

  // Render one slot's active MESH attachment: solve its world-space vertices into the geometry's own
  // position buffer (in place, zero allocation), mark the buffer dirty, and apply the slot-times-mesh
  // color. Setup pose (animationId null) is the pure skin of the current bone worlds; an animated frame
  // adds the sampled deform on top via sampleMeshVertices, the exact call site the WP-2.11 parity test
  // asserts against. The mesh display's local transform stays identity: the vertices ARE world space.
  private renderMesh(
    scene: CachedScene,
    record: AttachmentRecord,
    entry: MeshDisplay,
    activeName: string,
    animationId: string | null,
    t: number,
  ): void {
    if (animationId === null) {
      skinMeshInto(entry.mesh, scene.pose, record.boneIndex, entry.positions);
    } else {
      sampleMeshVertices(
        scene.document,
        animationId,
        t,
        scene.pose,
        DEFAULT_SKIN_NAME,
        record.slot,
        activeName,
        entry.positions,
      );
    }
    markMeshPositionsDirty(entry);

    const slotColor = scene.pose.slotColor;
    const colorBase = record.slotIndex * SLOT_COLOR_STRIDE;
    const meshColor = entry.mesh.color;
    const tint = packTint(
      slotColor[colorBase]! * meshColor.r,
      slotColor[colorBase + 1]! * meshColor.g,
      slotColor[colorBase + 2]! * meshColor.b,
    );
    const alpha = slotColor[colorBase + 3]! * meshColor.a;

    record.sprite.visible = false;
    entry.display.visible = true;
    entry.display.tint = tint;
    entry.display.alpha = alpha;
    record.activeMesh = entry;

    record.kind = 'mesh';
    record.visible = true;
    record.attachment = activeName;
    record.width = entry.mesh.width;
    record.height = entry.mesh.height;
    record.tint = tint;
    record.alpha = alpha;
  }

  // Remove and destroy the current scene's mesh displays (scene teardown / rebuild). The geometry is
  // ours (its buffers were built in createMeshDisplay), so it is destroyed explicitly; the texture is a
  // view over the host's atlas page and is never destroyed here (region-textures.ts lifecycle).
  private releaseMeshDisplays(): void {
    for (const entry of this.meshDisplays) {
      const geometry = entry.display.geometry;
      this.attachmentsLayer.removeChild(entry.display);
      entry.display.destroy();
      geometry.destroy(true);
    }
    this.meshDisplays.length = 0;
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

// Index the document atlas by region name so a region attachment can look up its trim by path. Region
// names are unique across pages (format invariant ATLAS_REGION_DUPLICATE), so the flat map cannot collide.
function buildAtlasRegionIndex(document: SkeletonDocument): Map<string, AtlasRegion> {
  const index = new Map<string, AtlasRegion>();
  for (const page of document.atlas.pages) {
    for (const region of page.regions) index.set(region.name, region);
  }
  return index;
}

// The placement trim for an AtlasRegion, or undefined when the region is absent OR untrimmed (offset 0 and
// packed == original). Returning undefined for the untrimmed case keeps the sprite-sizing path exactly the
// pre-trim scale(1/texW, 1/texH), so untrimmed regions render byte-identically to before.
function regionTrimFor(region: AtlasRegion | undefined): RegionTrim | undefined {
  if (region === undefined) return undefined;
  const { offsetX, offsetY, w, h, originalW, originalH } = region;
  if (offsetX === 0 && offsetY === 0 && w === originalW && h === originalH) return undefined;
  return { offsetX, offsetY, w, h, originalW, originalH };
}
