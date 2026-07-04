// gen-sfx.mts, the procedural foley synthesizer for "GUNNER!".
// Every PHYSICAL sound effect (whooshes, boings, splashes, ambiences) is rendered
// in pure Node: 44100 Hz mono float internally, hand-written 16-bit WAV in a temp
// dir, then converted to audio/sfx/<id>.mp3 with ffmpeg (libmp3lame 128k) and the
// temp WAVs deleted. Fully deterministic: all randomness comes from a mulberry32
// PRNG seeded by a hash of the cue id, never Math.random.
//
// Run from repo root:
//   packages/render-preview/node_modules/.bin/tsx demo/gunner/tools/gen-sfx.mts [--force] [--only id1,id2]
//
// The TTS animal vocals already in audio/sfx (quack-*, mega-bark, tug-growl,
// strain-squeak, shiver-rattle, flap-panic) are never touched: physical cue ids
// are disjoint by construction and asserted at boot; existing files are skipped
// unless --force is passed (and --force only regenerates this script's own cues).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const TWO_PI = Math.PI * 2;
// Normalization target: -1.5 dBFS (10^(-1.5/20)). QC gate is peak <= -1.0 dBFS.
const PEAK_TARGET = Math.pow(10, -1.5 / 20);
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'audio', 'sfx');

const PROTECTED_VOCALS = new Set([
  'quack-mama',
  'quack-babies',
  'quack-alarm',
  'quack-squeak',
  'quack-distant',
  'mega-bark',
  'tug-growl',
  'strain-squeak',
  'shiver-rattle',
  'flap-panic',
]);

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32 seeded by an FNV-1a hash of the cue id)
// ---------------------------------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Core signal toolkit
// ---------------------------------------------------------------------------

type Sig = Float64Array;
type Env = (t: number) => number;
type Shape = 'sine' | 'tri' | 'saw' | 'square';

const N = (sec: number): number => Math.round(sec * SR);
const sig = (sec: number): Sig => new Float64Array(N(sec));
const clampFc = (fc: number): number => Math.min(Math.max(fc, 5), 19000);
const lpCoef = (fc: number): number => 1 - Math.exp((-TWO_PI * clampFc(fc)) / SR);

// Exponential pitch/cutoff sweep from f0 to f1 over `sec`, then holds f1.
function expSweep(f0: number, f1: number, sec: number): Env {
  const r = f1 / f0;
  return (t) => f0 * Math.pow(r, Math.min(Math.max(t / sec, 0), 1));
}

function wave(shape: Shape, ph: number): number {
  const u = ph / TWO_PI;
  const frac = u - Math.floor(u);
  switch (shape) {
    case 'sine':
      return Math.sin(ph);
    case 'tri':
      return 1 - 4 * Math.abs(frac - 0.5);
    case 'saw':
      return 2 * frac - 1;
    case 'square':
      return frac < 0.5 ? 1 : -1;
  }
}

// Oscillator with per-sample phase integration so pitch envelopes glide cleanly.
function tone(sec: number, freq: number | Env, shape: Shape, amp?: Env): Sig {
  const fEnv: Env = typeof freq === 'number' ? () => freq : freq;
  const n = N(sec);
  const out = new Float64Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TWO_PI * fEnv(t)) / SR;
    out[i] = wave(shape, ph) * (amp ? amp(t) : 1);
  }
  return out;
}

