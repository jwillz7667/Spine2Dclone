import { parseDocument, type ValidateOptions } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import type { ValidateEffectsOptions } from '@marionette/format/effects';
import {
  applyAnimationState,
  buildPose,
  getTrackEntry,
  updateAnimationState,
  type AnimationState,
  type BoneAnchorResolver,
} from '@marionette/runtime-core';
import { AtlasIndex, type AtlasPixelSource } from './atlas';
import { TRANSPARENT, type Color } from './color';
import { gatherDrawItemsFromPose, solvePoseForFrame, type MeshDeformSource } from './draw-items';
import { buildLayerOrder, gatherEffectDrawItems, type EffectDrawItem } from './effect-draw-items';
import {
  EmptySequenceError,
  InvalidFpsError,
  InvalidFrameRangeError,
  UnknownAnimationError,
} from './errors';
import { encodePng } from './png';
import { Framebuffer } from './raster';
import { rasterizeWorldItem } from './raster-items';
import { addWorldItemBounds, rasterizeEffectItem, solveEffectFrame } from './render-effect-frame';
import type { EffectFrameTrigger } from './render-effect-frame';
import {
  assertViewportSize,
  resolveWorldToImage,
  WorldBounds,
  type Viewport,
  type WorldToImage,
} from './viewport';

// The deterministic frame-sequence pipeline (PP-C10 slice 1): sample a clip at a chosen fps and frame range
// and stream out per-frame straight-alpha RGBA plus PNG-on-demand, reusing one framebuffer and one output
// buffer across the whole clip so a long clip never holds every frame in memory. It is the substrate the
// GIF and APNG encoders consume. Same determinism bar as renderFrame: pure function of its inputs, no clock,
// no randomness. The GPU-quality video (WebM/MP4) encoder is explicitly NOT here; it lives at the editor
// edge (a bundled encoder, never a runtime dependency) per the PP-C10 product note.

// The lowest supported fps and the safety cap on total frames. fps drives both the sample times and the
// encoded frame delay. The frame cap bounds a single in-memory GIF/APNG (a 30 min clip at 120 fps); beyond
// it a caller should stream a PNG sequence to disk instead.
const MIN_FPS = 1;
const MAX_FPS = 120;
const MAX_SEQUENCE_FRAMES = 216_000;

// A frame-range endpoint, expressed in seconds (rounded to the nearest frame at the clip fps) or as an
// explicit frame index. Frame indices are the deterministic form; seconds are a convenience.
export type SequenceBound = { readonly seconds: number } | { readonly frame: number };

// The optional composed particle overlay for a clip (the sequence analogue of renderComposedFrame): the
// same effect/bundle trigger, solved fresh at each frame's clip time (0 -> time at the effect's
// simulationDt) and drawn on top of the skeleton into the shared framebuffer.
export interface SequenceEffect {
  readonly effectsDocument: unknown;
  readonly trigger: EffectFrameTrigger;
  readonly atlas: AtlasPixelSource;
  readonly resolveBone?: BoneAnchorResolver;
  readonly validate?: ValidateEffectsOptions;
}

// Fields shared by both clip sources. Mirrors renderFrame (document, atlas, viewport, background) and adds
// the clip controls (fps, from/to) plus the optional composed effect.
export interface SequenceBaseOptions {
  readonly document: unknown;
  readonly atlas: AtlasPixelSource;
  readonly viewport: Viewport;
  readonly background?: Color;
  // Frames per second: an integer in [1, 120]. Drives sample times and the encoded frame delay.
  readonly fps: number;
  // Inclusive start / exclusive end of the clip. `from` defaults to frame 0. `to` defaults to the sampled
  // animation's duration; it is REQUIRED for a setup-pose or AnimationState clip (no duration to infer).
  readonly from?: SequenceBound;
  readonly to?: SequenceBound;
  readonly effect?: SequenceEffect;
  readonly validate?: ValidateOptions;
}

// Source A: a single animation sampled at each frame time (or the setup pose when `animation` is omitted),
// exactly as renderFrame samples. `animationState` is forbidden here so the two sources stay exclusive.
export interface SingleAnimationSequenceOptions extends SequenceBaseOptions {
  readonly animation?: string;
  readonly animationState?: undefined;
}

// Source B: an AnimationState track setup (crossfades, layering, queued animations). The factory is called
// once per iteration pass with the parsed, validated document and returns a fresh state; the pipeline
// advances it by 1/fps per frame (updateAnimationState) and solves it (applyAnimationState). Mesh deform is
// scoped to the track-0 entry, matching runtime-web's SkeletonView.syncState (ADR-0005 defines no
// cross-track deform blend), so the preview and the shipped renderer sample the same deform.
export interface AnimationStateSequenceOptions extends SequenceBaseOptions {
  readonly animationState: (document: SkeletonDocument) => AnimationState;
  readonly animation?: undefined;
}

