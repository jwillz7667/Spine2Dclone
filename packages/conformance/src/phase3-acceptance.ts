import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EffectSystem, compose, expandBundle } from '@marionette/runtime-core';
import type { BoneAnchorResolver, EffectAnchor } from '@marionette/runtime-core';
import { validateEffectsDocument } from '@marionette/format/effects';
import type { EffectsDocument } from '@marionette/format/effects-types';
import { loadPerfBaseline } from './io';

// WP-3.11: the Phase 3 Definition-of-Done acceptance harness (phase-3-vfx-particles.md section 12.2).
// It automates the milestone proof entirely in TS over the runtime-core solve: load the megaWin effects
// artifact, validate it against the WP-3.0 schema (fail loudly), trigger the bundle BY NAME, and assert
// bundle expansion + timing, caps, determinism, the bone-anchor path, and the additive-blend intent.
//
// Scope honesty (section 12.2 note + TASK-3.11): the editor preview and runtime-web share the IDENTICAL
// runtime-core solve, so the "editor vs runtime-web parity" step is a WIRING check that both embeddings
// agree, NOT a cross-implementation parity proof; the real cross-runtime guarantee is the committed
// WP-3.10 fixtures, proven against native Unity/Godot in Phase 5. The offscreen GL pixel sample (section
// 12.2 step 6: the additive layer is BRIGHTER, the flash COVERS the viewport) needs a WebGL context and
// is not runnable in a headless container; this harness asserts the data-level intent (the ray/flash/glow
// layers ARE additive and the flash alpha returns to 0 by layerDuration) and flags the pixel sample as
// the deferred render-side remainder. The harness is PixiJS-free and math-bridge-free (conformance has no
// renderer dependency, LAW 1).

// The committed effects artifact under test: the shipped preset library + the megaWin bundle (WP-3.8).
const PRESETS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'presets',
  'megawin.fx.json',
);

const BUNDLE = 'megaWin';
const BASE_SEED = 0x5eed;

// One acceptance check result. `ok` gates the run; `detail` explains a pass or a failure for the report.
export interface AcceptanceCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface AcceptanceReport {
  readonly ok: boolean;
  readonly checks: readonly AcceptanceCheck[];
}

// A serializable dump of one solved frame: every live instance's emitters (live count + spawn-ordered
// rows), sprite-animator state, and ribbon geometry. Deep-copied out of the live SoA views so a later
// step cannot mutate a captured frame. Two identical runs must produce deep-equal dumps (determinism).
interface FrameDump {
  readonly step: number;
  readonly instances: {
    id: number;
    emitters: {
      liveCount: number;
      rows: number[][]; // [spawnOrder, frame, px, py, rot, outScale, outR, outG, outB, outAlpha]
    }[];
    sprites: number[][]; // [rotationDeg, scale, alpha, r, g, b]
    ribbons: { vertexCount: number; verts: number[][] }[];
  }[];
}

function dumpFrame(sys: EffectSystem, step: number): FrameDump {
  const frame = sys.readState();
  const instances = frame.instances.map((inst) => {
    const emitters = inst.emitters.map((e) => {
      const rows: number[][] = [];
      for (let s = 0; s < e.capacity; s += 1) {
        if (e.alive[s] === 0) continue;
        rows.push([
          e.spawnOrder[s]!,
          e.frame[s]!,
          e.px[s]!,
          e.py[s]!,
          e.rot[s]!,
          e.outScale[s]!,
          e.outR[s]!,
          e.outG[s]!,
          e.outB[s]!,
          e.outAlpha[s]!,
        ]);
      }
      rows.sort((a, b) => a[0]! - b[0]!);
      return { liveCount: e.liveCount, rows };
    });
    const sprites = inst.sprites.map((s) => [s.rotationDeg, s.scale, s.alpha, s.r, s.g, s.b]);
    const ribbons = inst.ribbons.map((r) => {
      const verts: number[][] = [];
      for (let v = 0; v < r.vertexCount * 2; v += 1) {
        verts.push([r.vx[v]!, r.vy[v]!, r.vAlpha[v]!, r.vR[v]!, r.vG[v]!, r.vB[v]!]);
      }
      return { vertexCount: r.vertexCount, verts };
    });
    return { id: inst.id, emitters, sprites, ribbons };
  });
  return { step, instances };
}

