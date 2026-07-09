import { Container, type Texture } from 'pixi.js';
import {
  crossfadeTo,
  EffectSystem,
  makeAnimationState,
  setAnimation as setTrackAnimation,
  updateAnimationState,
  type AnimationState,
  type EffectAnchor,
  type EffectInstanceId,
  type FiredEvent,
  type QualityTier,
  type SystemOptions,
} from '@marionette/runtime-core';
import type { AtlasRef, EffectsDocument, SkeletonDocument } from '@marionette/format/types';
import { SkeletonView } from '../scene/skeleton-view';
import { ParticleLayerView } from '../scene/particle-layer-view';
import { SlotSceneView, type SlotSceneViewOptions } from '../slot/slot-scene-view';
import {
  buildRegionTextures,
  makeRegionTextureResolver,
  type RegionTextureResolver,
} from '../scene/region-textures';
import { browserAssetLoader, type AssetLoader } from './asset-loader';
import {
  decodeEffectsDocument,
  decodeSkeletonDocument,
  type EffectsSource,
  type SkeletonSource,
} from './document-loader';
import type { GridConfig } from '@marionette/format/slot-types';

// The packaged web player (PP-C5): the documented, supported embedding API. createPlayer loads a skeleton
// document (MRNT binary or JSON) plus its atlas pages through an injectable AssetLoader, builds the
// textures, and wires a SkeletonView (AnimationState-backed playback with fired-event subscription and
// runtime skin switching), an optional EffectSystem + ParticleLayerView for VFX, and an optional
// SlotSceneView for a slot scene. The host mounts `player.root` and drives `player.update(dt)` from its own
// ticker (or a PixiJS Application ticker). Every browser dependency (fetch, texture load) lives behind the
// AssetLoader, so the whole player is exercisable headlessly by injecting a loader and a texture resolver.

// One atlas page to load: its AtlasPage.file name (how regions reference it) and the URL to fetch it from.
export interface AtlasPageUrl {
  readonly file: string;
  readonly url: string;
}

// How the player obtains atlas textures for a document: an already-built resolver (a test or a host that
// manages its own textures), OR a list of page URLs the injected loader fetches and slices into regions.
export type AtlasSource =
  | { readonly resolver: RegionTextureResolver | null }
  | { readonly pages: readonly AtlasPageUrl[] };

export interface EffectsPlayerOptions {
  readonly document: EffectsSource;
  readonly atlas?: AtlasSource;
  readonly maxLiveParticles?: number;
  readonly qualityTier?: QualityTier;
}

export interface SlotPlayerOptions {
  readonly grid: GridConfig;
  readonly options: SlotSceneViewOptions;
}

export interface PlayerOptions {
  // The skeleton document source (MRNT bytes, JSON bytes / text, or a parsed object).
  readonly document: SkeletonSource;
  // Atlas textures for the skeleton (injected resolver or page URLs). Omit for the placeholder (untextured).
  readonly atlas?: AtlasSource;
  // Optional VFX subsystem (an effects document plus its atlas).
  readonly effects?: EffectsPlayerOptions;
  // Optional slot scene (a grid plus the SlotSceneView options: symbol resolver + callbacks).
  readonly slot?: SlotPlayerOptions;
  // The asset loader (defaults to the browser fetch + PixiJS Assets loader).
  readonly loader?: AssetLoader;
  // The animation to start on track 0 (setup pose if omitted).
  readonly animation?: string;
  // Whether the initial / set animation loops (default true) and whether playback starts running (default true).
  readonly loop?: boolean;
  readonly autoPlay?: boolean;
  // The viewport size for screen-space particle layers (a full-viewport cover). Defaults to 1x1.
  readonly viewport?: { readonly width: number; readonly height: number };
}

// A fired-event subscriber; return value ignored. The FiredEvent is a transient pooled entry (drained per
// update): read it synchronously, do not retain it across updates.
export type EventListener = (event: FiredEvent) => void;

// Build the EffectSystem options, omitting the optional keys the caller left unset (exactOptionalPropertyTypes).
function effectSystemOptions(effects: EffectsPlayerOptions | undefined): SystemOptions {
  const opts: { maxLiveParticles?: number; qualityTier?: QualityTier } = {};
  if (effects?.maxLiveParticles !== undefined) opts.maxLiveParticles = effects.maxLiveParticles;
  if (effects?.qualityTier !== undefined) opts.qualityTier = effects.qualityTier;
  return opts;
}

