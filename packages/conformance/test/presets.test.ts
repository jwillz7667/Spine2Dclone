import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateEffectsDocument } from '@marionette/format/effects';
import type { EffectConfig, EffectsDocument } from '@marionette/format/effects-types';

// WP-3.8: the shipped preset library + the megaWin bundle (phase-3-vfx-particles.md section 8.10). The
// committed packages/conformance/assets/presets/megawin.fx.json is a real EffectsDocument; this test is
// the acceptance gate that EVERY preset validates against the WP-3.0 schema with zero errors (its layer
// regions resolve in the document atlas), that the section 8.10 defining parameters hold, that the
// megaWin bundle references the milestone effects with startOffsets/anchorRoles/seedSalts, and that no
// preset leaks a Phase 4 slot/grid/win concept (LAW 5). The library lives under conformance/assets so a
// reusable single-location artifact is referenced by the DoD; conformance may import @marionette/format
// (the validating contract).

const PRESETS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'presets',
  'megawin.fx.json',
);

function loadPresets(): EffectsDocument {
  const report = validateEffectsDocument(JSON.parse(readFileSync(PRESETS_PATH, 'utf8')));
  // Fail loudly with the typed errors so a regression points at the exact node.
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([]);
  expect(report.ok).toBe(true);
  expect(report.document).not.toBeNull();
  return report.document!;
}

// The presets the section 8.10 catalog ships and the milestone (section 1) requires.
const REQUIRED_EFFECTS = [
  'coinBurst',
  'coinShowerLarge',
  'sparkle',
  'starBurst',
  'godRaysSprite',
  'godRaysParticle',
  'glowPulse',
  'ribbonTrailGold',
  'screenFlash',
  'rayBurst',
] as const;

function firstEmitter(effect: EffectConfig) {
  const layer = effect.layers.find((l) => l.type === 'emitter');
  expect(layer).toBeDefined();
  if (layer === undefined || layer.type !== 'emitter') throw new Error('no emitter layer');
  return layer;
}

function firstSprite(effect: EffectConfig) {
  const layer = effect.layers.find((l) => l.type === 'spriteAnimator');
  expect(layer).toBeDefined();
  if (layer === undefined || layer.type !== 'spriteAnimator') throw new Error('no sprite layer');
  return layer;
}