// Step a fresh megaWin system for `frames` steps at `dt`, capturing a FrameDump at each step in
// `sampleAt` and tracking the peak per-emitter and global live counts. Returns the dumps + cap stats so
// determinism and caps are computed from one run each (two such runs are compared for determinism).
function runBundle(
  doc: EffectsDocument,
  anchors: Readonly<Record<string, EffectAnchor>>,
  dt: number,
  frames: number,
  sampleAt: ReadonlySet<number>,
  maxLive: number,
): {
  dumps: FrameDump[];
  instanceCount: number;
  peakEmitterOverCap: number;
  peakGlobal: number;
  maxStepMs: number;
  medianStepMs: number;
} {
  const sys = new EffectSystem(doc, { maxLiveParticles: maxLive });
  const ids = sys.triggerBundle(BUNDLE, BASE_SEED, anchors, 0);
  const dumps: FrameDump[] = [];
  let peakEmitterOverCap = 0;
  let peakGlobal = 0;
  const stepMs = new Float64Array(frames);
  for (let step = 1; step <= frames; step += 1) {
    const t0 = performance.now();
    sys.step(dt);
    stepMs[step - 1] = performance.now() - t0;
    for (const inst of sys.readState().instances) {
      for (const e of inst.emitters) {
        peakEmitterOverCap = Math.max(peakEmitterOverCap, e.liveCount - e.capacity);
      }
    }
    peakGlobal = Math.max(peakGlobal, sys.liveParticleTotal());
    if (sampleAt.has(step)) dumps.push(dumpFrame(sys, step));
  }
  const sorted = Float64Array.from(stepMs).sort();
  return {
    dumps,
    instanceCount: ids.length,
    peakEmitterOverCap,
    peakGlobal,
    maxStepMs: sorted[sorted.length - 1] ?? 0,
    medianStepMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
  };
}

