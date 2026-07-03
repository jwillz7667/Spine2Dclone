import { parseDocument, type ValidateOptions } from '@marionette/format';
import { parseEffectsDocument, type ValidateEffectsOptions } from '@marionette/format/effects';
import type { EffectsDocument } from '@marionette/format/effects-types';
import {
  EffectSystem,
  type BoneAnchorResolver,
  type EffectAnchor,
  type ReadonlyEffectFrame,
} from '@marionette/runtime-core';
import { AtlasIndex, type AtlasPixelSource } from './atlas';
import { TRANSPARENT, type Color } from './color';
import { gatherDrawItems } from './draw-items';
import { buildLayerOrder, gatherEffectDrawItems, type EffectDrawItem } from './effect-draw-items';
import { EffectTriggerError } from './errors';
import { encodePng } from './png';
import { Framebuffer, rasterizeTriangle, type RasterTriangle } from './raster';
import { rasterizeWorldItem } from './raster-items';
import {
  projectX,
  projectY,
  resolveWorldToImage,
  WorldBounds,
  type Viewport,
  type WorldToImage,
} from './viewport';
import type { RenderFrameResult } from './render-frame';

// renderEffectFrame + renderComposedFrame (ADR-0006 scope extension): render a particle EFFECT or BUNDLE
// frame, and a composed skeleton+effect frame, through the SAME deterministic CPU rasterizer skeleton
// documents use. The effects SOLVE stays 100% in runtime-core: we construct an EffectSystem, trigger by
// name with a seed, step it deterministically from 0 to `time` at the effect's simulationDt (exactly like
// the phase-3 acceptance harness), and READ readState() -- no emission/motion math is re-implemented here.

// The default role a single-effect trigger reads its anchor from (bundles resolve every item's anchorRole
// from the same map). Absent -> the world origin, matching bundle expansion's fallback.
const DEFAULT_ANCHOR_ROLE = 'default';
// The skeleton instance id a bone anchor input defaults to (the resolver keys on it; a single previewed
// skeleton needs no explicit id).
const DEFAULT_SKELETON_INSTANCE_ID = 'skeleton';

// How a caller places an effect/bundle anchor. The documented default is a world-space point {x, y}
// (rotation optional); a `bone` input resolves against options.resolveBone each frame, so a bone-anchored
// ribbon or emitter can be previewed as the bone moves (the phase-3 acceptance bone-anchor path).
export type EffectAnchorInput =
  | { readonly x: number; readonly y: number; readonly rotation?: number }
  | { readonly bone: string; readonly skeletonInstanceId?: string };

// The by-name trigger for a rendered effect frame. Exactly one of `effect` / `bundle` is required. `seed`
// drives the deterministic solve (a deterministic effect uses it; an ambient effect ignores it). `anchors`
// maps a role name to a world/bone anchor; a single effect reads the `default` role, a bundle resolves
// each item's anchorRole.
export interface EffectFrameTrigger {
  readonly effect?: string;
  readonly bundle?: string;
  readonly seed: number;
  readonly anchors?: Readonly<Record<string, EffectAnchorInput>>;
}

export interface RenderEffectFrameOptions {
  // The effects document to render, validated internally via packages/format's effects validator (the
  // validate-before-solve boundary, same posture as renderFrame): invalid input throws a typed
  // EffectsValidationError before any solve.
  readonly effectsDocument: unknown;
  readonly trigger: EffectFrameTrigger;
  // The time (seconds) to render at. The system steps from 0 to `time` at the effect's simulationDt.
  readonly time: number;
  // Decoded atlas page pixels for the effects document's own atlas, keyed by AtlasPage.file (same shape
  // renderFrame takes).
  readonly atlas: AtlasPixelSource;
  readonly viewport: Viewport;
  readonly background?: Color;
  // Resolves a `bone` anchor input to a current-frame world transform each frame (the runtime-core
  // BoneAnchorResolver). Optional; without it a bone anchor falls back to identity (a static ribbon).
  readonly resolveBone?: BoneAnchorResolver;
  // verifyHash defaults to false (runtimes treat `hash` as opaque; matches renderFrame).
  readonly validate?: ValidateEffectsOptions;
}

// A composed frame: a skeleton frame (the existing pipeline) with an effects overlay drawn AFTER it into
// the SAME framebuffer, so a big-win moment (scene + coin shower) is one PNG. Skeleton and effects carry
// their own document + atlas; the viewport/background/framebuffer are shared.
export interface RenderComposedFrameOptions {
  readonly skeleton: {
    readonly document: unknown;
    readonly animation?: string;
    readonly time?: number;
    readonly atlas: AtlasPixelSource;
    readonly validate?: ValidateOptions;
  };
  readonly effect: {
    readonly effectsDocument: unknown;
    readonly trigger: EffectFrameTrigger;
    readonly time: number;
    readonly atlas: AtlasPixelSource;
    readonly resolveBone?: BoneAnchorResolver;
    readonly validate?: ValidateEffectsOptions;
  };
  readonly viewport: Viewport;
  readonly background?: Color;
}

