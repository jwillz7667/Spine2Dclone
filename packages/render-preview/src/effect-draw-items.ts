import type { EffectLayer, EffectsDocument, EmitterLayer } from '@marionette/format/effects-types';
import {
  getRotationDeg,
  screenCoverTransformInto,
  transformPoint,
  type Mat2x3,
  type ReadonlyEffectFrame,
  type ReadonlyEmitterView,
  type ReadonlyRibbonView,
  type ReadonlySpriteView,
} from '@marionette/runtime-core';
import type { AtlasIndex, TextureSampler } from './atlas';
import type { Color } from './color';
import { EFFECT_QUAD_TRIANGLES, EFFECT_QUAD_UVS, quadCorners } from './effect-geometry';
import type { Viewport } from './viewport';
import type { BlendMode } from '@marionette/format/types';

// Turn a solved effect frame (runtime-core ReadonlyEffectFrame) into flat draw items the CPU rasterizer
// composites. This is the render-preview counterpart of runtime-web's SoA -> instance bridge
// (particle-render-batch.ts fillEmitterBatch): the SAME mapping of pool state to a per-instance quad
// (world position via the anchor, rotation = particle rot + anchor rotation, scale = solved outScale,
// tint = outR/outG/outB, alpha = outAlpha), then sized to the region's base pixel size to become a world
// quad. We do not import runtime-web (it pulls PixiJS, ADR-0006); the mapping is reproduced against
// runtime-core only, with particle-render-batch cited as the parity source of truth. The solve stays
// 100% in runtime-core (we only READ readState()); nothing here re-implements emission or motion math.

// One drawable primitive for the effects pass. `space` distinguishes world-space geometry (particles,
// world sprites, ribbons; positions in world units, mapped through the viewport transform) from
// screen-space geometry (an anchorSpace:'screen' sprite; positions are already image pixels and bypass
// the world transform). `order` is the layer's index within its owning effect, so a single effect's
// layers draw in authored array order regardless of the emitter/sprite/ribbon grouping in readState.
export interface EffectDrawItem {
  readonly space: 'world' | 'screen';
  readonly positions: readonly number[];
  readonly uvs: readonly number[];
  readonly triangles: readonly number[];
  readonly tint: Color;
  readonly alpha: number;
  readonly blend: BlendMode;
  readonly sampler: TextureSampler;
  readonly order: number;
}

// Map every layer object in the document to its index within its owning effect. readState groups solved
// views by kind (emitters/sprites/ribbons), losing the authored layer order; this restores it so an
// effect's layers composite in array order (format section 8.1: layers draw in array order). Object
// identity is stable because prepare*/EffectSystem hold the SAME layer reference the document carries.
export function buildLayerOrder(doc: EffectsDocument): Map<EffectLayer, number> {
  const order = new Map<EffectLayer, number>();
  for (const effect of Object.values(doc.effects)) {
    effect.layers.forEach((layer, index) => order.set(layer, index));
  }
  return order;
}

// The atlas region name of an emitter particle's current animated frame (static textures always use their
// single region; animated textures index regions[] by the solved integer frame, clamped defensively).
function emitterRegionName(layer: EmitterLayer, frameIndex: number): string {
  const texture = layer.texture;
  if (texture.kind === 'static') return texture.region;
  const last = texture.regions.length - 1;
  const index = frameIndex < 0 ? 0 : frameIndex > last ? last : frameIndex;
  return texture.regions[index]!;
}

// Push one emitter's live particles as world quads. Mirrors fillEmitterBatch exactly: world position is
// the anchor applied to the anchor-local (px, py); the sprite rotation is the particle rotation plus the
// anchor's rotation; the scale is the solved outScale; the tint is (outR, outG, outB) and the alpha is
// outAlpha. The region's base pixel size then turns the scaled unit quad into a world quad.
function pushEmitterItems(
  view: ReadonlyEmitterView,
  atlas: AtlasIndex,
  order: number,
  out: EffectDrawItem[],
): void {
  const anchor = view.anchor;
  const anchorRotDeg = getRotationDeg(anchor);
  const blend = view.layer.blendMode;
  for (let s = 0; s < view.capacity; s += 1) {
    if (view.alive[s] === 0) continue;
    const regionName = emitterRegionName(view.layer, view.frame[s]!);
    const size = atlas.regionSize(regionName);
    if (size === null) continue;
    const [cx, cy] = transformPoint(anchor, view.px[s]!, view.py[s]!);
    const scale = view.outScale[s]!;
    const halfW = 0.5 * size.width * scale;
    const halfH = 0.5 * size.height * scale;
    out.push({
      space: 'world',
      positions: quadCorners(cx, cy, halfW, halfH, view.rot[s]! + anchorRotDeg),
      uvs: EFFECT_QUAD_UVS,
      triangles: EFFECT_QUAD_TRIANGLES,
      tint: { r: view.outR[s]!, g: view.outG[s]!, b: view.outB[s]!, a: 1 },
      alpha: view.outAlpha[s]!,
      blend,
      sampler: atlas.resolve(regionName),
      order,
    });
  }
}