export type RenderSequenceOptions = SingleAnimationSequenceOptions | AnimationStateSequenceOptions;

// One rendered frame. `rgba` is straight-alpha 8-bit RGBA (length width * height * 4) and is a SCRATCH
// buffer REUSED across iterations: it holds only the current frame. Encode it with png() or copy it before
// advancing the iterator; do not retain the reference expecting it to keep this frame's pixels.
export interface SequenceFrame {
  readonly index: number;
  readonly timeSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  png(): Uint8Array;
}

// A resolved clip: metadata known up front (no solving) plus streaming access to its frames. frames()
// returns a FRESH generator each call (re-solving the clip), so a multi-pass encoder (a global-palette GIF)
// can iterate twice; the content-fit camera transform is computed once and memoized across passes.
export interface RenderedSequence {
  readonly frameCount: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  frames(): Generator<SequenceFrame>;
  forEach(onFrame: (frame: SequenceFrame) => void): void;
}

type ResolvedSource =
  | { readonly kind: 'animation'; readonly animation: string | undefined }
  | { readonly kind: 'state'; readonly makeState: (document: SkeletonDocument) => AnimationState };

interface WalkFrame {
  readonly index: number;
  readonly timeSeconds: number;
  readonly skeletonItems: ReturnType<typeof gatherDrawItemsFromPose>;
  readonly effectItems: readonly EffectDrawItem[];
}

class RenderedSequenceImpl implements RenderedSequence {
  readonly frameCount: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  private contentTransform: WorldToImage | null = null;

  constructor(
    private readonly document: SkeletonDocument,
    private readonly atlasIndex: AtlasIndex,
    private readonly source: ResolvedSource,
    private readonly viewport: Viewport,
    private readonly background: Color,
    fps: number,
    private readonly fromFrame: number,
    frameCount: number,
    private readonly effect: SequenceEffect | null,
  ) {
    this.fps = fps;
    this.frameCount = frameCount;
    this.width = viewport.width;
    this.height = viewport.height;
  }

  get durationSeconds(): number {
    return this.frameCount / this.fps;
  }

  *frames(): Generator<SequenceFrame> {
    const transform = this.resolveTransform();
    const width = this.width;
    const height = this.height;
    const fb = new Framebuffer(width, height, this.background);
    const rgba = new Uint8Array(width * height * 4);
    const png = (): Uint8Array => encodePng(rgba, width, height);

    for (const walkFrame of this.walk()) {
      fb.clear(this.background);
      for (const item of walkFrame.skeletonItems) rasterizeWorldItem(fb, item, transform);
      for (const item of walkFrame.effectItems) rasterizeEffectItem(fb, item, transform);
      fb.toStraightRgba8Into(rgba);
      yield {
        index: walkFrame.index,
        timeSeconds: walkFrame.timeSeconds,
        width,
        height,
        rgba,
        png,
      };
    }
  }

  forEach(onFrame: (frame: SequenceFrame) => void): void {
    for (const frame of this.frames()) onFrame(frame);
  }

  // Resolve the world -> image transform once. An explicit fit rect needs no solving. fit:'content' frames
  // the union of every frame's world geometry so the camera is STABLE across the clip (the subject does not
  // jitter as its per-frame bounds change); this pre-scan solves each frame once and is memoized so a
  // multi-pass encoder does not repeat it.
  private resolveTransform(): WorldToImage {
    if (this.viewport.fit !== 'content') {
      return resolveWorldToImage(this.viewport, new WorldBounds());
    }
    if (this.contentTransform !== null) return this.contentTransform;
    const bounds = new WorldBounds();
    for (const walkFrame of this.walk()) {
      for (const item of walkFrame.skeletonItems) {
        const positions = item.worldPositions;
        for (let i = 0; i < positions.length; i += 2) bounds.add(positions[i]!, positions[i + 1]!);
      }
      for (const item of walkFrame.effectItems) addWorldItemBounds(bounds, item);
    }
    const transform = resolveWorldToImage(this.viewport, bounds);
    this.contentTransform = transform;
    return transform;
  }