// Convert an anchor input to a runtime-core EffectAnchor (world or bone).
function resolveAnchorInput(input: EffectAnchorInput): EffectAnchor {
  if ('bone' in input) {
    return {
      space: 'bone',
      skeletonInstanceId: input.skeletonInstanceId ?? DEFAULT_SKELETON_INSTANCE_ID,
      pointOrBone: input.bone,
    };
  }
  return { space: 'world', x: input.x, y: input.y, rotation: input.rotation ?? 0 };
}

const WORLD_ORIGIN_ANCHOR: EffectAnchor = { space: 'world', x: 0, y: 0, rotation: 0 };

// Build the runtime-core anchors map (role -> EffectAnchor) from the trigger inputs.
function resolveAnchorsMap(
  anchors: Readonly<Record<string, EffectAnchorInput>> | undefined,
): Record<string, EffectAnchor> {
  const map: Record<string, EffectAnchor> = {};
  if (anchors === undefined) return map;
  for (const role of Object.keys(anchors)) {
    map[role] = resolveAnchorInput(anchors[role]!);
  }
  return map;
}

// The fixed sub-step dt the frame is advanced at. A single effect steps at its own simulationDt (one
// sub-step per frame, exactly like the acceptance harness). A bundle steps at the SMALLEST simulationDt
// among its referenced effects, so no instance's fixed-dt accumulator can skip a sub-step (EffectSystem
// subdivides each frame per instance dt). Both cases are validated (simulationDt > 0) before we get here.
function computeStepDt(doc: EffectsDocument, trigger: EffectFrameTrigger): number {
  if (trigger.effect !== undefined) {
    return doc.effects[trigger.effect]!.simulationDt;
  }
  const bundle = doc.bundles[trigger.bundle!]!;
  let dt = Number.POSITIVE_INFINITY;
  for (const item of bundle.items) {
    const config = doc.effects[item.effect];
    if (config !== undefined && config.simulationDt < dt) dt = config.simulationDt;
  }
  return Number.isFinite(dt) ? dt : doc.effects[Object.keys(doc.effects)[0]!]!.simulationDt;
}

// Trigger the effect/bundle on the system. Exactly one of effect/bundle is required (typed error
// otherwise); unknown NAMES surface as runtime-core's typed EffectNotFoundError / BundleNotFoundError.
function triggerOnSystem(system: EffectSystem, trigger: EffectFrameTrigger): void {
  const hasEffect = trigger.effect !== undefined;
  const hasBundle = trigger.bundle !== undefined;
  if (hasEffect === hasBundle) {
    throw new EffectTriggerError(
      'an effect frame trigger must name exactly one of `effect` or `bundle`',
    );
  }
  const anchorsMap = resolveAnchorsMap(trigger.anchors);
  if (hasEffect) {
    const anchor = anchorsMap[DEFAULT_ANCHOR_ROLE] ?? WORLD_ORIGIN_ANCHOR;
    system.trigger({ effect: trigger.effect!, anchor, seed: trigger.seed, startTime: 0 });
    return;
  }
  system.triggerBundle(trigger.bundle!, trigger.seed, anchorsMap, 0);
}

// Solve one effect frame: validate, build the atlas index, trigger, step 0 -> time at the fixed sub-step
// dt, and read the solved state. Returns everything the draw-item gather needs. Shared by renderEffectFrame
// and the composed path so there is one solve driver.
function solveEffectFrame(params: {
  readonly effectsDocument: unknown;
  readonly trigger: EffectFrameTrigger;
  readonly time: number;
  readonly atlas: AtlasPixelSource;
  readonly resolveBone: BoneAnchorResolver | undefined;
  readonly validate: ValidateEffectsOptions | undefined;
}): { frame: ReadonlyEffectFrame; atlasIndex: AtlasIndex; doc: EffectsDocument } {
  const doc = parseEffectsDocument(params.effectsDocument, {
    verifyHash: params.validate?.verifyHash ?? false,
  });
  const atlasIndex = new AtlasIndex(doc.atlas, params.atlas);
  const system = new EffectSystem(
    doc,
    params.resolveBone !== undefined ? { resolveBone: params.resolveBone } : {},
  );
  triggerOnSystem(system, params.trigger);

  const stepDt = computeStepDt(doc, params.trigger);
  const steps = params.time <= 0 ? 0 : Math.round(params.time / stepDt);
  for (let i = 0; i < steps; i += 1) system.step(stepDt);

  return { frame: system.readState(), atlasIndex, doc };
}