// Resolve an AtlasSource to a RegionTextureResolver, loading + slicing pages through the loader when needed.
async function resolveAtlas(
  atlas: AtlasSource | undefined,
  ref: AtlasRef,
  loader: AssetLoader,
): Promise<RegionTextureResolver | null> {
  if (atlas === undefined) return null;
  if ('resolver' in atlas) return atlas.resolver;
  const pageTextures = new Map<string, Texture>();
  for (const page of atlas.pages) {
    pageTextures.set(page.file, await loader.loadTexture(page.url));
  }
  return makeRegionTextureResolver(buildRegionTextures(ref, pageTextures));
}

// Load + validate every asset and construct the wired player. Async because atlas pages load through the
// loader. Decode / validation failures surface as the typed PlayerLoadError from document-loader.
export async function createPlayer(options: PlayerOptions): Promise<Player> {
  const loader = options.loader ?? browserAssetLoader();

  const document = decodeSkeletonDocument(options.document);
  const skeletonResolver = await resolveAtlas(options.atlas, document.atlas, loader);

  let effectsDocument: EffectsDocument | null = null;
  let effectsResolver: RegionTextureResolver | null = null;
  if (options.effects !== undefined) {
    effectsDocument = decodeEffectsDocument(options.effects.document);
    effectsResolver = await resolveAtlas(options.effects.atlas, effectsDocument.atlas, loader);
  }

  return new Player(document, skeletonResolver, effectsDocument, effectsResolver, options);
}

export class Player {
  // The scene root to mount. Slot scene at the back, skeleton in the middle, particles on top.
  readonly root: Container;
  readonly skeletonView: SkeletonView;
  readonly particleView: ParticleLayerView | null;
  readonly slotView: SlotSceneView | null;

  private readonly document: SkeletonDocument;
  private readonly state: AnimationState;
  private readonly effectSystem: EffectSystem | null;
  private readonly listeners = new Set<EventListener>();

  private playing: boolean;
  private loopDefault: boolean;
  private currentAnimation: string | null = null;
  private slotClockMs = 0;

  constructor(
    document: SkeletonDocument,
    skeletonResolver: RegionTextureResolver | null,
    effectsDocument: EffectsDocument | null,
    effectsResolver: RegionTextureResolver | null,
    options: PlayerOptions,
  ) {
    this.document = document;
    this.state = makeAnimationState(document);
    this.loopDefault = options.loop ?? true;
    this.playing = options.autoPlay ?? true;

    this.root = new Container();
    this.skeletonView = new SkeletonView();
    this.skeletonView.setTextureResolver(skeletonResolver);

    this.slotView = options.slot ? new SlotSceneView(options.slot.grid, options.slot.options) : null;
    this.particleView = effectsDocument ? new ParticleLayerView(effectsResolver) : null;
    this.effectSystem = effectsDocument
      ? new EffectSystem(effectsDocument, effectSystemOptions(options.effects))
      : null;
    if (this.particleView !== null && options.viewport !== undefined) {
      this.particleView.setViewport(options.viewport.width, options.viewport.height);
    }

    if (this.slotView !== null) this.root.addChild(this.slotView.root);
    this.root.addChild(this.skeletonView.root);
    if (this.particleView !== null) this.root.addChild(this.particleView.root);

    if (options.animation !== undefined) {
      setTrackAnimation(this.state, 0, options.animation, this.loopDefault);
      this.currentAnimation = options.animation;
    }
    // Render the initial frame (setup pose when no animation is set).
    this.renderSkeleton();
  }

  // Advance the player by `deltaSeconds`. When playing, it advances the animation state (firing events to
  // subscribers), steps the effect system, and advances the slot timeline, then renders every wired view.
  // A paused player ignores the tick. No clock is owned here: the host supplies dt (Law 1 determinism).
  update(deltaSeconds: number): void {
    if (!this.playing || deltaSeconds < 0) return;

    updateAnimationState(this.state, deltaSeconds);
    this.drainEvents();
    this.renderSkeleton();

    if (this.effectSystem !== null && this.particleView !== null) {
      this.effectSystem.step(deltaSeconds);
      this.particleView.update(this.effectSystem.readState());
    }
    if (this.slotView !== null) {
      this.slotClockMs += deltaSeconds * 1000;
      this.slotView.update(this.slotClockMs);
    }
  }

