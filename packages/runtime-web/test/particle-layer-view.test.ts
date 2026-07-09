import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { DEG_TO_RAD, EffectSystem, getRotationDeg, transformPoint } from '@marionette/runtime-core';
import type { BoneAnchorResolver, EffectAnchor, Mat2x3 } from '@marionette/runtime-core';
import type { EffectsDocument } from '@marionette/format/types';
import {
  ParticleLayerView,
  buildStripIndices,
  buildStripUVs,
  fillStripPositions,
  makeRegionTextureResolver,
  stripBufferLength,
} from '../src';
import { makeSolidTexture } from './texture-fixtures';

// PP-C3 GL particle rendering. The pure ribbon-strip bridge and the ParticleLayerView reconciliation /
// pooling / transform / blend / release logic are exercised headlessly (PixiJS display objects construct
// without a WebGL context). The actual GPU upload / shading is the GL edge and is not exercised here.

const DT = 1 / 60;

const flat = (v: number) => ({
  stops: [
    { t: 0, value: v, curve: 'linear' as const },
    { t: 1, value: v, curve: 'linear' as const },
  ],
});
const flatRgb = (r: number, g: number, b: number) => ({
  stops: [
    { t: 0, value: { r, g, b }, curve: 'linear' as const },
    { t: 1, value: { r, g, b }, curve: 'linear' as const },
  ],
});