  // Walk the clip frame by frame, solving the pose (and optional effect) and gathering draw items. A fresh
  // pose is built per walk; the AnimationState source builds a fresh state and warms it up to `fromFrame`
  // before emitting, so the walk is fully deterministic and repeatable across passes.
  private *walk(): Generator<WalkFrame> {
    const pose = buildPose(this.document);
    const dt = 1 / this.fps;
    const source = this.source;

    let state: AnimationState | null = null;
    if (source.kind === 'state') {
      state = source.makeState(this.document);
      for (let g = 0; g < this.fromFrame; g += 1) updateAnimationState(state, dt);
    }

    for (let i = 0; i < this.frameCount; i += 1) {
      const timeSeconds = (this.fromFrame + i) / this.fps;
      let deform: MeshDeformSource;
      if (source.kind === 'animation') {
        deform = solvePoseForFrame(this.document, pose, source.animation, timeSeconds);
      } else {
        if (i > 0) updateAnimationState(state!, dt);
        applyAnimationState(state!, pose);
        const track0 = getTrackEntry(state!, 0);
        deform =
          track0 === null
            ? { animationId: null, sampleTime: 0 }
            : { animationId: track0.animationId, sampleTime: track0.trackTime };
      }

      const skeletonItems = gatherDrawItemsFromPose(this.document, this.atlasIndex, pose, deform);
      const effectItems = this.effect === null ? [] : this.solveEffectItems(timeSeconds);
      yield { index: i, timeSeconds, skeletonItems, effectItems };
    }
  }

  private solveEffectItems(time: number): EffectDrawItem[] {
    const effect = this.effect!;
    const { frame, atlasIndex, doc } = solveEffectFrame({
      effectsDocument: effect.effectsDocument,
      trigger: effect.trigger,
      time,
      atlas: effect.atlas,
      resolveBone: effect.resolveBone,
      validate: effect.validate,
    });
    return gatherEffectDrawItems(frame, atlasIndex, this.viewport, buildLayerOrder(doc));
  }
}

// Resolve a clip. Validates fps and the viewport size up front (fail fast), parses + validates the document
// (the validate-before-solve boundary, same posture as renderFrame), resolves the frame range, and returns
// the RenderedSequence. No frames are solved until frames()/forEach() is iterated.
export function renderSequence(options: RenderSequenceOptions): RenderedSequence {
  const fps = options.fps;
  if (!Number.isInteger(fps) || fps < MIN_FPS || fps > MAX_FPS) throw new InvalidFpsError(fps);
  assertViewportSize(options.viewport);

  const document = parseDocument(options.document, {
    verifyHash: options.validate?.verifyHash ?? false,
  });

  const source = resolveSource(options, document);

  const fromFrame = options.from !== undefined ? resolveBound(options.from, fps) : 0;
  const toFrame = resolveToFrame(options, document, fps, source);
  const frameCount = toFrame - fromFrame;
  if (frameCount < 1) throw new EmptySequenceError();
  if (frameCount > MAX_SEQUENCE_FRAMES) {
    throw new InvalidFrameRangeError(
      `frame count ${frameCount} exceeds the ${MAX_SEQUENCE_FRAMES} cap; stream a PNG sequence instead`,
    );
  }

  const atlasIndex = new AtlasIndex(document.atlas, options.atlas);
  return new RenderedSequenceImpl(
    document,
    atlasIndex,
    source,
    options.viewport,
    options.background ?? TRANSPARENT,
    fps,
    fromFrame,
    frameCount,
    options.effect ?? null,
  );
}

function resolveSource(options: RenderSequenceOptions, document: SkeletonDocument): ResolvedSource {
  if (options.animationState !== undefined) {
    return { kind: 'state', makeState: options.animationState };
  }
  // Validate a named animation once here rather than throwing UnknownAnimationError on every frame.
  if (options.animation !== undefined && document.animations[options.animation] === undefined) {
    throw new UnknownAnimationError(options.animation);
  }
  return { kind: 'animation', animation: options.animation };
}

function resolveBound(bound: SequenceBound, fps: number): number {
  if ('frame' in bound) {
    if (!Number.isInteger(bound.frame) || bound.frame < 0) {
      throw new InvalidFrameRangeError(
        `frame bound must be a non-negative integer, got ${bound.frame}`,
      );
    }
    return bound.frame;
  }
  if (!Number.isFinite(bound.seconds) || bound.seconds < 0) {
    throw new InvalidFrameRangeError(
      `seconds bound must be a non-negative finite number, got ${bound.seconds}`,
    );
  }
  return Math.round(bound.seconds * fps);
}

function resolveToFrame(
  options: RenderSequenceOptions,
  document: SkeletonDocument,
  fps: number,
  source: ResolvedSource,
): number {
  if (options.to !== undefined) return resolveBound(options.to, fps);
  if (source.kind === 'animation' && source.animation !== undefined) {
    // Existence validated in resolveSource; infer the range from the animation duration.
    return Math.round(document.animations[source.animation]!.duration * fps);
  }
  throw new InvalidFrameRangeError(
    '`to` is required for a setup-pose or AnimationState clip (no animation duration to infer from)',
  );
}
