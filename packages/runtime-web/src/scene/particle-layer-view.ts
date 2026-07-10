import { Container, Mesh, MeshGeometry, Sprite, Texture } from 'pixi.js';
import { DEG_TO_RAD, getRotationDeg } from '@marionette/runtime-core';
import type {
  EffectInstanceId,
  ReadonlyEffectFrame,
  ReadonlyEmitterView,
  ReadonlyRibbonView,
  ReadonlySpriteView,
} from '@marionette/runtime-core';
import type { EmitterLayer, ParticleTexture } from '@marionette/format/types';
import { blendModeToPixi } from './blend-mode';
import {
  fillEmitterBatch,
  makeParticleRenderBatch,
  type ParticleRenderBatch,
} from './particle-render-batch';
import {
  buildStripIndices,
  buildStripUVs,
  fillStripPositions,
  stripBufferLength,
} from './ribbon-strip';
import type { RegionTextureResolver } from './region-textures';

// The PixiJS particle renderer (phase-3-vfx-particles.md section 7, WP-3.5 / PP-C3). It consumes the
// EffectSystem's readonly per-frame views (runtime-core solves the particle state; this only draws it,
// INV: solving is core's job, rendering is the renderer's job) and maintains the display objects:
//
//   - emitter layers: a pool of PixiJS Sprites sized to the emitter's pool capacity (== the possibly
//     tier-scaled maxParticles), NEVER grown per frame, fed by the pure fillEmitterBatch bridge. The
//     live [0, count) sprites are shown at their solved transform/tint; the rest are hidden.
//   - ribbonTrail layers: one MeshGeometry strip per ribbon, positions written in place each frame from
//     the pure ribbon-strip bridge (index/UV buffers built once at capacity).
//   - spriteAnimator layers: a single Sprite placed at the resolved world anchor, or (anchorSpace
//     'screen') covering the viewport via runtime-core's screenCoverTransformInto.
//
// Per-layer blend goes through the ONE blendModeToPixi mapping the slot renderer also uses (section 7.4:
// no second blend path). Quality tiers are respected structurally: the EffectSystem already tier-scales
// an ambient effect's spawn rate and maxParticles at trigger time, so a lower tier yields a smaller pool
// capacity here, which the view follows; the renderer adds no second tier knob.
//
// Allocation discipline (INV no per-frame allocation): the per-instance bindings, sprite pools, render
// batches, and geometry buffers are all built at trigger time (when an instance first appears) and reused
// every frame. update() in the steady state (the same live instances) allocates nothing; a new trigger or
// a finished instance allocates / releases outside the hot path, exactly like the SkeletonView pools.

const DEFAULT_VIEWPORT = 1;

// A pooled emitter binding: the container holding the sprite pool, the pool itself (capacity fixed), the
// reused render batch, and the pre-resolved textures (one for a static region, one per animated frame).
interface EmitterBinding {
  readonly container: Container;
  readonly sprites: Sprite[];
  readonly batch: ParticleRenderBatch;
  readonly textures: Texture[];
}

// A pooled ribbon binding: the strip Mesh, its own position buffer (written in place each frame), and the
// live point count from the last fill (for describe()).
interface RibbonBinding {
  readonly mesh: Mesh;
  readonly positions: Float32Array;
  pointCount: number;
}

// A pooled sprite-animator binding: the single quad plus its authored anchor space (for describe()).
interface SpriteBinding {
  readonly sprite: Sprite;
  readonly anchorSpace: 'world' | 'screen';
}

// One live effect instance's display objects, keyed by EffectInstanceId. `seen` marks whether the current
// frame still carries the instance; unseen bindings are released after reconciliation.
interface InstanceBinding {
  readonly root: Container;
  readonly emitters: EmitterBinding[];
  readonly ribbons: RibbonBinding[];
  readonly sprites: SpriteBinding[];
  seen: boolean;
}

// Headless snapshots (no WebGL needed): the last update()'s resolved render state, so tests assert
// pooling, order, blend, and transforms without a GL context (the SkeletonView.describe pattern).
export interface EmitterParticleRender {
  readonly x: number;
  readonly y: number;
  readonly rotation: number; // radians (what the sprite carries)
  readonly scale: number;
  readonly tint: number;
  readonly alpha: number;
  readonly frame: number;
}