function whiteFill(rng: Rng, sec: number): Sig {
  const n = N(sec);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

// Paul Kellet's refined pink noise filter over the seeded white source.
function pinkFill(rng: Rng, sec: number): Sig {
  const n = N(sec);
  const out = new Float64Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

function onePoleLp(x: Sig, fc: number | Env): Sig {
  const fEnv: Env | null = typeof fc === 'number' ? null : fc;
  let k = typeof fc === 'number' ? lpCoef(fc) : 0;
  const out = new Float64Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    if (fEnv) k = lpCoef(fEnv(i / SR));
    y += k * (x[i] - y);
    out[i] = y;
  }
  return out;
}

function onePoleHp(x: Sig, fc: number | Env): Sig {
  const lp = onePoleLp(x, fc);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - lp[i];
  return out;
}

// RBJ biquad bandpass (constant 0 dB peak gain); cutoff may sweep per sample.
function bandpass(x: Sig, fc: number | Env, q: number): Sig {
  const fEnv: Env = typeof fc === 'number' ? () => fc : fc;
  const isStatic = typeof fc === 'number';
  let b0 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  const set = (freq: number): void => {
    const w0 = (TWO_PI * clampFc(freq)) / SR;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    b0 = alpha / a0;
    b2 = -alpha / a0;
    a1 = (-2 * Math.cos(w0)) / a0;
    a2 = (1 - alpha) / a0;
  };
  set(fEnv(0));
  const out = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (!isStatic) set(fEnv(i / SR));
    const y = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

const dcBlock = (x: Sig): Sig => onePoleHp(x, 8);

// Envelope shapes.
const humpEnv =
  (peakT: number, tau: number, risePow = 1): Env =>
  (t) =>
    t <= 0 ? 0 : t < peakT ? Math.pow(t / peakT, risePow) : Math.exp(-(t - peakT) / tau);

const pingEnv =
  (tau: number, att = 0.002): Env =>
  (t) =>
    t <= 0 ? 0 : Math.min(t / att, 1) * Math.exp(-Math.max(t - att, 0) / tau);

function adsrEnv(a: number, d: number, s: number, r: number, dur: number): Env {
  const relAt = dur - r;
  return (t) => {
    if (t <= 0 || t >= dur) return 0;
    const pre = t < a ? t / a : t < a + d ? 1 + (s - 1) * ((t - a) / d) : s;
    return t < relAt ? pre : pre * (1 - (t - relAt) / r);
  };
}

function shaped(x: Sig, env: Env): Sig {
  for (let i = 0; i < x.length; i++) x[i] *= env(i / SR);
  return x;
}

// Amplitude tremolo curve with a time-varying rate (phase-integrated).
function tremBuf(sec: number, rate: Env, depth: number): Sig {
  const n = N(sec);
  const out = new Float64Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (TWO_PI * rate(i / SR)) / SR;
    out[i] = 1 - depth * (0.5 + 0.5 * Math.sin(ph));
  }
  return out;
}

function mulBuf(x: Sig, m: Sig): Sig {
  for (let i = 0; i < x.length; i++) x[i] *= m[Math.min(i, m.length - 1)];
  return x;
}

function mixAt(dest: Sig, src: Sig, atSec: number, g = 1): void {
  const off = N(atSec);
  const end = Math.min(dest.length, off + src.length);
  for (let i = Math.max(0, off); i < end; i++) dest[i] += src[i - off] * g;
}

function softClipBuf(x: Sig, drive: number): Sig {
  const norm = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / norm;
  return x;
}

function normalizeTo(x: Sig, peak: number): Sig {
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  if (max === 0) throw new Error('normalizeTo: silent buffer');
  const s = peak / max;
  for (let i = 0; i < x.length; i++) x[i] *= s;
  return x;
}

// Convolution-free outdoor tail: three parallel feedback comb delays with a
// damping lowpass in each loop, mixed under the dry signal (length preserved).
function airTail(x: Sig, wet: number): Sig {
  const taps = [
    { d: N(0.0293), fb: 0.42 },
    { d: N(0.0411), fb: 0.37 },
    { d: N(0.0563), fb: 0.33 },
  ];
  const acc = new Float64Array(x.length);
  const dampK = lpCoef(2600);
  for (const tap of taps) {
    const buf = new Float64Array(tap.d);
    let idx = 0;
    let damp = 0;
    for (let i = 0; i < x.length; i++) {
      const delayed = buf[idx];
      damp += dampK * (delayed - damp);
      buf[idx] = x[i] + damp * tap.fb;
      idx = (idx + 1) % tap.d;
      acc[i] += delayed;
    }
  }
  const out = new Float64Array(x.length);
  const w = wet / taps.length;
  for (let i = 0; i < x.length; i++) out[i] = x[i] + w * acc[i];
  return out;
}

// Slow random LFO in roughly [-1, 1]: seeded white noise through two one-pole
// lowpasses at the LFO rate, renormalized. Drives bubbling/undulation mods.
function slowLfo(rng: Rng, sec: number, rateHz: number): Sig {
  let x = whiteFill(rng, sec);
  x = onePoleLp(onePoleLp(x, rateHz), rateHz);
  let max = 0;
  for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i]));
  if (max > 0) for (let i = 0; i < x.length; i++) x[i] /= max;
  return x;
}

// ---------------------------------------------------------------------------
// Foley building blocks
// ---------------------------------------------------------------------------

// Short filtered noise click: the mandatory impact transient.
function clickBurst(rng: Rng, sec: number, fc: number, q: number): Sig {
  const raw = whiteFill(rng, sec + 0.012);
  shaped(raw, pingEnv(sec * 0.5, 0.0004));
  return bandpass(raw, fc, q);
}

interface ThumpOpts {
  readonly f0: number;
  readonly f1: number;
  readonly tau: number;
  readonly click?: number;
  readonly clickFc?: number;
  readonly noise?: number;
  readonly noiseFc?: number;
}

// Click transient + sine-sweep body + lowpassed noise tail (the impact recipe).
function thumpHit(rng: Rng, o: ThumpOpts): Sig {
  const len = o.tau * 5 + 0.05;
  const out = sig(len);
  mixAt(out, shaped(tone(len, expSweep(o.f0, o.f1, o.tau * 1.5), 'sine'), pingEnv(o.tau, 0.003)), 0, 1);
  mixAt(out, clickBurst(rng, 0.003, o.clickFc ?? 1300, 1.4), 0, o.click ?? 0.4);
  mixAt(out, shaped(onePoleLp(whiteFill(rng, o.tau * 3), o.noiseFc ?? 380), pingEnv(o.tau * 0.8, 0.002)), 0, o.noise ?? 0.35);
  return out;
}

function chirpNote(f0: number, f1: number, dur: number, tau: number, shape: Shape = 'sine'): Sig {
  return shaped(tone(dur, expSweep(f0, f1, dur * 0.8), shape), pingEnv(tau, 0.004));
}

// Lowpassed noise puff with a falling cutoff (wing flaps, dust, cushions).
function noisePuff(rng: Rng, sec: number, fc0: number, fc1: number, peakT: number, tau: number): Sig {
  const raw = onePoleLp(whiteFill(rng, sec), expSweep(fc0, fc1, sec * 0.8));
  return shaped(raw, humpEnv(peakT, tau, 1.4));
}

// ---------------------------------------------------------------------------
// Cue list
// ---------------------------------------------------------------------------

interface Cue {
  readonly id: string;
  readonly dur: number;
  // Loopable cues render dur + loopXf seconds; the extra tail is equal-power
  // crossfaded into the loop head so the seam is continuous.
  readonly loopXf?: number;
  readonly render: (rng: Rng, sec: number) => Sig;
}