// Push one sprite-animator layer as a single quad. A `world` sprite is placed at the resolved anchor
// (origin), rotated by its continuous spin plus the anchor rotation, sized to the region base times the
// solved scale. A `screen` sprite covers the whole viewport via screenCoverTransformInto (section 8.6):
// its corners are image pixels, so it bypasses the world -> image transform (space: 'screen').
function pushSpriteItem(
  view: ReadonlySpriteView,
  atlas: AtlasIndex,
  viewport: Viewport,
  order: number,
  out: EffectDrawItem[],
): void {
  const layer = view.layer;
  const size = atlas.regionSize(layer.region);
  if (size === null) return;
  const tint: Color = { r: view.r, g: view.g, b: view.b, a: 1 };
  if (layer.anchorSpace === 'screen') {
    const cover = new Float64Array(6);
    screenCoverTransformInto(cover, 0, viewport.width, viewport.height);
    const mat: Mat2x3 = [cover[0]!, cover[1]!, cover[2]!, cover[3]!, cover[4]!, cover[5]!];
    const corners = [
      transformPoint(mat, -0.5, -0.5),
      transformPoint(mat, 0.5, -0.5),
      transformPoint(mat, 0.5, 0.5),
      transformPoint(mat, -0.5, 0.5),
    ];
    const positions: number[] = [];
    for (const corner of corners) positions.push(corner[0], corner[1]);
    out.push({
      space: 'screen',
      positions,
      uvs: EFFECT_QUAD_UVS,
      triangles: EFFECT_QUAD_TRIANGLES,
      tint,
      alpha: view.alpha,
      blend: layer.blendMode,
      sampler: atlas.resolve(layer.region),
      order,
    });
    return;
  }
  const anchor = view.anchor;
  const [cx, cy] = transformPoint(anchor, 0, 0);
  const halfW = 0.5 * size.width * view.scale;
  const halfH = 0.5 * size.height * view.scale;
  out.push({
    space: 'world',
    positions: quadCorners(cx, cy, halfW, halfH, view.rotationDeg + getRotationDeg(anchor)),
    uvs: EFFECT_QUAD_UVS,
    triangles: EFFECT_QUAD_TRIANGLES,
    tint,
    alpha: view.alpha,
    blend: layer.blendMode,
    sampler: atlas.resolve(layer.region),
    order,
  });
}

// Push one ribbon layer as a triangle-strip (two triangles per segment between consecutive recorded
// points). buildRibbonStrip (run inside EffectSystem.step) already writes WORLD-space strip vertices
// (the anchor is applied when the point is recorded), so ribbon geometry is world-space and needs no
// further anchor transform. The rasterizer shades per triangle with a single tint/alpha, so per-vertex
// color/alpha taper is approximated by the older (k-side) vertex's value; a flat over-length curve is
// therefore exact. Vertices are interleaved left/right: vertex 2k is the left edge, 2k+1 the right edge.
function pushRibbonItems(
  view: ReadonlyRibbonView,
  atlas: AtlasIndex,
  order: number,
  out: EffectDrawItem[],
): void {
  const points = view.vertexCount;
  if (points < 2) return;
  const sampler = atlas.resolve(view.layer.region);
  const blend = view.layer.blendMode;
  const vx = view.vx;
  const vy = view.vy;
  for (let k = 0; k < points - 1; k += 1) {
    const l0 = k * 2;
    const r0 = l0 + 1;
    const l1 = l0 + 2;
    const r1 = l0 + 3;
    const tint: Color = { r: view.vR[l0]!, g: view.vG[l0]!, b: view.vB[l0]!, a: 1 };
    const alpha = view.vAlpha[l0]!;
    // A quad L0-R0-L1-R1 as two triangles; UVs put the left edge at u=0, right at u=1, v along length.
    const va = k / (points - 1);
    const vb = (k + 1) / (points - 1);
    out.push({
      space: 'world',
      positions: [vx[l0]!, vy[l0]!, vx[r0]!, vy[r0]!, vx[l1]!, vy[l1]!],
      uvs: [0, va, 1, va, 0, vb],
      triangles: [0, 1, 2],
      tint,
      alpha,
      blend,
      sampler,
      order,
    });
    out.push({
      space: 'world',
      positions: [vx[r0]!, vy[r0]!, vx[r1]!, vy[r1]!, vx[l1]!, vy[l1]!],
      uvs: [1, va, 1, vb, 0, vb],
      triangles: [0, 1, 2],
      tint,
      alpha,
      blend,
      sampler,
      order,
    });
  }
}

// Gather every draw item for a solved effect frame, in composite order. Within one instance, items are
// sorted by the authored layer index (a stable sort preserves per-layer particle/triangle order); across
// instances the live-array order from readState is used (deterministic for a given trigger + step count;
// bundle items are additive presentation layers where order is visually order-independent). The returned
// list is ready for the rasterizer.
export function gatherEffectDrawItems(
  frame: ReadonlyEffectFrame,
  atlas: AtlasIndex,
  viewport: Viewport,
  layerOrder: ReadonlyMap<EffectLayer, number>,
): EffectDrawItem[] {
  const out: EffectDrawItem[] = [];
  for (const instance of frame.instances) {
    const instanceItems: EffectDrawItem[] = [];
    for (const emitter of instance.emitters) {
      pushEmitterItems(emitter, atlas, orderOf(layerOrder, emitter.layer), instanceItems);
    }
    for (const sprite of instance.sprites) {
      pushSpriteItem(sprite, atlas, viewport, orderOf(layerOrder, sprite.layer), instanceItems);
    }
    for (const ribbon of instance.ribbons) {
      pushRibbonItems(ribbon, atlas, orderOf(layerOrder, ribbon.layer), instanceItems);
    }
    // Stable sort by authored layer order (emitter items carry the emitter's order; a stable sort keeps
    // per-particle order within a layer). Array.prototype.sort is stable in Node 22 (V8), pinned per the
    // determinism contract.
    instanceItems.sort((a, b) => a.order - b.order);
    for (const item of instanceItems) out.push(item);
  }
  return out;
}

function orderOf(layerOrder: ReadonlyMap<EffectLayer, number>, layer: EffectLayer): number {
  return layerOrder.get(layer) ?? 0;
}