export interface EmitterRender {
  readonly blendMode: string;
  readonly capacity: number;
  readonly liveCount: number;
  readonly particles: readonly EmitterParticleRender[];
}

export interface RibbonRender {
  readonly blendMode: string;
  readonly pointCount: number;
}

export interface SpriteAnimatorRender {
  readonly blendMode: string;
  readonly anchorSpace: 'world' | 'screen';
  readonly x: number;
  readonly y: number;
  readonly rotation: number; // radians
  readonly scaleX: number;
  readonly scaleY: number;
  readonly tint: number;
  readonly alpha: number;
}

export interface InstanceRender {
  readonly id: EffectInstanceId;
  readonly emitters: readonly EmitterRender[];
  readonly ribbons: readonly RibbonRender[];
  readonly sprites: readonly SpriteAnimatorRender[];
}

export interface ParticleSceneDescription {
  readonly instances: readonly InstanceRender[];
}

// The particle layer view. Mount `root` under the host scene (above the skeleton, below UI, per the host).
// Feed it EffectSystem.readState() each frame via update(). The renderer resolves particle textures
// through the injected region resolver (the SAME resolver SkeletonView uses); a region with no texture
// draws Texture.WHITE, so a partially-loaded atlas still renders.
export class ParticleLayerView {
  readonly root: Container;
  private resolver: RegionTextureResolver | null;
  private viewportWidth = DEFAULT_VIEWPORT;
  private viewportHeight = DEFAULT_VIEWPORT;
  private readonly instances = new Map<EffectInstanceId, InstanceBinding>();

  constructor(resolver: RegionTextureResolver | null = null) {
    this.root = new Container();
    this.resolver = resolver;
  }

  // Set the viewport size used to place `anchorSpace: 'screen'` sprite animators (a full-viewport cover).
  // Cheap; call on resize. World-space layers ignore it.
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  // Swap the region -> Texture resolver. Particle textures are resolved when an instance binding is built,
  // so this drops every live binding: the next update() rebuilds them against the new resolver. Passing
  // null restores the Texture.WHITE placeholder behavior. Never destroys host textures (the host owns them).
  setTextureResolver(resolver: RegionTextureResolver | null): void {
    this.resolver = resolver;
    this.releaseAll();
  }

  // Reconcile the display objects with one solved effect frame and write every live layer's render state.
  // Instances present in the frame are updated (bindings built lazily on first appearance); instances that
  // vanished (finished / reclaimed by the EffectSystem) are released. Steady state (same instances)
  // allocates nothing: pools, batches, and geometry buffers are reused in place.
  update(frame: ReadonlyEffectFrame): void {
    for (const binding of this.instances.values()) binding.seen = false;

    for (const instance of frame.instances) {
      const binding = this.ensureInstance(
        instance.id,
        instance.emitters,
        instance.ribbons,
        instance.sprites,
      );
      binding.seen = true;
      this.updateEmitters(binding, instance.emitters);
      this.updateRibbons(binding, instance.ribbons);
      this.updateSprites(binding, instance.sprites);
    }

    for (const [id, binding] of this.instances) {
      if (binding.seen) continue;
      this.root.removeChild(binding.root);
      binding.root.destroy({ children: true });
      this.instances.delete(id);
    }
  }