const CUES: readonly Cue[] = [
  {
    id: 'whoosh-run',
    dur: 0.7,
    render: (rng, sec) => {
      const out = sig(sec);
      const swept = bandpass(whiteFill(rng, sec), expSweep(300, 3000, 0.55), 1.1);
      mixAt(out, shaped(swept, humpEnv(0.32, 0.16, 1.6)), 0, 1);
      // Doppler-ish pitch-up chirp riding the sweep.
      mixAt(out, shaped(tone(0.6, expSweep(500, 1900, 0.5), 'sine'), humpEnv(0.3, 0.12, 2)), 0.05, 0.22);
      return airTail(out, 0.18);
    },
  },
  {
    id: 'skid',
    dur: 0.6,
    render: (rng, sec) => {
      const out = sig(sec);
      const base = expSweep(1250, 720, 0.5);
      const f: Env = (t) => base(t) * (1 + 0.05 * Math.sin(TWO_PI * 26 * t));
      const gate: Env = (t) => (t < 0.46 ? adsrEnv(0.015, 0.1, 0.8, 0.02, 0.6)(t) : Math.exp(-(t - 0.46) / 0.008));
      mixAt(out, shaped(onePoleLp(tone(0.5, f, 'saw'), 3200), gate), 0, 0.9);
      mixAt(out, shaped(bandpass(whiteFill(rng, 0.5), (t) => base(t) * 1.8, 1.5), gate), 0, 0.35);
      mixAt(out, thumpHit(rng, { f0: 150, f1: 70, tau: 0.05, click: 0.35 }), 0.5, 0.55);
      return out;
    },
  },
  {
    id: 'sparkle-pop',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      for (let k = 0; k < 6; k++) {
        const at = 0.02 + k * 0.05 + rng() * 0.03;
        const f = 2500 * Math.pow(2, rng());
        const g = 0.5 + rng() * 0.4;
        mixAt(out, shaped(tone(0.25, f, 'sine'), pingEnv(0.05)), at, g);
        mixAt(out, shaped(tone(0.15, f * 2, 'sine'), pingEnv(0.03)), at, g * 0.3);
      }
      mixAt(out, shaped(onePoleHp(whiteFill(rng, 0.6), 4500), humpEnv(0.1, 0.25)), 0.05, 0.1);
      return airTail(out, 0.22);
    },
  },
  {
    id: 'wink-ting',
    dur: 0.5,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, shaped(tone(0.35, 3100, 'tri'), pingEnv(0.07)), 0.01, 1);
      mixAt(out, shaped(tone(0.25, 6200, 'tri'), pingEnv(0.05)), 0.15, 0.3);
      mixAt(out, shaped(onePoleHp(whiteFill(rng, 0.15), 5000), humpEnv(0.02, 0.05)), 0.01, 0.06);
      return airTail(out, 0.12);
    },
  },
  {
    id: 'boing-tumble',
    dur: 1.0,
    render: (rng, sec) => {
      const out = sig(sec);
      const base = expSweep(250, 90, 0.42);
      const f: Env = (t) => base(t) * (1 + 0.14 * Math.exp(-t / 0.28) * Math.sin(TWO_PI * 15 * t));
      mixAt(out, softClipBuf(shaped(tone(0.55, f, 'sine'), pingEnv(0.3, 0.004)), 1.6), 0, 1);
      mixAt(out, thumpHit(rng, { f0: 130, f1: 65, tau: 0.06, noise: 0.6, noiseFc: 340 }), 0.58, 0.5);
      mixAt(out, thumpHit(rng, { f0: 110, f1: 58, tau: 0.055, noise: 0.6, noiseFc: 300 }), 0.78, 0.35);
      return out;
    },
  },
  {
    id: 'boing-soft',
    dur: 0.4,
    render: (rng, sec) => {
      const out = sig(sec);
      const base = expSweep(400, 180, 0.3);
      const f: Env = (t) => base(t) * (1 + 0.1 * Math.exp(-t / 0.12) * Math.sin(TWO_PI * 20 * t));
      mixAt(out, shaped(tone(0.38, f, 'sine'), pingEnv(0.13, 0.003)), 0, 1);
      mixAt(out, clickBurst(rng, 0.002, 900, 1.2), 0, 0.12);
      return out;
    },
  },
  {
    id: 'creak-gadget',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      const gate: Env = (t) => Math.pow(0.5 + 0.5 * Math.sin(TWO_PI * 12 * t - Math.PI / 2), 2.5);
      const overall = humpEnv(0.25, 0.35, 0.7);
      const f: Env = (t) => 80 * (1 + 0.06 * Math.sin(TWO_PI * 1.7 * t));
      const saw = shaped(onePoleLp(tone(sec, f, 'saw'), 500), (t) => gate(t) * overall(t));
      mixAt(out, saw, 0, 0.9);
      const burrs = shaped(bandpass(whiteFill(rng, sec), 950, 2.2), (t) => gate(t) * overall(t));
      mixAt(out, burrs, 0, 0.5);
      return out;
    },
  },
  {
    id: 'crank-ratchet',
    dur: 1.2,
    loopXf: 0.06,
    render: (rng, sec) => {
      const out = sig(sec);
      // 7 clicks per 1.2 s loop (about 6/s) so the rhythm is loop-periodic.
      const spacing = 1.2 / 7;
      let k = 0;
      for (let t0 = 0.03; t0 < sec - 0.005; t0 += spacing, k++) {
        mixAt(out, clickBurst(rng, 0.016, k % 2 === 0 ? 2300 : 2000, 1.6), t0, 0.9);
        mixAt(out, shaped(tone(0.03, 900, 'sine'), pingEnv(0.006)), t0, 0.4);
      }
      mixAt(out, onePoleLp(tone(sec, 55, 'saw'), 190), 0, 0.09);
      mixAt(out, bandpass(whiteFill(rng, sec), 400, 1), 0, 0.05);
      return out;
    },
  },
  {
    id: 'flap-land',
    dur: 0.6,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, noisePuff(rng, 0.16, 900, 250, 0.03, 0.05), 0.04, 1);
      mixAt(out, noisePuff(rng, 0.16, 750, 220, 0.03, 0.05), 0.22, 0.9);
      mixAt(out, thumpHit(rng, { f0: 150, f1: 75, tau: 0.05, click: 0.25, noise: 0.6, noiseFc: 480 }), 0.42, 0.7);
      return out;
    },
  },
  {
    id: 'flap-fast',
    dur: 1.0,
    loopXf: 0.06,
    render: (rng, sec) => {
      const out = sig(sec);
      let k = 0;
      for (let t0 = 0.02; t0 < sec - 0.005; t0 += 0.125, k++) {
        const fc = k % 2 === 0 ? 820 : 640;
        mixAt(out, noisePuff(rng, 0.09, fc, fc * 0.35, 0.02, 0.03), t0, 0.8 + rng() * 0.2);
      }
      // Faint air bed keeps the loop seam alive between puffs.
      mixAt(out, onePoleLp(pinkFill(rng, sec), 500), 0, 0.05);
      return out;
    },
  },
  {
    id: 'whoosh-group',
    dur: 0.9,
    render: (rng, sec) => {
      const out = sig(sec);
      const layers: ReadonlyArray<readonly [number, number, number, number]> = [
        [180, 1400, 0.6, 0],
        [350, 2600, 0.65, 0.08],
        [260, 2000, 0.6, 0.15],
      ];
      for (const [f0, f1, sw, at] of layers) {
        const layer = shaped(bandpass(whiteFill(rng, 0.7), expSweep(f0, f1, sw), 1.0), humpEnv(0.3, 0.2, 1.5));
        mixAt(out, layer, at, 0.75);
      }
      mixAt(out, shaped(tone(0.8, expSweep(70, 45, 0.7), 'sine'), humpEnv(0.35, 0.25)), 0, 0.4);
      return airTail(out, 0.2);
    },
  },
  {
    id: 'wind-gust',
    dur: 1.5,
    render: (rng, sec) => {
      const out = sig(sec);
      const bell = humpEnv(0.6, 0.4, 1.2);
      const body = shaped(onePoleLp(pinkFill(rng, sec), (t) => 280 + 900 * bell(t)), (t) => 0.25 + 0.75 * bell(t));
      mixAt(out, body, 0, 1);
      const wf: Env = (t) => (800 + 700 * bell(t)) * (1 + 0.015 * Math.sin(TWO_PI * 5.5 * t));
      mixAt(out, tone(sec, wf, 'sine', (t) => 0.12 * Math.pow(bell(t), 1.6)), 0, 1);
      return out;
    },
  },
  {
    id: 'creek-flow',
    dur: 4.0,
    loopXf: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      const bubble = slowLfo(rng, sec, 2.5);
      const base = onePoleLp(pinkFill(rng, sec), 850);
      for (let i = 0; i < base.length; i++) base[i] *= 0.7 + 0.3 * (0.5 + 0.5 * bubble[i]);
      mixAt(out, base, 0, 1);
      // Wobbling band at 0.5 Hz: two full cycles per loop, so it is seam-periodic.
      const band = bandpass(pinkFill(rng, sec), (t) => 450 + 180 * Math.sin(TWO_PI * 0.5 * t), 1.2);
      const bubble2 = slowLfo(rng, sec, 3.5);
      for (let i = 0; i < band.length; i++) band[i] *= 0.6 + 0.4 * (0.5 + 0.5 * bubble2[i]);
      mixAt(out, band, 0, 0.5);
      for (let k = 0; k < 7; k++) {
        const at = 0.3 + rng() * (4.0 - 0.6);
        mixAt(out, chirpNote(600 + rng() * 300, 1300 + rng() * 300, 0.06, 0.035), at, 0.1 + rng() * 0.08);
      }
      return out;
    },
  },
  {
    id: 'river-fast',
    dur: 4.0,
    loopXf: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      const bubble = slowLfo(rng, sec, 6);
      const base = onePoleLp(pinkFill(rng, sec), 2000);
      for (let i = 0; i < base.length; i++) base[i] *= 0.65 + 0.35 * (0.5 + 0.5 * bubble[i]);
      mixAt(out, base, 0, 0.9);
      mixAt(out, onePoleLp(whiteFill(rng, sec), 3500), 0, 0.35);
      // Churn band wobbling at 0.75 Hz: three cycles per loop, seam-periodic.
      mixAt(out, bandpass(pinkFill(rng, sec), (t) => 700 + 300 * Math.sin(TWO_PI * 0.75 * t), 1.0), 0, 0.5);
      for (let k = 0; k < 8; k++) {
        const at = 0.25 + rng() * (4.0 - 0.55);
        const splash = shaped(bandpass(whiteFill(rng, 0.12), 2500 + rng() * 800, 0.9), humpEnv(0.015, 0.04, 1.3));
        mixAt(out, splash, at, 0.25 + rng() * 0.1);
      }
      return out;
    },
  },
  {
    id: 'waterfall-roar',
    dur: 4.0,
    loopXf: 0.35,
    render: (rng, sec) => {
      const out = sig(sec);
      // Undulation at 0.5 Hz (two cycles per loop) keeps the seam periodic.
      const und: Env = (t) => 1 + 0.14 * Math.sin(TWO_PI * 0.5 * t);
      mixAt(out, shaped(pinkFill(rng, sec), und), 0, 0.9);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, sec), 3000), (t) => und(t + 0.7)), 0, 0.45);
      mixAt(out, shaped(onePoleLp(pinkFill(rng, sec), 110), (t) => und(t + 1.3)), 0, 0.9);
      return out;
    },
  },
  {
    id: 'fog-wind',
    dur: 4.0,
    loopXf: 0.35,
    render: (rng, sec) => {
      const out = sig(sec);
      // One swell per 4 s loop (0.25 Hz, tweaked from 0.3 so it loops exactly).
      const swell: Env = (t) => 0.5 + 0.5 * Math.sin(TWO_PI * 0.25 * t - Math.PI / 2);
      const body = onePoleLp(pinkFill(rng, sec), (t) => 240 + 140 * swell(t));
      mixAt(out, shaped(body, (t) => 0.35 + 0.65 * swell(t)), 0, 1);
      mixAt(out, shaped(bandpass(pinkFill(rng, sec), 210, 5), (t) => 0.3 + 0.7 * swell(t)), 0, 0.5);
      return out;
    },
  },
  {
    id: 'birds-meadow',
    dur: 5.0,
    loopXf: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, onePoleLp(pinkFill(rng, sec), 1100), 0, 0.06);
      for (let k = 0; k < 9; k++) {
        const at = 0.2 + rng() * (5.0 - 0.75);
        const f0 = 2000 * Math.pow(2, rng());
        const g = 0.35 + rng() * 0.4;
        let noteAt = at;
        for (let nIdx = 0; nIdx < 3; nIdx++) {
          const ratio = [1, 1.12, 0.94][nIdx] * (0.97 + rng() * 0.06);
          mixAt(out, chirpNote(f0 * ratio, f0 * ratio * 1.22, 0.08, 0.03), noteAt, g);
          noteAt += 0.09 + rng() * 0.03;
        }
      }
      return out;
    },
  },
  {
    id: 'birds-evening',
    dur: 5.0,
    loopXf: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, onePoleLp(pinkFill(rng, sec), 700), 0, 0.07);
      for (let k = 0; k < 4; k++) {
        const at = 0.3 + rng() * (5.0 - 0.9);
        const f0 = 1400 + rng() * 1000;
        const g = 0.3 + rng() * 0.3;
        mixAt(out, chirpNote(f0, f0 * 1.15, 0.12, 0.05, 'tri'), at, g);
        mixAt(out, chirpNote(f0 * 1.08, f0 * 0.95, 0.12, 0.05, 'tri'), at + 0.16 + rng() * 0.04, g * 0.8);
      }
      // Cricket ticks every 0.5 s (ten per loop, seam-periodic), two per event.
      for (let t0 = 0.15; t0 < sec - 0.06; t0 += 0.5) {
        mixAt(out, shaped(bandpass(whiteFill(rng, 0.02), 4300, 6), pingEnv(0.008)), t0, 0.18);
        mixAt(out, shaped(bandpass(whiteFill(rng, 0.02), 4300, 6), pingEnv(0.008)), t0 + 0.035, 0.15);
      }
      return out;
    },
  },
  {
    id: 'paws-running',
    dur: 1.0,
    loopXf: 0.05,
    render: (rng, sec) => {
      const out = sig(sec);
      for (let t0 = 0.04; t0 < sec - 0.005; t0 += 0.125) {
        mixAt(out, thumpHit(rng, { f0: 160, f1: 78, tau: 0.045, click: 0.18, noise: 0.5, noiseFc: 320 }), t0, 0.75 + rng() * 0.2);
        const swish = shaped(bandpass(whiteFill(rng, 0.04), 1700 + rng() * 200, 1.1), humpEnv(0.008, 0.012, 1.2));
        mixAt(out, swish, t0 + 0.02, 0.22);
      }
      // Grass bed keeps the seam alive between footfalls.
      mixAt(out, bandpass(pinkFill(rng, sec), 900, 0.8), 0, 0.05);
      return out;
    },
  },
  {
    id: 'feather-pop',
    dur: 0.4,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.003, 1600, 1.5), 0.02, 0.8);
      mixAt(out, shaped(tone(0.16, expSweep(620, 210, 0.08), 'sine'), pingEnv(0.045, 0.001)), 0.02, 0.9);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.22), 750), humpEnv(0.04, 0.09, 1.3)), 0.09, 0.25);
      return out;
    },
  },
  {
    id: 'flop-soft',
    dur: 0.5,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, thumpHit(rng, { f0: 130, f1: 55, tau: 0.09, click: 0.2, clickFc: 800, noise: 0.5, noiseFc: 420 }), 0.01, 1);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.25), 420), humpEnv(0.03, 0.1, 1.2)), 0.01, 0.5);
      mixAt(out, thumpHit(rng, { f0: 105, f1: 48, tau: 0.07, click: 0.12, clickFc: 700, noise: 0.5, noiseFc: 380 }), 0.22, 0.45);
      return out;
    },
  },
  {
    id: 'catapult-twang',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.004, 800, 1.2), 0, 0.7);
      mixAt(out, shaped(tone(0.1, 320, 'sine'), pingEnv(0.03)), 0, 0.5);
      const wob: Env = (t) => 1 + 0.05 * Math.exp(-t / 0.2) * Math.sin(TWO_PI * 24 * t);
      const saws = sig(0.7);
      mixAt(saws, tone(0.7, (t) => 178 * wob(t), 'saw'), 0, 0.5);
      mixAt(saws, tone(0.7, (t) => 183 * wob(t), 'saw'), 0, 0.5);
      mixAt(out, softClipBuf(shaped(onePoleLp(saws, 1500), pingEnv(0.24, 0.003)), 1.4), 0.01, 1);
      mixAt(out, shaped(bandpass(whiteFill(rng, 0.4), 240, 3), pingEnv(0.15)), 0.01, 0.2);
      return out;
    },
  },
  {
    id: 'branch-thunk',
    dur: 0.5,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.004, 950, 1.4), 0, 0.9);
      mixAt(out, shaped(tone(0.35, expSweep(135, 92, 0.1), 'sine'), pingEnv(0.07, 0.002)), 0, 1);
      mixAt(out, shaped(tone(0.15, 240, 'sine'), pingEnv(0.035)), 0, 0.4);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.15), 380), pingEnv(0.04, 0.001)), 0, 0.4);
      return airTail(out, 0.1);
    },
  },
  {
    id: 'wobble-creak',
    dur: 1.2,
    render: (rng, sec) => {
      const out = sig(sec);
      const trem = tremBuf(sec, (t) => 7 - 3 * (t / 1.2), 0.9);
      const band = mulBuf(bandpass(whiteFill(rng, sec), expSweep(750, 380, 1.1), 3), trem);
      mixAt(out, shaped(band, humpEnv(0.3, 0.5, 0.8)), 0, 1);
      const creak = mulBuf(onePoleLp(tone(sec, expSweep(115, 68, 1.1), 'saw'), 700), trem);
      mixAt(out, shaped(creak, humpEnv(0.3, 0.5, 0.8)), 0, 0.45);
      return out;
    },
  },
  {
    id: 'crack-snap',
    dur: 0.6,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.003, 2600, 0.9), 0, 1);
      const splinter = shaped(bandpass(whiteFill(rng, 0.22), expSweep(2000, 800, 0.18), 1.4), pingEnv(0.06, 0.001));
      mixAt(out, splinter, 0.005, 0.7);
      for (let k = 0; k < 5; k++) {
        mixAt(out, clickBurst(rng, 0.003, 1500 + rng() * 1500, 1.2), 0.015 + rng() * 0.105, 0.3 + rng() * 0.2);
      }
      mixAt(out, shaped(tone(0.3, expSweep(105, 62, 0.09), 'sine'), pingEnv(0.07, 0.002)), 0.04, 0.8);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.12), 350), pingEnv(0.035, 0.001)), 0.04, 0.35);
      return airTail(out, 0.16);
    },
  },
  {
    id: 'splash-big',
    dur: 1.2,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, shaped(tone(0.25, expSweep(320, 95, 0.1), 'sine'), pingEnv(0.08, 0.002)), 0, 0.6);
      const burst = shaped(onePoleLp(whiteFill(rng, 1.0), expSweep(3800, 700, 0.9)), pingEnv(0.3, 0.006));
      mixAt(out, burst, 0, 1);
      for (let k = 0; k < 6; k++) {
        const at = 0.35 + rng() * 0.6;
        const f = 900 + rng() * 900;
        mixAt(out, chirpNote(f, f * 1.3, 0.08, 0.03), at, 0.3 * (1 - k * 0.1));
      }
      return airTail(out, 0.22);
    },
  },
  {
    id: 'yank-grab',
    dur: 0.5,
    render: (rng, sec) => {
      const out = sig(sec);
      const whip = shaped(bandpass(whiteFill(rng, 0.18), expSweep(700, 2900, 0.13), 1.2), humpEnv(0.06, 0.035, 2));
      mixAt(out, whip, 0, 1);
      mixAt(out, thumpHit(rng, { f0: 140, f1: 78, tau: 0.06, click: 0.3, noise: 0.5, noiseFc: 500 }), 0.17, 0.9);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.1), 900), humpEnv(0.015, 0.03, 1.2)), 0.17, 0.4);
      return out;
    },
  },
  {
    id: 'rope-whip',
    dur: 0.6,
    render: (rng, sec) => {
      const out = sig(sec);
      const swish = shaped(bandpass(whiteFill(rng, 0.2), expSweep(500, 3600, 0.16), 1.1), humpEnv(0.1, 0.03, 2));
      mixAt(out, swish, 0, 0.9);
      mixAt(out, clickBurst(rng, 0.0025, 3200, 0.8), 0.17, 1);
      mixAt(out, shaped(tone(0.06, 1100, 'sine'), pingEnv(0.012, 0.0008)), 0.17, 0.5);
      mixAt(out, shaped(tone(0.12, expSweep(300, 180, 0.05), 'sine'), pingEnv(0.03, 0.001)), 0.17, 0.4);
      mixAt(out, shaped(onePoleHp(whiteFill(rng, 0.25), 2000), pingEnv(0.08, 0.001)), 0.175, 0.12);
      return airTail(out, 0.18);
    },
  },
  {
    id: 'hook-click',
    dur: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.006, 2600, 3), 0.03, 1);
      mixAt(out, shaped(tone(0.03, 1900, 'sine'), pingEnv(0.008, 0.0008)), 0.03, 0.4);
      mixAt(out, clickBurst(rng, 0.009, 1200, 2.5), 0.13, 0.9);
      mixAt(out, shaped(tone(0.08, 430, 'sine'), pingEnv(0.02, 0.001)), 0.13, 0.5);
      return out;
    },
  },
  {
    id: 'paw-dig',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      for (let k = 0; k < 4; k++) {
        const at = 0.04 + k * 0.18 + rng() * 0.012;
        const fMul = 0.9 + rng() * 0.2;
        const scrape = shaped(bandpass(whiteFill(rng, 0.1), expSweep(1450 * fMul, 720 * fMul, 0.08), 1.3), humpEnv(0.015, 0.03, 1.3));
        mixAt(out, scrape, at, 0.8);
        mixAt(out, thumpHit(rng, { f0: 120, f1: 68, tau: 0.04, click: 0.15, noise: 0.5, noiseFc: 300 }), at, 0.5);
      }
      return out;
    },
  },
  {
    id: 'rope-stretch',
    dur: 1.5,
    render: (rng, sec) => {
      const out = sig(sec);
      const strain = shaped(bandpass(pinkFill(rng, sec), expSweep(300, 720, 1.4), 3.5), humpEnv(0.9, 0.5, 0.8));
      mixAt(out, strain, 0, 1);
      const gate: Env = (t) => Math.pow(0.5 + 0.5 * Math.sin(TWO_PI * 9 * t), 2);
      const creak = shaped(onePoleLp(tone(sec, expSweep(62, 92, 1.4), 'saw'), 400), (t) => gate(t) * humpEnv(0.9, 0.5, 0.8)(t));
      mixAt(out, creak, 0, 0.35);
      // Fiber crackles cluster toward the end as tension rises.
      for (let k = 0; k < 14; k++) {
        const at = Math.min(0.1 + 1.32 * Math.pow(rng(), 0.6), 1.42);
        mixAt(out, clickBurst(rng, 0.003, 1500 + rng() * 1800, 4), at, (0.25 + rng() * 0.3) * (0.5 + at / 1.5));
      }
      return out;
    },
  },
  {
    id: 'heave-yank',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      const whoomp = softClipBuf(shaped(tone(0.5, expSweep(75, 34, 0.22), 'sine'), pingEnv(0.16, 0.008)), 1.3);
      mixAt(out, whoomp, 0, 1);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, 0.25), 180), pingEnv(0.08, 0.003)), 0, 0.5);
      mixAt(out, clickBurst(rng, 0.004, 600, 1.1), 0, 0.3);
      const whoosh = shaped(bandpass(whiteFill(rng, 0.45), expSweep(350, 2400, 0.32), 1.1), humpEnv(0.12, 0.09, 1.5));
      mixAt(out, whoosh, 0.16, 0.7);
      return airTail(out, 0.18);
    },
  },
  {
    id: 'slide-thump',
    dur: 0.8,
    render: (rng, sec) => {
      const out = sig(sec);
      // Stick-slip scrape: tremolo decelerating from 17 Hz to 6 Hz.
      const trem = tremBuf(0.55, (t) => 17 - 11 * (t / 0.55), 0.75);
      const scrape = mulBuf(bandpass(whiteFill(rng, 0.55), expSweep(1250, 480, 0.5), 1.5), trem);
      const env: Env = (t) => (t < 0.5 ? adsrEnv(0.02, 0.15, 0.7, 0.02, 0.55)(t) : Math.exp(-(t - 0.5) / 0.02));
      mixAt(out, shaped(scrape, env), 0, 1);
      mixAt(out, thumpHit(rng, { f0: 120, f1: 70, tau: 0.05, noise: 0.5 }), 0.56, 0.9);
      mixAt(out, thumpHit(rng, { f0: 100, f1: 60, tau: 0.045, noise: 0.5 }), 0.68, 0.55);
      return out;
    },
  },
  {
    id: 'pop-cute',
    dur: 0.3,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, clickBurst(rng, 0.0015, 2200, 1), 0.005, 0.6);
      mixAt(out, shaped(tone(0.1, expSweep(1350, 680, 0.045), 'sine'), pingEnv(0.03, 0.001)), 0.005, 1);
      mixAt(out, shaped(tone(0.06, 2800, 'sine'), pingEnv(0.018, 0.001)), 0.01, 0.25);
      return out;
    },
  },
  {
    id: 'iris-pop',
    dur: 0.4,
    render: (rng, sec) => {
      const out = sig(sec);
      const base = expSweep(1800, 520, 0.3);
      const f: Env = (t) => base(t) * (1 + 0.02 * Math.sin(TWO_PI * 9 * t));
      const slideEnv: Env = (t) => (t < 0.3 ? Math.min(t / 0.01, 1) * (0.85 - 0.2 * (t / 0.3)) : Math.exp(-(t - 0.3) / 0.006));
      mixAt(out, tone(0.32, f, 'sine', slideEnv), 0, 1);
      mixAt(out, clickBurst(rng, 0.002, 1500, 1.2), 0.31, 0.7);
      mixAt(out, shaped(tone(0.08, expSweep(520, 240, 0.05), 'sine'), pingEnv(0.03, 0.001)), 0.31, 0.9);
      return out;
    },
  },
  {
    id: 'tension-whistle',
    dur: 1.0,
    render: (rng, sec) => {
      const out = sig(sec);
      const f: Env = (t) => expSweep(500, 1500, 0.92)(t) * (1 + 0.02 * Math.sin(TWO_PI * 6.5 * t));
      const amp: Env = (t) =>
        Math.min(t / 0.04, 1) * (0.6 + 0.4 * (t / sec)) * Math.min(1, Math.max(0, (sec - 0.02 - t) / 0.05));
      mixAt(out, tone(sec, f, 'sine', amp), 0, 1);
      mixAt(out, shaped(bandpass(whiteFill(rng, sec), f, 4), amp), 0, 0.12);
      return out;
    },
  },
  {
    id: 'dust-poof',
    dur: 0.5,
    render: (rng, sec) => {
      const out = sig(sec);
      mixAt(out, shaped(onePoleLp(whiteFill(rng, sec), expSweep(1300, 320, 0.35)), humpEnv(0.035, 0.14, 1.2)), 0, 1);
      mixAt(out, shaped(tone(0.2, expSweep(100, 70, 0.08), 'sine'), pingEnv(0.05, 0.003)), 0, 0.25);
      return out;
    },
  },
];