  play(): void {
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  // Whether subsequent setAnimation calls loop by default (also applied to seek re-arming).
  setLoop(loop: boolean): void {
    this.loopDefault = loop;
  }

  // Replace track 0 with `animationId` (no crossfade) and render the first frame immediately.
  setAnimation(animationId: string, loop: boolean = this.loopDefault): void {
    setTrackAnimation(this.state, 0, animationId, loop);
    this.currentAnimation = animationId;
    this.renderSkeleton();
  }

  // Crossfade track 0 into `animationId` over `mixSeconds` (AnimationState rule 4).
  crossfade(animationId: string, mixSeconds: number, loop: boolean = this.loopDefault): void {
    crossfadeTo(this.state, 0, animationId, loop, mixSeconds);
    this.currentAnimation = animationId;
    this.renderSkeleton();
  }

  // Seek the current track-0 animation to an absolute time (seconds from its start): re-arm the track and
  // advance it once, so the pose is a pure function of the seek time. Events in [0, seconds] fire in the
  // single advance (a seek is not a frame-by-frame replay). The slot timeline seeks to the same time; the
  // effect system has no absolute seek and is not repositioned (documented in the README).
  seek(seconds: number): void {
    if (this.currentAnimation !== null) {
      setTrackAnimation(this.state, 0, this.currentAnimation, this.loopDefault);
      updateAnimationState(this.state, Math.max(0, seconds));
      this.drainEvents();
      this.renderSkeleton();
    }
    if (this.slotView !== null) {
      this.slotClockMs = Math.max(0, seconds) * 1000;
      this.slotView.update(this.slotClockMs);
    }
  }

  // Runtime skin switching (PP-C6): switch the active skin and re-render the current frame.
  setActiveSkin(skinName: string): void {
    this.skeletonView.setActiveSkin(skinName);
    this.renderSkeleton();
  }

  getSkinNames(): readonly string[] {
    return this.skeletonView.getSkinNames();
  }

  // The active skin name (PP-C6/PP-C8). Two-color, sequence, and linked-mesh rendering read attachments and
  // (on the single-animation path) skin-scoped constraints under this skin.
  getActiveSkin(): string {
    return this.skeletonView.getActiveSkin();
  }

  // Trigger a VFX effect by name (a slot vfxBurst callback can forward to this). No-op without an effects
  // subsystem. Returns the instance id, or null when there is no effect system.
  triggerEffect(
    effect: string,
    anchor: EffectAnchor,
    seed = 0,
    startTime = 0,
  ): EffectInstanceId | null {
    if (this.effectSystem === null) return null;
    return this.effectSystem.trigger({ effect, anchor, seed, startTime });
  }

  // Load a slot spin timeline (no-op without a slot scene). See SlotSceneView.setTimeline.
  setSlotTimeline(timeline: Parameters<SlotSceneView['setTimeline']>[0]): void {
    this.slotView?.setTimeline(timeline);
    this.slotClockMs = 0;
  }

  // Subscribe to fired animation events (PP-B4). Returns an unsubscribe function.
  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Release every GPU / display resource. The player is not reusable after this.
  destroy(): void {
    this.skeletonView.destroy();
    this.particleView?.destroy();
    this.slotView?.destroy();
    this.root.destroy({ children: true });
    this.listeners.clear();
  }

  // ---- internals ----

  private renderSkeleton(): void {
    // syncState applies the (possibly empty) track set: no tracks yields the setup pose, so this is the one
    // render path for both the initial frame and playback (a single cached scene keyed by the document).
    this.skeletonView.syncState(this.document, this.state);
  }

  private drainEvents(): void {
    if (this.listeners.size === 0) return;
    const queue = this.state.eventQueue;
    for (let i = 0; i < queue.count; i += 1) {
      const event = queue.events[i]!;
      for (const listener of this.listeners) listener(event);
    }
  }
}