  // A read-only snapshot of the last update() for tests / tooling. NOT the per-frame path (it allocates
  // the snapshot arrays); the render path writes the display objects directly.
  describe(): ParticleSceneDescription {
    const instances: InstanceRender[] = [];
    for (const [id, binding] of this.instances) {
      const emitters: EmitterRender[] = binding.emitters.map((e) => {
        const particles: EmitterParticleRender[] = [];
        for (let i = 0; i < e.batch.count; i += 1) {
          const sprite = e.sprites[i]!;
          particles.push({
            x: sprite.x,
            y: sprite.y,
            rotation: sprite.rotation,
            scale: sprite.scale.x,
            tint: sprite.tint,
            alpha: sprite.alpha,
            frame: e.batch.frame[i]!,
          });
        }
        return {
          blendMode: e.sprites[0]?.blendMode ?? 'normal',
          capacity: e.batch.capacity,
          liveCount: e.batch.count,
          particles,
        };
      });
      const ribbons: RibbonRender[] = binding.ribbons.map((r) => ({
        blendMode: r.mesh.blendMode,
        pointCount: r.pointCount,
      }));
      const sprites: SpriteAnimatorRender[] = binding.sprites.map((s) => ({
        blendMode: s.sprite.blendMode,
        anchorSpace: s.anchorSpace,
        x: s.sprite.x,
        y: s.sprite.y,
        rotation: s.sprite.rotation,
        scaleX: s.sprite.scale.x,
        scaleY: s.sprite.scale.y,
        tint: s.sprite.tint,
        alpha: s.sprite.alpha,
      }));
      instances.push({ id, emitters, ribbons, sprites });
    }
    return { instances };
  }

  // Tear down every display object and drop all bindings; the view stays reusable (a later update rebuilds).
  destroy(): void {
    this.releaseAll();
    this.root.destroy({ children: true });
  }

  // ---- internals ----

  private releaseAll(): void {
    for (const binding of this.instances.values()) {
      this.root.removeChild(binding.root);
      binding.root.destroy({ children: true });
    }
    this.instances.clear();
  }

  private ensureInstance(
    id: EffectInstanceId,
    emitterViews: readonly ReadonlyEmitterView[],
    ribbonViews: readonly ReadonlyRibbonView[],
    spriteViews: readonly ReadonlySpriteView[],
  ): InstanceBinding {
    const existing = this.instances.get(id);
    if (existing !== undefined) return existing;

    const root = new Container();
    // Draw order within an instance follows the frame arrays: ribbons (trails, behind), then emitters,
    // then sprite-animators (flashes, on top). The ReadonlyInstanceFrame groups layers by kind, so strict
    // cross-kind interleave from the authored layer array is not recoverable here; within a kind the
    // EffectSystem preserves authored order. Instances are added to `root` in trigger order (later on top).
    const ribbons = ribbonViews.map((view) => this.buildRibbon(view));
    const emitters = emitterViews.map((view) => this.buildEmitter(view));
    const sprites = spriteViews.map((view) => this.buildSprite(view));

    for (const r of ribbons) root.addChild(r.mesh);
    for (const e of emitters) root.addChild(e.container);
    for (const s of sprites) root.addChild(s.sprite);

    this.root.addChild(root);
    const binding: InstanceBinding = { root, emitters, ribbons, sprites, seen: true };
    this.instances.set(id, binding);
    return binding;
  }