// ---------------------------------------------------------------------------
// Loop post-processing
// ---------------------------------------------------------------------------

// Equal-power crossfade of the rendered tail (dur..dur+xf) into the loop head,
// so sample[last] flows into sample[0] with continuous material.
function crossfadeLoop(buf: Sig, nLoop: number, nXf: number): Sig {
  if (buf.length < nLoop + nXf) throw new Error('crossfadeLoop: buffer too short');
  const out = new Float64Array(nLoop);
  out.set(buf.subarray(0, nLoop));
  for (let i = 0; i < nXf; i++) {
    const w = ((i + 1) / (nXf + 1)) * (Math.PI / 2);
    out[i] = buf[i] * Math.sin(w) + buf[nLoop + i] * Math.cos(w);
  }
  return out;
}

function rmsOf(buf: Sig, from: number, to: number): number {
  let acc = 0;
  const a = Math.max(0, from);
  const b = Math.min(buf.length, to);
  for (let i = a; i < b; i++) acc += buf[i] * buf[i];
  return Math.sqrt(acc / Math.max(1, b - a));
}

// Gentle raised-cosine gain ramp over the final 40 ms so the last 5 ms window
// RMS matches the first 5 ms window (the loop-seam QC gate).
function matchLoopSeam(buf: Sig): void {
  const w = N(0.005);
  const rs = rmsOf(buf, 0, w);
  const re = rmsOf(buf, buf.length - w, buf.length);
  if (rs <= 1e-6 || re <= 1e-6) return;
  const g = Math.min(2, Math.max(0.5, rs / re));
  const ramp = Math.min(N(0.04), buf.length);
  for (let i = 0; i < ramp; i++) {
    const shapeW = 0.5 - 0.5 * Math.cos((Math.PI * i) / (ramp - 1));
    buf[buf.length - ramp + i] *= 1 + (g - 1) * shapeW;
  }
}