// Run the full DoD acceptance over a raw (unvalidated) effects artifact. The first check IS the schema
// validation, so a corrupted artifact fails loudly here (section 12.2 step 1, the negative test passes a
// corrupted doc and asserts ok === false on the validate check).
export function runPhase3Acceptance(rawDoc: unknown): AcceptanceReport {
  const checks: AcceptanceCheck[] = [];
  const add = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
  };

  // 1. Schema validation (WP-3.0). Fail loudly: if the artifact is invalid, no further step can run.
  const report = validateEffectsDocument(rawDoc);
  const valid = report.ok && report.document !== null && report.errors.length === 0;
  add(
    'schema-validate',
    valid,
    valid
      ? 'effects artifact validates against the WP-3.0 schema'
      : `errors: ${JSON.stringify(report.errors)}`,
  );
  if (!valid || report.document === null) {
    return { ok: false, checks };
  }
  const doc = report.document;

  const baseline = loadPerfBaseline();
  const dt = baseline.acceptanceRun.simulationDt;
  const frames = baseline.acceptanceRun.frames;
  const maxLive = baseline.maxLiveParticles;

  // 2. Bundle present + by-name expansion + timing (TASK-3.11.1, section 8.7). The center anchor is a
  // world pose; the screen role drives the screen flash.
  const bundleDef = doc.bundles[BUNDLE];
  if (bundleDef === undefined) {
    add('bundle-present', false, `the artifact does not define a "${BUNDLE}" bundle`);
    return { ok: false, checks };
  }
  add('bundle-present', true, `"${BUNDLE}" references ${bundleDef.items.length} effects by name`);

  const anchors: Record<string, EffectAnchor> = {
    center: { space: 'world', x: 640, y: 360, rotation: 0 },
    screen: { space: 'screen' },
  };
  const expanded = expandBundle(bundleDef, BASE_SEED, anchors, 0);
  const timingOk =
    expanded.length === bundleDef.items.length &&
    expanded.every((it, i) => it.startTime === bundleDef.items[i]!.startOffset);
  add(
    'bundle-expansion',
    timingOk,
    timingOk
      ? `expands to ${expanded.length} items at startOffsets ${bundleDef.items.map((i) => i.startOffset).join(', ')}`
      : 'expanded item count or startTimes do not match the bundle items',
  );
  // Every referenced effect resolves (a dangling reference is a hard fail).
  const refsOk = bundleDef.items.every((i) => doc.effects[i.effect] !== undefined);
  add(
    'bundle-refs-resolve',
    refsOk,
    refsOk ? 'all bundle items reference defined effects' : 'dangling effect reference',
  );

  // 3. Trigger the bundle through the live system + the acceptance run (caps tracked).
  const sampleAt = new Set([1, 15, 30, 60, 120, 150, 300, Math.min(frames, 600)]);
  const runA = runBundle(doc, anchors, dt, frames, sampleAt, maxLive);
  add(
    'trigger-instance-count',
    runA.instanceCount === bundleDef.items.length,
    `triggerBundle returned ${runA.instanceCount} instances for ${bundleDef.items.length} items`,
  );

  // 4. Caps: no emitter exceeds maxParticles, the scene never exceeds MAX_LIVE_PARTICLES.
  const capsOk = runA.peakEmitterOverCap <= 0 && runA.peakGlobal <= maxLive;
  add(
    'caps',
    capsOk,
    capsOk
      ? `peak global ${runA.peakGlobal} <= ${maxLive}; no emitter exceeded its pool`
      : `cap violation: peakEmitterOverCap=${runA.peakEmitterOverCap}, peakGlobal=${runA.peakGlobal}`,
  );

  // 5. Determinism: a second identical run at the same (seed, tier=high) is byte-identical (section
  // 12.2 step 3). JSON-string equality over the sampled dumps is the byte-identical statement.
  const runB = runBundle(doc, anchors, dt, frames, sampleAt, maxLive);
  const detOk = JSON.stringify(runA.dumps) === JSON.stringify(runB.dumps);
  add(
    'determinism',
    detOk,
    detOk
      ? `two runs at (seed=${BASE_SEED}, tier=high) are byte-identical over ${runA.dumps.length} sampled frames`
      : 'the two runs diverged (non-deterministic solve)',
  );

  // 6. Bone-anchor path (TASK-3.11.1): trigger the gold ribbon at a `bone` anchor backed by a moving
  // resolver; the ribbon must record points as the bone tip moves (the bone-anchored path reads the
  // CURRENT-frame transform). This exercises the anchor resolver the Phase 4 sequencer will supply.
  add('bone-anchor-ribbon', ...checkBoneAnchorRibbon(doc, dt));

  // 7. Additive-blend intent (data-level; the GL pixel sample is the deferred render-side remainder).
  add('additive-blend-intent', ...checkAdditiveBlend(doc));

  // 8. Screen flash returns to alpha 0 by layerDuration (no residual flash, section 12.2 step 6 intent).
  add('screen-flash-resets', ...checkScreenFlashResets(doc));

  // 9. Solve performance (TASK-3.11.5, CI-hardware-relative, SOLVE-only; GL render excluded headlessly).
  // The per-frame solve of a few hundred particles is microseconds, so the median sampled step is far
  // under the 16ms frame budget. The gate is the MEDIAN, not the worst step: a single OS preemption of
  // this process (routine when the full turbo test suite runs 9 vitest workspaces in parallel, locally
  // and in CI) inflates one step's wall clock past 16ms with no solve pathology, while a real systemic
  // regression moves the median. Allocation-churn spikes are covered by the dedicated allocation probe
  // in phase3-perf-gates. The worst step is still reported in the detail for triage.
  const perfOk = runA.medianStepMs < 16;
  add(
    'solve-perf',
    perfOk,
    `median solve step ${runA.medianStepMs.toFixed(3)}ms, worst ${runA.maxStepMs.toFixed(3)}ms over ${frames} frames (median < 16ms budget; render excluded)`,
  );

  return { ok: checks.every((c) => c.ok), checks };
}