// An effect with all three layer kinds so the view exercises the emitter pool, the ribbon strip, and the
// sprite-animator quad in one instance. The emitter uses a world anchor (static); the ribbon follows a
// bone anchor so a moving resolver produces multiple strip points.
function allLayersDoc(): EffectsDocument {
  return {
    effectsFormatVersion: '1.0.0',
    name: 'all-layers-probe',
    hash: '',
    atlas: { pages: [] },
    effects: {
      combo: {
        name: 'combo',
        duration: null,
        deterministic: true,
        simulationDt: DT,
        blendMode: 'additive',
        layers: [
          {
            type: 'emitter',
            name: 'sparks',
            blendMode: 'additive',
            maxParticles: 32,
            spawn: { mode: 'burst', count: 12, atTime: 0 },
            shape: { kind: 'circle', radius: 4, edgeOnly: false },
            lifetime: { min: 2, max: 4 },
            startSpeed: { min: 30, max: 80 },
            emissionAngle: { min: 0, max: 360 },
            startRotation: { min: 0, max: 0 },
            angularVelocity: { min: -45, max: 45 },
            startScale: { min: 1, max: 1 },
            gravity: { x: 0, y: 100 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: flat(1),
            colorOverLife: flatRgb(1, 0.5, 0.2),
            alphaOverLife: flat(1),
            texture: { kind: 'static', region: 'spark' },
            particleTrail: null,
          },
          {
            type: 'ribbonTrail',
            name: 'trail',
            blendMode: 'screen',
            region: 'trail-tex',
            anchorRef: 'tip',
            maxSegments: 16,
            segmentSpacing: 1,
            widthOverLength: flat(10),
            colorOverLength: flatRgb(0.2, 0.8, 1),
            alphaOverLength: flat(1),
          },
          {
            type: 'spriteAnimator',
            name: 'flash',
            blendMode: 'screen',
            region: 'flash-tex',
            anchorSpace: 'screen',
            rotationDegPerSec: 0,
            scaleOverLife: flat(2),
            colorOverLife: flatRgb(1, 1, 1),
            alphaOverLife: flat(0.5),
            loop: true,
            layerDuration: 1,
          },
        ],
      },
    },
    bundles: {},
  };
}

// A bone-anchor resolver that translates along +x by `step` each time it is queried (once per frame), so
// the ribbon records a fresh point each frame and the strip grows past two points.
function movingBoneResolver(step: number): BoneAnchorResolver {
  let x = 0;
  return () => {
    x += step;
    return [1, 0, 0, 1, x, 0] as Mat2x3;
  };
}

describe('PP-C3 ribbon-strip pure bridge', () => {
  it('winds strip triangle indices for each quad between consecutive points', () => {
    const indices = buildStripIndices(3); // 2 quads => 12 indices
    expect(Array.from(indices)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    expect(buildStripIndices(1).length).toBe(0); // a single point has no quad
  });

  it('assigns UVs running head-to-tail (u) across the left (v=0) and right (v=1) edges', () => {
    const uvs = buildStripUVs(3);
    expect(Array.from(uvs)).toEqual([0, 0, 0, 1, 0.5, 0, 0.5, 1, 1, 0, 1, 1]);
  });

  it('fills live strip positions and collapses the unused tail onto the last vertex', () => {
    const maxPoints = 4;
    const positions = new Float32Array(stripBufferLength(maxPoints)); // 16 floats
    const view = {
      vertexCount: 2,
      vx: new Float64Array([1, 2, 3, 4, 0, 0, 0, 0]), // left/right interleaved: L0=1 R0=2 L1=3 R1=4
      vy: new Float64Array([5, 6, 7, 8, 0, 0, 0, 0]),
    } as unknown as Parameters<typeof fillStripPositions>[1];

    const count = fillStripPositions(positions, view);
    expect(count).toBe(2);
    // First two points written verbatim.
    expect(Array.from(positions.subarray(0, 8))).toEqual([1, 5, 2, 6, 3, 7, 4, 8]);
    // The remaining 8 floats collapse onto the last written vertex (4, 8): degenerate, invisible.
    expect(Array.from(positions.subarray(8))).toEqual([4, 8, 4, 8, 4, 8, 4, 8]);
  });

  it('collapses everything to the origin when there are no live points', () => {
    const positions = new Float32Array(stripBufferLength(2)).fill(9);
    const view = {
      vertexCount: 0,
      vx: new Float64Array(4),
      vy: new Float64Array(4),
    } as unknown as Parameters<typeof fillStripPositions>[1];
    expect(fillStripPositions(positions, view)).toBe(0);
    expect(Array.from(positions)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('PP-C3 ParticleLayerView pooling and transforms', () => {
  function steppedSystem(steps: number): EffectSystem {
    // A moving bone anchor so the emitter particles get a real anchor transform AND the ribbon (which
    // follows the INSTANCE anchor, section 8.4) records a fresh point each frame and grows past two points.
    const sys = new EffectSystem(allLayersDoc(), { resolveBone: movingBoneResolver(5) });
    const anchor: EffectAnchor = { space: 'bone', skeletonInstanceId: 'hero', pointOrBone: 'tip' };
    sys.trigger({ effect: 'combo', anchor, seed: 7, startTime: 0 });
    for (let i = 0; i < steps; i += 1) sys.step(DT);
    return sys;
  }

  it('pools one sprite per emitter capacity and shows exactly the live count', () => {
    const sys = steppedSystem(10);
    const frame = sys.readState();
    const emitterView = frame.instances[0]!.emitters[0]!;

    const view = new ParticleLayerView();
    view.update(frame);

    const emitter = view.describe().instances[0]!.emitters[0]!;
    expect(emitter.capacity).toBe(emitterView.capacity); // pool sized to the emitter capacity
    expect(emitter.capacity).toBe(32);
    expect(emitter.liveCount).toBe(emitterView.liveCount);
    expect(emitter.liveCount).toBeGreaterThan(0);
    expect(emitter.particles).toHaveLength(emitter.liveCount);
    expect(emitter.blendMode).toBe('add'); // additive -> the one blendModeToPixi mapping
  });

  it('places each live particle at the anchor-applied world transform the batch computes', () => {
    const sys = steppedSystem(10);
    const frame = sys.readState();
    const emitterView = frame.instances[0]!.emitters[0]!;
    const anchorRot = getRotationDeg(emitterView.anchor);

    const view = new ParticleLayerView();
    view.update(frame);
    const rendered = view.describe().instances[0]!.emitters[0]!.particles;

    let out = 0;
    for (let s = 0; s < emitterView.capacity; s += 1) {
      if (emitterView.alive[s] === 0) continue;
      const [wx, wy] = transformPoint(emitterView.anchor, emitterView.px[s]!, emitterView.py[s]!);
      const p = rendered[out]!;
      expect(p.x).toBeCloseTo(wx, 9);
      expect(p.y).toBeCloseTo(wy, 9);
      expect(p.rotation).toBeCloseTo((emitterView.rot[s]! + anchorRot) * DEG_TO_RAD, 9);
      expect(p.scale).toBeCloseTo(emitterView.outScale[s]!, 9);
      out += 1;
    }
    expect(out).toBe(rendered.length);
  });

  it('draws the ribbon as a strip once the moving anchor records at least two points', () => {
    const sys = steppedSystem(6); // several frames => several recorded trail points
    const view = new ParticleLayerView();
    view.update(sys.readState());

    const ribbon = view.describe().instances[0]!.ribbons[0]!;
    expect(ribbon.blendMode).toBe('screen');
    expect(ribbon.pointCount).toBeGreaterThanOrEqual(2);
  });

  it('covers the viewport for a screen-space sprite animator', () => {
    const sys = steppedSystem(4);
    const view = new ParticleLayerView();
    view.setViewport(800, 600);
    view.update(sys.readState());

    const sprite = view.describe().instances[0]!.sprites[0]!;
    expect(sprite.anchorSpace).toBe('screen');
    expect(sprite.x).toBe(400);
    expect(sprite.y).toBe(300);
    expect(sprite.scaleX).toBe(800);
    expect(sprite.scaleY).toBe(600);
    expect(sprite.alpha).toBeCloseTo(0.5, 9); // alphaOverLife flat(0.5)
    expect(sprite.blendMode).toBe('screen');
  });

  it('binds resolved particle textures and falls back to the placeholder for an unknown region', () => {
    const sys = steppedSystem(6);
    const sparkTex = makeSolidTexture(8, 8);
    const view = new ParticleLayerView(
      makeRegionTextureResolver(new Map([['spark', sparkTex]])),
    );
    view.update(sys.readState());
    // The emitter's live sprites carry the resolved texture; the ribbon / flash regions are unknown, so
    // those fall back to Texture.WHITE. We assert via the live emitter container child.
    const instance = view.root.children[0]!;
    const emitterContainer = instance.children.find((c) => c.children.length > 0)!;
    const firstVisible = emitterContainer.children.find((c) => c.visible)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((firstVisible as any).texture).toBe(sparkTex);
  });

  it('releases an instance binding when the effect finishes', () => {
    const sys = new EffectSystem(allLayersDoc(), { resolveBone: movingBoneResolver(5) });
    const id = sys.trigger({
      effect: 'combo',
      anchor: { space: 'world', x: 0, y: 0, rotation: 0 },
      seed: 1,
      startTime: 0,
    });
    const view = new ParticleLayerView();
    for (let i = 0; i < 5; i += 1) sys.step(DT);
    view.update(sys.readState());
    expect(view.describe().instances).toHaveLength(1);
    expect(view.root.children).toHaveLength(1);

    // Hard-stop and step: the EffectSystem reclaims the instance, so the next update releases its binding.
    sys.stop(id, true);
    sys.step(DT);
    view.update(sys.readState());
    expect(view.describe().instances).toHaveLength(0);
    expect(view.root.children).toHaveLength(0);
  });

  it('reuses pools and batches across steady-state frames (no per-frame reallocation)', () => {
    const sys = steppedSystem(10);
    const view = new ParticleLayerView();
    view.update(sys.readState());

    const instance = view.root.children[0]!;
    const beforeChildCount = instance.children.length;
    // Descend to the emitter container and capture its sprite pool array + a specific sprite identity.
    const emitterContainer = instance.children.find((c) => c.children.length >= 32)!;
    const poolRef = emitterContainer.children;
    const firstSprite = poolRef[0]!;

    // Advance the system and re-update several times; the same live instance must not rebuild any pool.
    for (let i = 0; i < 5; i += 1) {
      sys.step(DT);
      view.update(sys.readState());
    }

    expect(view.root.children[0]).toBe(instance); // same instance binding root
    expect(instance.children.length).toBe(beforeChildCount); // no new layer objects
    expect(emitterContainer.children).toBe(poolRef); // same pool array
    expect(emitterContainer.children[0]).toBe(firstSprite); // same pooled sprite identity
    expect(emitterContainer.children).toHaveLength(32); // never grown past capacity
  });

  it('rebinds textures when the resolver changes and never mutates Texture.WHITE identity', () => {
    const sys = steppedSystem(6);
    const view = new ParticleLayerView();
    view.update(sys.readState());
    // Default (no resolver): placeholder.
    const instance = view.root.children[0]!;
    const emitterContainer = instance.children.find((c) => c.children.length >= 32)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((emitterContainer.children.find((c) => c.visible) as any).texture).toBe(Texture.WHITE);

    const sparkTex = makeSolidTexture(8, 8);
    view.setTextureResolver(makeRegionTextureResolver(new Map([['spark', sparkTex]])));
    view.update(sys.readState());
    const rebuilt = view.root.children[0]!;
    const rebuiltEmitter = rebuilt.children.find((c) => c.children.length >= 32)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((rebuiltEmitter.children.find((c) => c.visible) as any).texture).toBe(sparkTex);
  });
});