// Rasterize one effect draw item. World items project through the world -> image transform; screen items
// already carry image-pixel positions and bypass it. Fixed loop order over the item's triangles.
function rasterizeEffectItem(fb: Framebuffer, item: EffectDrawItem, transform: WorldToImage): void {
  const p = item.positions;
  const uvs = item.uvs;
  const triangles = item.triangles;
  const isWorld = item.space === 'world';
  for (let t = 0; t < triangles.length; t += 3) {
    const i0 = triangles[t]!;
    const i1 = triangles[t + 1]!;
    const i2 = triangles[t + 2]!;
    const tri: RasterTriangle = {
      x0: isWorld ? projectX(transform, p[i0 * 2]!) : p[i0 * 2]!,
      y0: isWorld ? projectY(transform, p[i0 * 2 + 1]!) : p[i0 * 2 + 1]!,
      u0: uvs[i0 * 2]!,
      v0: uvs[i0 * 2 + 1]!,
      x1: isWorld ? projectX(transform, p[i1 * 2]!) : p[i1 * 2]!,
      y1: isWorld ? projectY(transform, p[i1 * 2 + 1]!) : p[i1 * 2 + 1]!,
      u1: uvs[i1 * 2]!,
      v1: uvs[i1 * 2 + 1]!,
      x2: isWorld ? projectX(transform, p[i2 * 2]!) : p[i2 * 2]!,
      y2: isWorld ? projectY(transform, p[i2 * 2 + 1]!) : p[i2 * 2 + 1]!,
      u2: uvs[i2 * 2]!,
      v2: uvs[i2 * 2 + 1]!,
    };
    rasterizeTriangle(fb, tri, item.sampler, item.tint, item.alpha, item.blend);
  }
}

// Add every world-space vertex of a draw item to the content bounds (screen items are viewport-relative
// and excluded from fit:'content' framing).
function addWorldItemBounds(bounds: WorldBounds, item: EffectDrawItem): void {
  if (item.space !== 'world') return;
  const p = item.positions;
  for (let i = 0; i < p.length; i += 2) bounds.add(p[i]!, p[i + 1]!);
}

export function renderEffectFrame(options: RenderEffectFrameOptions): RenderFrameResult {
  const { frame, atlasIndex, doc } = solveEffectFrame({
    effectsDocument: options.effectsDocument,
    trigger: options.trigger,
    time: options.time,
    atlas: options.atlas,
    resolveBone: options.resolveBone,
    validate: options.validate,
  });

  const items = gatherEffectDrawItems(frame, atlasIndex, options.viewport, buildLayerOrder(doc));

  const bounds = new WorldBounds();
  for (const item of items) addWorldItemBounds(bounds, item);

  const transform = resolveWorldToImage(options.viewport, bounds);
  const fb = new Framebuffer(
    options.viewport.width,
    options.viewport.height,
    options.background ?? TRANSPARENT,
  );
  for (const item of items) rasterizeEffectItem(fb, item, transform);

  const rgba = fb.toStraightRgba8();
  const png = encodePng(rgba, options.viewport.width, options.viewport.height);
  return { png, width: options.viewport.width, height: options.viewport.height };
}

export function renderComposedFrame(options: RenderComposedFrameOptions): RenderFrameResult {
  // Skeleton: parse + gather world draw items exactly like renderFrame (no re-solve).
  const skeleton = options.skeleton;
  const skeletonDoc = parseDocument(skeleton.document, {
    verifyHash: skeleton.validate?.verifyHash ?? false,
  });
  const skeletonAtlas = new AtlasIndex(skeletonDoc.atlas, skeleton.atlas);
  const skeletonItems = gatherDrawItems(
    skeletonDoc,
    skeletonAtlas,
    skeleton.animation,
    skeleton.time,
  );

  // Effect overlay: solve + gather.
  const effect = options.effect;
  const { frame, atlasIndex, doc } = solveEffectFrame({
    effectsDocument: effect.effectsDocument,
    trigger: effect.trigger,
    time: effect.time,
    atlas: effect.atlas,
    resolveBone: effect.resolveBone,
    validate: effect.validate,
  });
  const effectItems = gatherEffectDrawItems(
    frame,
    atlasIndex,
    options.viewport,
    buildLayerOrder(doc),
  );

  // Shared content bounds over both layers' world geometry.
  const bounds = new WorldBounds();
  for (const item of skeletonItems) {
    const positions = item.worldPositions;
    for (let i = 0; i < positions.length; i += 2) bounds.add(positions[i]!, positions[i + 1]!);
  }
  for (const item of effectItems) addWorldItemBounds(bounds, item);

  const transform = resolveWorldToImage(options.viewport, bounds);
  const fb = new Framebuffer(
    options.viewport.width,
    options.viewport.height,
    options.background ?? TRANSPARENT,
  );
  // Skeleton first, then the effect overlay, into the one framebuffer.
  for (const item of skeletonItems) rasterizeWorldItem(fb, item, transform);
  for (const item of effectItems) rasterizeEffectItem(fb, item, transform);

  const rgba = fb.toStraightRgba8();
  const png = encodePng(rgba, options.viewport.width, options.viewport.height);
  return { png, width: options.viewport.width, height: options.viewport.height };
}
