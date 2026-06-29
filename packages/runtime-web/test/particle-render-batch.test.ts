import { describe, expect, it } from 'vitest';
import { Sprite, Texture } from 'pixi.js';
import { EffectSystem, getRotationDeg, transformPoint } from '@marionette/runtime-core';
import type { EffectAnchor } from '@marionette/runtime-core';
import type { EffectsDocument } from '@marionette/format/types';
import { blendModeToPixi, fillEmitterBatch, makeParticleRenderBatch } from '../src';
import { packTint } from '../src/scene/attachment-sprites';

// WP-3.5 (the CI-verifiable slice): the format-BlendMode -> PixiJS mapping and the pure SoA ->
// render-instance bridge. The actual GL draw (pooled ParticleContainer sprites, the MeshRope ribbon, the
// offscreen pixel sample of section 12.2 step 6) needs a WebGL context and is not exercised headlessly;
// what IS verifiable here is (a) the single blend mapping the slot and particle paths share, and (b) the
// bridge that turns an EffectSystem emitter view into the flat per-instance arrays the uploader consumes,
// including its correctness against runtime-core's solved state and its allocation-free reuse.

const DT = 1 / 60;

// A minimal one-emitter effect with motion (non-zero speed) so per-particle positions diverge and the
// anchor transform is genuinely exercised. Built inline (runtime-web does not depend on the conformance
// preset library); the runtime-core solve never reads the atlas, so an empty pack suffices.
function oneEmitterDoc(): EffectsDocument {
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
  return {
    effectsFormatVersion: '1.0.0',
    name: 'render-batch-probe',
    hash: '',
    atlas: { pages: [] },
    effects: {
      burst: {
        name: 'burst',
        duration: null,
        deterministic: true,
        simulationDt: DT,
        blendMode: 'additive',
        layers: [
          {
            type: 'emitter',
            name: 'p',
            blendMode: 'additive',
            maxParticles: 64,
            spawn: { mode: 'burst', count: 20, atTime: 0 },
            shape: { kind: 'circle', radius: 6, edgeOnly: false },
            lifetime: { min: 2, max: 4 },
            startSpeed: { min: 40, max: 120 },
            emissionAngle: { min: 0, max: 360 },
            startRotation: { min: 0, max: 0 },
            angularVelocity: { min: -90, max: 90 },
            startScale: { min: 0.5, max: 1.5 },
            gravity: { x: 0, y: 200 },
            acceleration: { x: 0, y: 0 },
            drag: 0,
            scaleOverLife: flat(1),
            colorOverLife: flatRgb(0.8, 0.6, 0.2),
            alphaOverLife: flat(1),
            texture: { kind: 'static', region: 'coin' },
            particleTrail: null,
          },
        ],
      },
    },
    bundles: {},
  };
}

describe('WP-3.5 blendModeToPixi (one shared mapping, section 7.4)', () => {
  it('maps the four format blend modes to the PixiJS v8 blend strings', () => {
    expect(blendModeToPixi('normal')).toBe('normal');
    expect(blendModeToPixi('additive')).toBe('add');
    expect(blendModeToPixi('multiply')).toBe('multiply');
    expect(blendModeToPixi('screen')).toBe('screen');
  });

  it('produces a value a PixiJS Sprite accepts on its blendMode setter (the same constant slots use)', () => {
    // The slot renderer and the particle renderer both call blendModeToPixi (no second blend path), so
    // asserting the mapped value round-trips through a real Sprite.blendMode proves both paths set a
    // valid, identical PixiJS constant. Constructing a Sprite needs no GL context (Node is sufficient).
    const sprite = new Sprite(Texture.WHITE);
    sprite.blendMode = blendModeToPixi('additive');
    expect(sprite.blendMode).toBe('add');
    sprite.blendMode = blendModeToPixi('screen');
    expect(sprite.blendMode).toBe('screen');
  });
});

describe('WP-3.5 fillEmitterBatch (pure SoA -> render-instance bridge)', () => {
  // A non-identity anchor (translation + 90 degree rotation) so the per-particle anchor apply is real.
  const ANCHOR: EffectAnchor = { space: 'world', x: 100, y: 50, rotation: 90 };

  function steppedView() {
    const sys = new EffectSystem(oneEmitterDoc());
    sys.trigger({ effect: 'burst', anchor: ANCHOR, seed: 42, startTime: 0 });
    for (let i = 0; i < 20; i += 1) sys.step(DT);
    const frame = sys.readState();
    const view = frame.instances[0]!.emitters[0]!;
    return view;
  }

  it('writes exactly liveCount entries, densely packed', () => {
    const view = steppedView();
    const batch = makeParticleRenderBatch(view.capacity);
    const count = fillEmitterBatch(batch, view);
    expect(count).toBe(view.liveCount);
    expect(batch.count).toBe(view.liveCount);
    expect(count).toBeGreaterThan(0); // the burst actually produced live particles
  });

  it('world positions equal the anchor applied to runtime-core local positions', () => {
    const view = steppedView();
    const batch = makeParticleRenderBatch(view.capacity);
    fillEmitterBatch(batch, view);
    const anchorRot = getRotationDeg(view.anchor);
    // Recompute expected values in the SAME slot order fillEmitterBatch packs (ascending slot index).
    let out = 0;
    for (let s = 0; s < view.capacity; s += 1) {
      if (view.alive[s] === 0) continue;
      const [wx, wy] = transformPoint(view.anchor, view.px[s]!, view.py[s]!);
      expect(batch.x[out]).toBeCloseTo(wx, 10);
      expect(batch.y[out]).toBeCloseTo(wy, 10);
      expect(batch.rotationDeg[out]).toBeCloseTo(view.rot[s]! + anchorRot, 10);
      expect(batch.scale[out]).toBe(view.outScale[s]!);
      expect(batch.alpha[out]).toBe(view.outAlpha[s]!);
      expect(batch.frame[out]).toBe(view.frame[s]!);
      expect(batch.tint[out]).toBe(packTint(view.outR[s]!, view.outG[s]!, view.outB[s]!));
      out += 1;
    }
    expect(out).toBe(batch.count);
  });

  it('reuses its pre-allocated buffers across frames (no per-frame allocation)', () => {
    const view = steppedView();
    const batch = makeParticleRenderBatch(view.capacity);
    fillEmitterBatch(batch, view);
    // Buffer identity is the precise statement of the no-realloc invariant (the runtime-web convention,
    // since this worker is not launched with --expose-gc). Re-filling must not swap the typed arrays.
    const xRef = batch.x;
    const tintRef = batch.tint;
    const first = Array.from(batch.x.subarray(0, batch.count));
    fillEmitterBatch(batch, view);
    expect(batch.x).toBe(xRef);
    expect(batch.tint).toBe(tintRef);
    // Identical solved state in -> identical instance arrays out (deterministic bridge).
    expect(Array.from(batch.x.subarray(0, batch.count))).toEqual(first);
  });
});