// The gold ribbon under a moving bone anchor. Returns [ok, detail].
function checkBoneAnchorRibbon(doc: EffectsDocument, dt: number): [boolean, string] {
  if (doc.effects['ribbonTrailGold'] === undefined) {
    return [false, 'ribbonTrailGold preset is missing'];
  }
  // A resolver whose bone tip translates along +x each frame (a synthetic moving skeleton). Returns a
  // pure translation; the system samples it once per frame (section 8.4).
  let frameX = 0;
  const resolver: BoneAnchorResolver = () => compose(frameX, 0, 0, 1, 1, 0, 0);
  const sys = new EffectSystem(doc, { resolveBone: resolver });
  sys.trigger({
    effect: 'ribbonTrailGold',
    anchor: { space: 'bone', skeletonInstanceId: 'skel', pointOrBone: 'tip' },
    seed: 1,
    startTime: 0,
  });
  let lastCount = 0;
  for (let step = 1; step <= 120; step += 1) {
    frameX = step * 10; // move the bone tip well past segmentSpacing each frame
    sys.step(dt);
    const inst = sys.readState().instances[0];
    if (inst !== undefined && inst.ribbons[0] !== undefined) {
      lastCount = inst.ribbons[0].vertexCount;
    }
  }
  const ok = lastCount > 1;
  return [
    ok,
    ok
      ? `bone-anchored ribbon recorded ${lastCount} points as the tip moved`
      : 'ribbon never grew under the moving bone anchor',
  ];
}

// The ray-burst, glow-pulse, and screen-flash layers are additive (the brighter-blend intent). Returns
// [ok, detail].
function checkAdditiveBlend(doc: EffectsDocument): [boolean, string] {
  const additiveEffects = ['rayBurst', 'glowPulse', 'screenFlash'];
  for (const name of additiveEffects) {
    const effect = doc.effects[name];
    if (effect === undefined) return [false, `${name} preset is missing`];
    const allAdditive = effect.layers.every((l) => l.blendMode === 'additive');
    if (!allAdditive)
      return [false, `${name} has a non-additive layer (brighter-blend intent broken)`];
  }
  return [
    true,
    `${additiveEffects.join(', ')} are additive (the brighter-blend intent; GL pixel sample deferred)`,
  ];
}

// The screen flash's alpha-over-life returns to 0 at the end of its layer cycle (no residual flash).
function checkScreenFlashResets(doc: EffectsDocument): [boolean, string] {
  const flash = doc.effects['screenFlash'];
  if (flash === undefined) return [false, 'screenFlash preset is missing'];
  const layer = flash.layers.find((l) => l.type === 'spriteAnimator');
  if (layer === undefined || layer.type !== 'spriteAnimator')
    return [false, 'screenFlash has no sprite layer'];
  const last = layer.alphaOverLife.stops[layer.alphaOverLife.stops.length - 1]!;
  const ok = last.t === 1 && last.value === 0;
  return [
    ok,
    ok
      ? 'screen flash alpha returns to 0 by layerDuration'
      : `residual flash: last alpha stop is ${last.value} at t=${last.t}`,
  ];
}

// Load + return the committed megaWin presets artifact text (raw, unvalidated): the harness validates it
// as step 1 so the load path itself is part of the proof.
export function loadMegaWinArtifact(): unknown {
  return JSON.parse(readFileSync(PRESETS_PATH, 'utf8'));
}