  private buildEmitter(view: ReadonlyEmitterView): EmitterBinding {
    const container = new Container();
    const pixiBlend = blendModeToPixi(view.layer.blendMode);
    const textures = this.resolveParticleTextures(view.layer);
    const sprites: Sprite[] = [];
    for (let i = 0; i < view.capacity; i += 1) {
      const sprite = new Sprite(textures[0] ?? Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.blendMode = pixiBlend;
      sprite.visible = false;
      sprites.push(sprite);
      container.addChild(sprite);
    }
    return { container, sprites, batch: makeParticleRenderBatch(view.capacity), textures };
  }

  private buildRibbon(view: ReadonlyRibbonView): RibbonBinding {
    const maxPoints = view.vx.length / 2;
    const positions = new Float32Array(stripBufferLength(maxPoints));
    const geometry = new MeshGeometry({
      positions,
      uvs: buildStripUVs(maxPoints),
      indices: buildStripIndices(maxPoints),
    });
    const texture = this.resolve(view.layer.region) ?? Texture.WHITE;
    const mesh = new Mesh({ geometry, texture });
    mesh.blendMode = blendModeToPixi(view.layer.blendMode);
    mesh.visible = false;
    return { mesh, positions: geometry.positions, pointCount: 0 };
  }

  private buildSprite(view: ReadonlySpriteView): SpriteBinding {
    const sprite = new Sprite(this.resolve(view.layer.region) ?? Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.blendMode = blendModeToPixi(view.layer.blendMode);
    return { sprite, anchorSpace: view.layer.anchorSpace };
  }

  private updateEmitters(binding: InstanceBinding, views: readonly ReadonlyEmitterView[]): void {
    for (let e = 0; e < binding.emitters.length; e += 1) {
      const emitter = binding.emitters[e]!;
      const view = views[e]!;
      const count = fillEmitterBatch(emitter.batch, view);
      const { x, y, rotationDeg, scale, tint, alpha, frame } = emitter.batch;
      const textureCount = emitter.textures.length;
      for (let i = 0; i < count; i += 1) {
        const sprite = emitter.sprites[i]!;
        sprite.visible = true;
        sprite.position.set(x[i]!, y[i]!);
        sprite.rotation = rotationDeg[i]! * DEG_TO_RAD;
        sprite.scale.set(scale[i]!);
        sprite.tint = tint[i]!;
        sprite.alpha = alpha[i]!;
        // Clamp the animated-frame index into the resolved-texture list (a static emitter has one).
        const fi = frame[i]!;
        const idx = fi < 0 ? 0 : fi >= textureCount ? textureCount - 1 : fi;
        sprite.texture = emitter.textures[idx] ?? Texture.WHITE;
      }
      for (let i = count; i < emitter.sprites.length; i += 1) emitter.sprites[i]!.visible = false;
    }
  }

  private updateRibbons(binding: InstanceBinding, views: readonly ReadonlyRibbonView[]): void {
    for (let r = 0; r < binding.ribbons.length; r += 1) {
      const ribbon = binding.ribbons[r]!;
      const view = views[r]!;
      const count = fillStripPositions(ribbon.positions, view);
      ribbon.pointCount = count;
      // A strip needs at least two points to draw a quad; below that it is hidden (degenerate).
      ribbon.mesh.visible = count >= 2;
      ribbon.mesh.geometry.getBuffer('aPosition').update();
    }
  }

  private updateSprites(binding: InstanceBinding, views: readonly ReadonlySpriteView[]): void {
    for (let s = 0; s < binding.sprites.length; s += 1) {
      const sprite = binding.sprites[s]!.sprite;
      const view = views[s]!;
      sprite.tint = packRgb(view.r, view.g, view.b);
      sprite.alpha = view.alpha;
      if (view.layer.anchorSpace === 'screen') {
        // A full-viewport cover (section 8.6): axis-aligned scale to the viewport, centered. The layer's
        // continuous rotation does not apply to a viewport fill.
        sprite.position.set(this.viewportWidth * 0.5, this.viewportHeight * 0.5);
        sprite.rotation = 0;
        sprite.scale.set(this.viewportWidth, this.viewportHeight);
      } else {
        // World space: place the quad at the anchor origin, spun by the anchor rotation plus the layer's
        // own continuous rotation, scaled by the solved over-life scale (uniform).
        const anchor = view.anchor;
        sprite.position.set(anchor[4], anchor[5]);
        sprite.rotation = (getRotationDeg(anchor) + view.rotationDeg) * DEG_TO_RAD;
        sprite.scale.set(view.scale);
      }
    }
  }

  // Resolve an emitter's particle textures once: a single entry for a static region, or one per animated
  // frame region (the frame index the solve emits selects among them). A region with no texture resolves
  // to Texture.WHITE (placeholder), matching the SkeletonView partial-atlas behavior.
  private resolveParticleTextures(layer: EmitterLayer): Texture[] {
    const texture: ParticleTexture = layer.texture;
    if (texture.kind === 'static') return [this.resolve(texture.region) ?? Texture.WHITE];
    return texture.regions.map((region) => this.resolve(region) ?? Texture.WHITE);
  }

  private resolve(region: string): Texture | null {
    return this.resolver?.(region) ?? null;
  }
}

// Pack a [0, 1] RGB triple to 0xRRGGBB (the sprite-animator tint; particles use packTint via the batch).
function packRgb(r: number, g: number, b: number): number {
  const to8 = (c: number): number => Math.max(0, Math.min(255, Math.round(c * 255)));
  return (to8(r) << 16) | (to8(g) << 8) | to8(b);
}