function fadeInMs(buf: Sig, ms: number): void {
  const n = Math.min(N(ms / 1000), buf.length);
  for (let i = 0; i < n; i++) buf[i] *= i / n;
}

function fadeOutMs(buf: Sig, ms: number): void {
  const n = Math.min(N(ms / 1000), buf.length);
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
}

// ---------------------------------------------------------------------------
// WAV writer (16-bit PCM mono) and metrics
// ---------------------------------------------------------------------------

function writeWav16(path: string, data: Sig): void {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

const toDb = (v: number): number => (v <= 1e-9 ? -180 : 20 * Math.log10(v));

function peakOf(buf: Sig): number {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  return max;
}

function meanOf(buf: Sig): number {
  let acc = 0;
  for (let i = 0; i < buf.length; i++) acc += buf[i];
  return acc / buf.length;
}

function probeDuration(path: string): number {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], {
    encoding: 'utf8',
  });
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur)) throw new Error(`ffprobe returned no duration for ${path}`);
  return dur;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Row {
  readonly id: string;
  readonly kind: string;
  readonly specDur: number;
  readonly mp3Dur: number;
  readonly peakDb: number;
  readonly rmsDb: number;
  readonly seamDb: number | null;
  readonly issues: readonly string[];
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.indexOf('--only');
  const only = onlyArg >= 0 && args[onlyArg + 1] ? new Set(args[onlyArg + 1].split(',')) : null;

  if (!existsSync(FFMPEG)) throw new Error(`ffmpeg not found at ${FFMPEG}`);
  if (!existsSync(FFPROBE)) throw new Error(`ffprobe not found at ${FFPROBE}`);
  for (const cue of CUES) {
    if (PROTECTED_VOCALS.has(cue.id)) throw new Error(`cue id collides with a protected TTS vocal: ${cue.id}`);
  }
  const ids = new Set<string>();
  for (const cue of CUES) {
    if (ids.has(cue.id)) throw new Error(`duplicate cue id: ${cue.id}`);
    ids.add(cue.id);
  }

  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), 'gunner-sfx-'));
  const rows: Row[] = [];
  const skipped: string[] = [];
  let failures = 0;

  try {
    for (const cue of CUES) {
      if (only && !only.has(cue.id)) continue;
      const mp3Path = join(outDir, `${cue.id}.mp3`);
      if (existsSync(mp3Path) && !force) {
        skipped.push(cue.id);
        continue;
      }

      const rng = mulberry32(hashId(cue.id));
      const totalSec = cue.dur + (cue.loopXf ?? 0);
      let buf = cue.render(rng, totalSec);
      if (buf.length !== N(totalSec)) {
        throw new Error(`${cue.id}: render returned ${buf.length} samples, expected ${N(totalSec)}`);
      }
      buf = dcBlock(buf);
      if (cue.loopXf !== undefined) {
        buf = crossfadeLoop(buf, N(cue.dur), N(cue.loopXf));
        matchLoopSeam(buf);
      } else {
        fadeInMs(buf, 1.5);
        fadeOutMs(buf, 6);
      }
      normalizeTo(buf, PEAK_TARGET);

      const wavPath = join(tmp, `${cue.id}.wav`);
      writeWav16(wavPath, buf);
      execFileSync(FFMPEG, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        wavPath,
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '128k',
        mp3Path,
      ]);
      unlinkSync(wavPath);

      // QC gates: duration within 10% (plus mp3 frame-padding allowance),
      // peak <= -1.0 dBFS, no DC drift, loop seam RMS continuity.
      const mp3Dur = probeDuration(mp3Path);
      const peakDb = toDb(peakOf(buf));
      const rmsDb = toDb(rmsOf(buf, 0, buf.length));
      const dc = Math.abs(meanOf(buf));
      const issues: string[] = [];
      if (mp3Dur <= 0) issues.push('zero duration');
      if (mp3Dur < cue.dur * 0.9 || mp3Dur > cue.dur * 1.1 + 0.09) {
        issues.push(`dur ${mp3Dur.toFixed(3)}s off spec ${cue.dur}s`);
      }
      if (peakDb > -1.0) issues.push(`peak ${peakDb.toFixed(2)} dBFS > -1.0`);
      if (dc > 1e-3) issues.push(`DC offset ${dc.toExponential(2)}`);
      let seamDb: number | null = null;
      if (cue.loopXf !== undefined) {
        const w = N(0.005);
        const rsDb = toDb(rmsOf(buf, 0, w));
        const reDb = toDb(rmsOf(buf, buf.length - w, buf.length));
        seamDb = Math.abs(rsDb - reDb);
        const bothQuiet = rsDb < -45 && reDb < -45;
        if (seamDb > 1.5 && !bothQuiet) issues.push(`loop seam ${seamDb.toFixed(2)} dB`);
      }
      if (issues.length > 0) failures++;
      rows.push({
        id: cue.id,
        kind: cue.loopXf !== undefined ? 'loop' : 'one-shot',
        specDur: cue.dur,
        mp3Dur,
        peakDb,
        rmsDb,
        seamDb,
        issues,
      });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  console.log(
    pad('id', 18) + pad('kind', 10) + pad('spec s', 8) + pad('mp3 s', 8) + pad('peak dB', 10) + pad('RMS dB', 9) + pad('seam dB', 9) + 'status',
  );
  for (const r of rows) {
    console.log(
      pad(r.id, 18) +
        pad(r.kind, 10) +
        pad(r.specDur.toFixed(2), 8) +
        pad(r.mp3Dur.toFixed(3), 8) +
        pad(r.peakDb.toFixed(2), 10) +
        pad(r.rmsDb.toFixed(2), 9) +
        pad(r.seamDb === null ? '-' : r.seamDb.toFixed(2), 9) +
        (r.issues.length === 0 ? 'ok' : `FAIL: ${r.issues.join('; ')}`),
    );
  }
  if (skipped.length > 0) console.log(`\nskipped (exists, use --force): ${skipped.join(', ')}`);
  console.log(`\n${rows.length} rendered, ${skipped.length} skipped, ${failures} QC failures`);
  if (failures > 0) process.exitCode = 1;
}

main();