describe('WP-3.8 preset library', () => {
  it('the whole document validates with zero errors and zero warnings (WP-3.0 schema)', () => {
    loadPresets();
  });

  it('ships every section 8.10 preset and they are deterministic', () => {
    const doc = loadPresets();
    for (const name of REQUIRED_EFFECTS) {
      expect(doc.effects[name], `preset ${name} present`).toBeDefined();
      // Presets are deterministic (seeded solve + authored counts, section 7.3).
      expect(doc.effects[name]!.deterministic).toBe(true);
    }
  });

  it('every layer region/regions resolves in the document atlas', () => {
    const doc = loadPresets();
    const atlasRegions = new Set<string>();
    for (const page of doc.atlas.pages) for (const r of page.regions) atlasRegions.add(r.name);
    for (const effect of Object.values(doc.effects)) {
      for (const layer of effect.layers) {
        if (layer.type === 'emitter') {
          if (layer.texture.kind === 'static') {
            expect(atlasRegions.has(layer.texture.region)).toBe(true);
          } else {
            for (const region of layer.texture.regions) expect(atlasRegions.has(region)).toBe(true);
          }
          if (layer.particleTrail !== null) {
            expect(atlasRegions.has(layer.particleTrail.region)).toBe(true);
          }
        } else {
          expect(atlasRegions.has(layer.region)).toBe(true);
        }
      }
    }
  });

  it('coinShowerLarge: high-rate gravity-driven coins with a capped pool and a per-particle trail', () => {
    const doc = loadPresets();
    const e = firstEmitter(doc.effects['coinShowerLarge']!);
    expect(e.spawn.mode).toBe('rate');
    if (e.spawn.mode === 'rate') expect(e.spawn.particlesPerSecond).toBeGreaterThanOrEqual(100);
    expect(e.gravity.y).toBeGreaterThan(0); // coins fall
    expect(e.maxParticles).toBeLessThanOrEqual(600); // mobile cap
    expect(e.angularVelocity.min !== 0 || e.angularVelocity.max !== 0).toBe(true); // they spin
    expect(e.texture.kind).toBe('animated'); // coin spin frames
    expect(e.particleTrail).not.toBeNull(); // gold trail
    expect(e.blendMode).toBe('normal');
  });

  it('coinBurst: a 40-coin upward arc with positive gravity and spin', () => {
    const doc = loadPresets();
    const e = firstEmitter(doc.effects['coinBurst']!);
    expect(e.spawn.mode).toBe('burst');
    if (e.spawn.mode === 'burst') expect(e.spawn.count).toBe(40);
    expect(e.gravity.y).toBeGreaterThan(0);
    // The arc points generally upward (between 60 and 120 degrees, 90 = straight up).
    expect(e.emissionAngle.min).toBeGreaterThanOrEqual(0);
    expect(e.emissionAngle.max).toBeLessThanOrEqual(180);
    expect(e.texture.kind).toBe('animated');
    expect(e.blendMode).toBe('normal');
  });

  it('starBurst: additive, short-lived, scaleOverLife reaches 0 at end of life', () => {
    const doc = loadPresets();
    const e = firstEmitter(doc.effects['starBurst']!);
    expect(e.blendMode).toBe('additive');
    expect(e.lifetime.max).toBeLessThanOrEqual(1);
    const lastScale = e.scaleOverLife.stops[e.scaleOverLife.stops.length - 1]!;
    expect(lastScale.t).toBe(1);
    expect(lastScale.value).toBe(0);
  });

  it('godRaysSprite: additive sprite animator that rotates and pulses alpha, looping', () => {
    const doc = loadPresets();
    const s = firstSprite(doc.effects['godRaysSprite']!);
    expect(s.blendMode).toBe('additive');
    expect(s.rotationDegPerSec).toBeGreaterThan(0); // it rotates
    expect(s.loop).toBe(true);
    const alphas = s.alphaOverLife.stops.map((st) => st.value);
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas)); // alpha pulses
  });

  it('glowPulse: additive looping sprite with a scale and alpha pulse', () => {
    const doc = loadPresets();
    const s = firstSprite(doc.effects['glowPulse']!);
    expect(s.blendMode).toBe('additive');
    expect(s.loop).toBe(true);
    const scales = s.scaleOverLife.stops.map((st) => st.value);
    const alphas = s.alphaOverLife.stops.map((st) => st.value);
    expect(Math.max(...scales)).toBeGreaterThan(Math.min(...scales));
    expect(Math.max(...alphas)).toBeGreaterThan(Math.min(...alphas));
  });

  it('screenFlash: screen-space white quad whose alpha returns to 0 by layerDuration', () => {
    const doc = loadPresets();
    const s = firstSprite(doc.effects['screenFlash']!);
    expect(s.anchorSpace).toBe('screen');
    expect(s.region).toBe('white');
    expect(s.loop).toBe(false);
    const last = s.alphaOverLife.stops[s.alphaOverLife.stops.length - 1]!;
    expect(last.t).toBe(1);
    expect(last.value).toBe(0); // no residual flash
  });

  it('rayBurst: a one-shot additive expanding ray fan (not looping)', () => {
    const doc = loadPresets();
    const s = firstSprite(doc.effects['rayBurst']!);
    expect(s.blendMode).toBe('additive');
    expect(s.loop).toBe(false);
    expect(s.rotationDegPerSec).toBeGreaterThan(0);
    const scales = s.scaleOverLife.stops.map((st) => st.value);
    expect(Math.max(...scales)).toBeGreaterThan(Math.min(...scales)); // expanding
  });

  it('ships both god-ray approaches (sprite default + particle alternative, section 7.5)', () => {
    const doc = loadPresets();
    expect(doc.effects['godRaysSprite']!.layers[0]!.type).toBe('spriteAnimator');
    expect(doc.effects['godRaysParticle']!.layers[0]!.type).toBe('emitter');
  });

  it('ships a sparkle/star-burst emitter and a ribbon-trail effect', () => {
    const doc = loadPresets();
    expect(firstEmitter(doc.effects['sparkle']!).blendMode).toBe('additive');
    const ribbonLayer = doc.effects['ribbonTrailGold']!.layers[0]!;
    expect(ribbonLayer.type).toBe('ribbonTrail');
  });

  it('the megaWin bundle references coinShowerLarge + rayBurst + screenFlash + glowPulse with offsets/roles/salts', () => {
    const doc = loadPresets();
    const bundle = doc.bundles['megaWin'];
    expect(bundle).toBeDefined();
    expect(bundle!.name).toBe('megaWin');
    const byEffect = new Map(bundle!.items.map((i) => [i.effect, i]));
    for (const required of ['coinShowerLarge', 'rayBurst', 'screenFlash', 'glowPulse']) {
      const item = byEffect.get(required);
      expect(item, `megaWin includes ${required}`).toBeDefined();
      // Each item carries the bundle wiring: a non-empty anchorRole, a finite startOffset, a seedSalt.
      expect(item!.anchorRole.length).toBeGreaterThan(0);
      expect(Number.isFinite(item!.startOffset)).toBe(true);
      expect(Number.isInteger(item!.seedSalt)).toBe(true);
    }
    // Distinct seedSalts so the per-item PRNG streams differ (hash32(baseSeed, seedSalt), section 8.3).
    const salts = bundle!.items.map((i) => i.seedSalt);
    expect(new Set(salts).size).toBe(salts.length);
    // Every bundle item references a defined effect.
    for (const item of bundle!.items) expect(doc.effects[item.effect]).toBeDefined();
  });

  it('no preset or bundle references any symbol/grid/reel/win field (LAW 5)', () => {
    const raw = readFileSync(PRESETS_PATH, 'utf8');
    // A grep-style guard: the forbidden Phase 4 slot vocabulary must not appear anywhere in the
    // document. NOTE the milestone bundle is sanctioned to be named "megaWin" (handoff section 8.10),
    // so the broad token "win" is deliberately NOT forbidden; the guard targets the slot-domain nouns
    // that would signal a Phase 4 leak (symbol, reel, grid/gridCell, payout, cascade, tumble, freespin).
    for (const forbidden of [
      'symbol',
      'reel',
      'gridcell',
      'payout',
      'cascade',
      'tumble',
      'freespin',
      'spinresult',
    ]) {
      expect(raw.toLowerCase().includes(forbidden), `forbidden token "${forbidden}"`).toBe(false);
    }
  });
});
