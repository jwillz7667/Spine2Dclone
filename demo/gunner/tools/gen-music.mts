// gen-music.mts, the offline underscore synthesizer for "GUNNER!".
// Renders every cue to demo/gunner/audio/music/<cue>.wav as 22050 Hz mono 16-bit PCM.
// Pure Node (node:fs / node:path / node:url only), fully deterministic: all noise
// comes from a seeded mulberry32 PRNG, never Math.random.
//
// Run from repo root:
//   packages/render-preview/node_modules/.bin/tsx demo/gunner/tools/gen-music.mts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
const TWO_PI = Math.PI * 2;
// Normalization target just under -1 dBFS (10^(-1/20) = 0.8913) so the decoded
// int16 peak stays safely at or below 0.891.
const PEAK_TARGET = 0.89;

// ---------------------------------------------------------------------------
// Deterministic PRNG
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

// ---------------------------------------------------------------------------
// Pitch helpers
// ---------------------------------------------------------------------------

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function p(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note name: ${name}`);
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return 12 * (parseInt(m[3], 10) + 1) + SEMITONE[m[1]] + acc;
}

const midiFreq = (m: number): number => 440 * 2 ** ((m - 69) / 12);
const lpCoef = (fc: number): number => 1 - Math.exp((-TWO_PI * fc) / SR);

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

interface Vibrato {
  rate: number;
  cents: number;
  delay: number;
}

interface PartialSpec {
  ratio: number;
  amp: number;
  tau: number;
}

interface Inst {
  gain: number;
  cutoff: number;
  osc?: "sine" | "tri" | "square" | "saw2" | "leadmix" | "bassmix";
  adsr?: { a: number; d: number; s: number; r: number };
  partials?: PartialSpec[];
  detune?: number; // total cents between the two saws of saw2
  vib?: Vibrato;
}

// Chiptune-adjacent lead: triangle body with a soft square edge, gentle vibrato.
const LEAD: Inst = {
  gain: 0.3,
  osc: "leadmix",
  adsr: { a: 0.012, d: 0.08, s: 0.72, r: 0.12 },
  cutoff: 3200,
  vib: { rate: 5.6, cents: 9, delay: 0.16 },
};

const LEAD_SOFT: Inst = {
  gain: 0.24,
  osc: "tri",
  adsr: { a: 0.03, d: 0.1, s: 0.7, r: 0.18 },
  cutoff: 2400,
  vib: { rate: 5.2, cents: 7, delay: 0.2 },
};

// Warm pad: detuned saw pair through a dark one-pole lowpass.
const PAD: Inst = {
  gain: 0.085,
  osc: "saw2",
  detune: 9,
  adsr: { a: 0.18, d: 0.35, s: 0.8, r: 0.45 },
  cutoff: 1300,
};

const PAD_DARK: Inst = {
  gain: 0.12,
  osc: "saw2",
  detune: 12,
  adsr: { a: 0.25, d: 0.4, s: 0.85, r: 0.8 },
  cutoff: 850,
};

// Round sine-based bass (fundamental plus a whisper of second harmonic).
const BASS: Inst = {
  gain: 0.32,
  osc: "bassmix",
  adsr: { a: 0.008, d: 0.1, s: 0.85, r: 0.08 },
  cutoff: 750,
};

const BRASS: Inst = {
  gain: 0.26,
  osc: "saw2",
  detune: 11,
  adsr: { a: 0.02, d: 0.1, s: 0.85, r: 0.2 },
  cutoff: 2400,
  vib: { rate: 5, cents: 6, delay: 0.25 },
};

const STAB: Inst = {
  gain: 0.22,
  osc: "saw2",
  detune: 8,
  adsr: { a: 0.004, d: 0.3, s: 0.2, r: 0.18 },
  cutoff: 2200,
};

const WALTZ_PAH: Inst = {
  gain: 0.11,
  osc: "saw2",
  detune: 8,
  adsr: { a: 0.03, d: 0.18, s: 0.45, r: 0.2 },
  cutoff: 1400,
};

const ARP_COUNTER: Inst = {
  gain: 0.11,
  osc: "square",
  adsr: { a: 0.004, d: 0.1, s: 0.35, r: 0.06 },
  cutoff: 1700,
};

// Struck/plucked voices built from decaying sine partials (dur is spacing only).
const BELL: Inst = {
  gain: 0.2,
  cutoff: 6000,
  partials: [
    { ratio: 1, amp: 1, tau: 0.7 },
    { ratio: 3, amp: 0.3, tau: 0.3 },
    { ratio: 4, amp: 0.15, tau: 0.18 },
  ],
};

const MUSICBOX: Inst = {
  gain: 0.26,
  cutoff: 5000,
  partials: [
    { ratio: 1, amp: 1, tau: 1.1 },
    { ratio: 2, amp: 0.35, tau: 0.6 },
    { ratio: 3, amp: 0.12, tau: 0.35 },
  ],
};

const SPARKLE: Inst = {
  gain: 0.16,
  cutoff: 7000,
  partials: [
    { ratio: 1, amp: 1, tau: 0.35 },
    { ratio: 2, amp: 0.4, tau: 0.2 },
  ],
};

// ---------------------------------------------------------------------------
// Voice rendering
// ---------------------------------------------------------------------------

function writeAt(dst: Float64Array, idx: number, v: number, loop: boolean): void {
  if (loop) {
    const n = dst.length;
    dst[((idx % n) + n) % n] += v;
  } else if (idx >= 0 && idx < dst.length) {
    dst[idx] += v;
  }
}

function renderNote(
  dst: Float64Array,
  loop: boolean,
  startSec: number,
  midi: number,
  durSec: number,
  vel: number,
  inst: Inst,
): void {
  const f0 = midiFreq(midi);
  const start = Math.round(startSec * SR);
  const k = lpCoef(inst.cutoff);
  let lp = 0;

  if (inst.partials) {
    const parts = inst.partials.filter((q) => f0 * q.ratio < SR * 0.45);
    if (parts.length === 0) return;
    let maxTau = 0;
    for (const q of parts) maxTau = Math.max(maxTau, q.tau);
    const total = Math.min(4 * maxTau, 4.5);
    const n = Math.floor(total * SR);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let x = 0;
      for (const q of parts) x += q.amp * Math.exp(-t / q.tau) * Math.sin(TWO_PI * f0 * q.ratio * t);
      const att = Math.min(1, t / 0.002);
      lp += k * (x - lp);
      writeAt(dst, start + i, lp * att * vel * inst.gain, loop);
    }
    return;
  }

  const e = inst.adsr;
  const osc = inst.osc;
  if (!e || !osc) throw new Error("instrument needs adsr+osc or partials");
  const total = durSec + e.r;
  const n = Math.floor(total * SR);
  const gate = (t: number): number =>
    t < e.a ? t / e.a : t < e.a + e.d ? 1 - (1 - e.s) * ((t - e.a) / e.d) : e.s;
  const endLevel = gate(Math.max(durSec, 0.0001));
  const det = osc === "saw2" ? 2 ** ((inst.detune ?? 8) / 2 / 1200) : 1;
  let ph1 = 0;
  let ph2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = t < durSec ? gate(t) : endLevel * Math.max(0, 1 - (t - durSec) / e.r);
    let f = f0;
    if (inst.vib && t > inst.vib.delay) {
      const ramp = Math.min(1, (t - inst.vib.delay) / 0.3);
      f *= 2 ** ((inst.vib.cents * ramp * Math.sin(TWO_PI * inst.vib.rate * (t - inst.vib.delay))) / 1200);
    }
    ph1 += (f * det) / SR;
    ph2 += f / det / SR;
    ph1 -= Math.floor(ph1);
    ph2 -= Math.floor(ph2);
    let x: number;
    switch (osc) {
      case "sine":
        x = Math.sin(TWO_PI * ph1);
        break;
      case "tri":
        x = 1 - 4 * Math.abs(ph1 - 0.5);
        break;
      case "square":
        x = ph1 < 0.5 ? 0.8 : -0.8;
        break;
      case "saw2":
        x = (ph1 * 2 - 1) * 0.5 + (ph2 * 2 - 1) * 0.5;
        break;
      case "leadmix":
        x = (1 - 4 * Math.abs(ph1 - 0.5)) * 0.62 + (ph1 < 0.5 ? 0.3 : -0.3);
        break;
      case "bassmix":
        x = Math.sin(TWO_PI * ph1) + 0.35 * Math.sin(2 * TWO_PI * ph1);
        break;
    }
    lp += k * (x - lp);
    writeAt(dst, start + i, lp * env * vel * inst.gain, loop);
  }
}

// ---------------------------------------------------------------------------
// Percussion (writes straight into the mix buffer)
// ---------------------------------------------------------------------------

function drumKick(dst: Float64Array, loop: boolean, tSec: number, vel: number, rng: Rng, soft: boolean): void {
  const n = Math.floor(0.24 * SR);
  const start = Math.round(tSec * SR);
  const f0 = soft ? 95 : 155;
  const f1 = soft ? 42 : 48;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.045);
    phase += (TWO_PI * f) / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t / (soft ? 0.09 : 0.115));
    let v = Math.sin(phase) * env;
    if (!soft && t < 0.004) v += (rng() * 2 - 1) * 0.25 * env;
    writeAt(dst, start + i, v * vel * 1.0, loop);
  }
}

function drumSnare(dst: Float64Array, loop: boolean, tSec: number, vel: number, rng: Rng): void {
  const n = Math.floor(0.2 * SR);
  const start = Math.round(tSec * SR);
  const k = lpCoef(1100);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    lp += k * (white - lp);
    const hp = white - lp;
    phase += (TWO_PI * 190) / SR;
    const v =
      (hp * 0.9 * Math.exp(-t / 0.06) + Math.sin(phase) * 0.55 * Math.exp(-t / 0.04)) *
      Math.min(1, t / 0.002);
    writeAt(dst, start + i, v * vel * 0.8, loop);
  }
}

function drumHat(dst: Float64Array, loop: boolean, tSec: number, vel: number, rng: Rng, open: boolean): void {
  const n = Math.floor((open ? 0.25 : 0.07) * SR);
  const start = Math.round(tSec * SR);
  const k = lpCoef(5200);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    lp += k * (white - lp);
    const hp = white - lp;
    const env = Math.exp(-t / (open ? 0.09 : 0.02));
    writeAt(dst, start + i, hp * env * vel * 0.5, loop);
  }
}

function drumTom(dst: Float64Array, loop: boolean, tSec: number, vel: number, freq: number, rng: Rng): void {
  const n = Math.floor(0.3 * SR);
  const start = Math.round(tSec * SR);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freq * (1 + 0.3 * Math.exp(-t / 0.04));
    phase += (TWO_PI * f) / SR;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.13);
    const v = (Math.sin(phase) + (rng() * 2 - 1) * 0.12) * env;
    writeAt(dst, start + i, v * vel * 0.8, loop);
  }
}

function drumCrash(dst: Float64Array, loop: boolean, tSec: number, vel: number, rng: Rng): void {
  const n = Math.floor(1.3 * SR);
  const start = Math.round(tSec * SR);
  const k = lpCoef(3800);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const white = rng() * 2 - 1;
    lp += k * (white - lp);
    const hp = white - lp;
    const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.4);
    writeAt(dst, start + i, hp * env * vel * 0.45, loop);
  }
}

// ---------------------------------------------------------------------------
// Cue model
// ---------------------------------------------------------------------------

interface NoteEv {
  t: number; // beats
  midi: number;
  dur: number; // beats
  vel: number;
}

interface TrackSpec {
  inst: Inst;
  notes: NoteEv[];
}

type DrumType = "kick" | "kickSoft" | "snare" | "hat" | "openhat" | "tom" | "crash";

interface DrumEv {
  t: number; // beats
  type: DrumType;
  vel: number;
  freq?: number; // toms only
}

interface CueSpec {
  name: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  durSec?: number; // one-shot override; loop cues always use the bar grid
  loop: boolean;
  seed: number;
  drive?: number; // master soft-clip drive
  tracks: TrackSpec[];
  drums: DrumEv[];
}

function N(t: number, name: string, dur: number, vel: number): NoteEv {
  return { t, midi: p(name), dur, vel };
}

function Nm(t: number, midi: number, dur: number, vel: number): NoteEv {
  return { t, midi, dur, vel };
}

function chordNm(t: number, midis: number[], dur: number, vel: number): NoteEv[] {
  return midis.map((midi) => ({ t, midi, dur, vel }));
}

// The Gunner motif ("LIT-tle legs, BIG HEART"): G4 G4 A4 B4 then a held D5.
// semis transposes, holdDur is the length of the held top note in beats.
function motif(t: number, semis: number, vel: number, holdDur: number, step = 0.5): NoteEv[] {
  const base = [67, 67, 69, 71, 74].map((m) => m + semis);
  return [
    Nm(t, base[0], step * 0.9, vel),
    Nm(t + step, base[1], step * 0.9, vel),
    Nm(t + 2 * step, base[2], step * 0.9, vel),
    Nm(t + 3 * step, base[3], step * 0.9, vel),
    Nm(t + 4 * step, base[4], holdDur, Math.min(1, vel + 0.05)),
  ];
}

function hats8(drums: DrumEv[], from: number, to: number, hi: number, lo: number): void {
  for (let b = from; b < to - 1e-9; b += 0.5) {
    drums.push({ t: b, type: "hat", vel: Number.isInteger(b) ? hi : lo });
  }
}

// Shared triad voicings around octave 4 (C major family).
const V: Record<string, number[]> = {
  C: [60, 64, 67],
  F: [60, 65, 69],
  G: [59, 62, 67],
  Am: [57, 60, 64],
  Em: [55, 59, 64],
  Dm: [57, 62, 65],
};

// ---------------------------------------------------------------------------
// Cue 1: theme (132 bpm, 11 bars of 4/4 = exactly 20.0 s)
// ---------------------------------------------------------------------------

function themeCue(): CueSpec {
  const lead: NoteEv[] = [
    // Bouncy 2-bar intro arp.
    N(0, "C5", 0.45, 0.7), N(0.5, "E5", 0.45, 0.7), N(1, "G5", 0.9, 0.75),
    N(2, "E5", 0.45, 0.7), N(2.5, "G5", 0.45, 0.7), N(3, "A5", 0.9, 0.75),
    N(4, "G5", 0.45, 0.7), N(4.5, "E5", 0.45, 0.68), N(5, "D5", 0.45, 0.68),
    N(5.5, "C5", 0.45, 0.68), N(6, "D5", 1.4, 0.72),
    // Motif statement 1.
    ...motif(8, 0, 0.85, 3.5),
    N(14, "C5", 0.45, 0.7), N(14.5, "B4", 0.45, 0.7), N(15, "A4", 0.45, 0.7), N(15.5, "B4", 0.45, 0.72),
    // Answer phrase.
    N(16, "E5", 1, 0.8), N(17, "D5", 0.45, 0.75), N(17.5, "C5", 0.45, 0.75),
    N(18, "A4", 1, 0.75), N(19, "G4", 1, 0.72),
    N(20, "A4", 0.45, 0.72), N(20.5, "C5", 0.45, 0.75), N(21, "D5", 2, 0.8),
    // Motif statement 2, up an octave, with diatonic thirds below.
    ...motif(24, 12, 0.88, 3),
    N(24, "E5", 0.45, 0.55), N(24.5, "E5", 0.45, 0.55), N(25, "F5", 0.45, 0.55),
    N(25.5, "G5", 0.45, 0.55), N(26, "B5", 3, 0.58),
    // Turnaround.
    N(32, "E5", 0.45, 0.78), N(32.5, "D5", 0.45, 0.75), N(33, "C5", 0.45, 0.75),
    N(33.5, "D5", 0.45, 0.75), N(34, "E5", 1, 0.78), N(35, "G5", 1, 0.8),
    N(36, "A5", 0.45, 0.8), N(36.5, "G5", 0.45, 0.76), N(37, "E5", 0.45, 0.74),
    N(37.5, "D5", 0.45, 0.72), N(38, "C5", 0.9, 0.75),
    // Pickup and button.
    N(39.5, "D5", 0.4, 0.85), N(40, "E5", 2.5, 0.95),
  ];

  const padBars = [V.C, V.F, V.C, V.G, V.F, V.C, V.C, V.G, V.F, V.G];
  const pads: NoteEv[] = padBars.flatMap((ch, b) => chordNm(4 * b, ch, 3.9, 0.5));
  pads.push(...chordNm(40, V.C, 2.4, 0.55));

  const bassBars: number[][] = [
    [36, 40, 43, 45], [41, 45, 48, 47], [36, 43, 40, 43], [43, 47, 50, 47],
    [41, 45, 48, 45], [36, 40, 43, 45], [36, 43, 36, 43], [43, 47, 50, 47],
    [41, 45, 48, 50],
  ];
  const bass: NoteEv[] = bassBars.flatMap((walk, b) => walk.map((m, q) => Nm(4 * b + q, m, 0.9, 0.8)));
  bass.push(Nm(36, 43, 0.9, 0.8), Nm(37, 45, 0.9, 0.8), Nm(38, 47, 0.9, 0.8));
  bass.push(Nm(39.5, 43, 0.4, 0.85), Nm(40, 36, 2.5, 0.95));

  const drums: DrumEv[] = [];
  hats8(drums, 0, 40, 0.42, 0.26);
  for (let b = 0; b < 9; b++) {
    drums.push({ t: 4 * b, type: "kick", vel: 0.9 }, { t: 4 * b + 2, type: "kick", vel: 0.75 });
    drums.push({ t: 4 * b + 1, type: "snare", vel: 0.65 }, { t: 4 * b + 3, type: "snare", vel: 0.65 });
  }
  // Bar 10 fill into the button.
  drums.push(
    { t: 36, type: "kick", vel: 0.9 }, { t: 37, type: "snare", vel: 0.65 }, { t: 38, type: "kick", vel: 0.7 },
    { t: 38.5, type: "tom", vel: 0.6, freq: 170 }, { t: 39, type: "tom", vel: 0.66, freq: 135 },
    { t: 39.5, type: "snare", vel: 0.6 },
    { t: 8, type: "crash", vel: 0.45 }, { t: 24, type: "crash", vel: 0.5 },
    { t: 40, type: "kick", vel: 1 }, { t: 40, type: "snare", vel: 0.8 }, { t: 40, type: "crash", vel: 0.8 },
  );

  return {
    name: "theme", bpm: 132, beatsPerBar: 4, bars: 11, loop: false, seed: 101,
    tracks: [
      { inst: LEAD, notes: lead },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
      { inst: STAB, notes: chordNm(40, [60, 64, 67, 72], 2.2, 0.9) },
      { inst: SPARKLE, notes: [Nm(40.5, 84, 0.5, 0.4), Nm(40.75, 91, 0.5, 0.35)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 2: meadow (112 bpm, 14 bars = exactly 30.0 s, seamless loop)
// ---------------------------------------------------------------------------

function meadowCue(): CueSpec {
  const lead: NoteEv[] = [
    N(2, "E5", 0.45, 0.55), N(2.5, "D5", 0.45, 0.5), N(3, "C5", 0.45, 0.5), N(4, "D5", 1.4, 0.55),
    // Hidden motif fragment, soft.
    N(8, "G4", 0.45, 0.5), N(8.5, "G4", 0.45, 0.48), N(9, "A4", 0.45, 0.5), N(9.5, "B4", 0.45, 0.5),
    N(10, "D5", 1.8, 0.55), N(13, "C5", 0.9, 0.5),
    N(16, "A4", 0.9, 0.52), N(17, "C5", 0.9, 0.52), N(18, "B4", 0.45, 0.5), N(18.5, "A4", 0.45, 0.48),
    N(19, "G4", 0.9, 0.5), N(20, "A4", 1.8, 0.52),
    N(24, "E5", 0.45, 0.52), N(24.5, "G5", 0.45, 0.5), N(25, "E5", 0.9, 0.5), N(26, "D5", 1.4, 0.52),
    N(28, "B4", 0.9, 0.5), N(29, "A4", 0.45, 0.48), N(29.5, "B4", 0.45, 0.48), N(30, "D5", 1.4, 0.52),
    N(33, "E5", 0.45, 0.5), N(33.5, "D5", 0.45, 0.48), N(34, "C5", 0.9, 0.5), N(35, "A4", 0.9, 0.48),
    N(36, "C5", 1.8, 0.52),
    N(40, "A4", 0.9, 0.5), N(41, "B4", 0.9, 0.5), N(42, "C5", 1.4, 0.52),
    N(44, "B4", 0.9, 0.5), N(45, "G4", 0.9, 0.48), N(46, "E4", 1.4, 0.48),
    N(48, "A4", 0.9, 0.5), N(49, "C5", 0.9, 0.5), N(50, "D5", 1.8, 0.54),
    // Second motif fragment leaning into the loop point.
    N(52, "G4", 0.45, 0.48), N(52.5, "A4", 0.45, 0.48), N(53, "B4", 0.9, 0.5), N(54, "D5", 1.4, 0.54),
  ];

  const padBars = [V.C, V.F, V.C, V.F, V.Am, V.F, V.C, V.G, V.C, V.F, V.Am, V.Em, V.F, V.G];
  const pads: NoteEv[] = padBars.flatMap((ch, b) => chordNm(4 * b, ch, 3.9, 0.42));

  const bassPairs: Record<string, [number, number]> = {
    C: [36, 43], F: [41, 48], Am: [45, 40], Em: [40, 47], G: [43, 38],
  };
  const barNames = ["C", "F", "C", "F", "Am", "F", "C", "G", "C", "F", "Am", "Em", "F", "G"];
  const bass: NoteEv[] = barNames.flatMap((nm, b) => {
    const [root, fifth] = bassPairs[nm];
    return [Nm(4 * b, root, 1.8, 0.6), Nm(4 * b + 2, fifth, 1.8, 0.5)];
  });

  const drums: DrumEv[] = [];
  hats8(drums, 0, 56, 0.26, 0.16);
  for (let b = 0; b < 14; b++) {
    drums.push({ t: 4 * b, type: "kickSoft", vel: 0.5 }, { t: 4 * b + 2, type: "kickSoft", vel: 0.32 });
  }

  return {
    name: "meadow", bpm: 112, beatsPerBar: 4, bars: 14, loop: true, seed: 202,
    tracks: [
      { inst: LEAD_SOFT, notes: lead },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
      { inst: SPARKLE, notes: [Nm(14, 88, 0.5, 0.3), Nm(31.5, 91, 0.5, 0.25), Nm(47, 84, 0.5, 0.25)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 3: tension-rise (6.0 s one-shot sting, unresolved)
// ---------------------------------------------------------------------------

function tensionRiseCue(): CueSpec {
  const spb = 60 / 120;
  const pads: NoteEv[] = [];
  // Chromatic rising cluster, one step every 0.75 s, a steep crescendo
  // (starting near-silent keeps the sting's average level low).
  for (let s = 0; s < 6; s++) {
    pads.push(...chordNm(1.5 * s, [57 + s, 60 + s, 64 + s], 1.7, 0.16 + 0.065 * s));
  }
  // The crescendo cuts to an open, unresolved cluster (D F G# B) left hanging
  // quietly: the "ends open" question mark and the quiet tail in one gesture.
  pads.push(...chordNm(9, [62, 65, 68, 71], 2.4, 0.2));

  const drums: DrumEv[] = [];
  // Accelerating hats, computed in seconds and converted to beats.
  let t = 0;
  let gap = 0.34;
  while (t < 4.5) {
    drums.push({ t: t / spb, type: "hat", vel: 0.18 + (t / 4.5) * 0.4 });
    t += gap;
    gap = Math.max(0.08, gap * 0.88);
  }
  // A single open-hat accent at the apex, right before the bottom drops out.
  drums.push({ t: 9, type: "openhat", vel: 0.85 });

  return {
    name: "tension-rise", bpm: 120, beatsPerBar: 4, bars: 3, durSec: 6, loop: false, seed: 303,
    tracks: [
      { inst: PAD_DARK, notes: pads },
      { inst: BASS, notes: [Nm(0, 33, 9, 0.25)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 4: chase (150 bpm, 20 bars = exactly 32.0 s, seamless loop)
// ---------------------------------------------------------------------------

function chaseLeadPhrase(o: number): NoteEv[] {
  return [
    N(o, "G5", 0.4, 0.8), N(o + 0.75, "E5", 0.35, 0.7), N(o + 1.5, "G5", 0.4, 0.75),
    N(o + 2.25, "A5", 0.4, 0.78), N(o + 3, "G5", 0.9, 0.8),
    N(o + 4.5, "E5", 0.4, 0.72), N(o + 5.25, "D5", 0.4, 0.7), N(o + 6, "C5", 0.9, 0.75),
    N(o + 7, "D5", 0.4, 0.7), N(o + 7.5, "E5", 0.4, 0.72),
    N(o + 8, "A5", 0.4, 0.8), N(o + 8.75, "G5", 0.35, 0.72), N(o + 9.5, "A5", 0.4, 0.75),
    N(o + 10.25, "C6", 0.4, 0.8), N(o + 11, "A5", 0.9, 0.8),
    N(o + 12, "G5", 0.4, 0.75), N(o + 12.5, "A5", 0.4, 0.75), N(o + 13, "B5", 0.65, 0.78),
    N(o + 14, "D6", 1.2, 0.82),
  ];
}

function chaseCue(): CueSpec {
  const lead: NoteEv[] = [];
  for (let c = 0; c < 5; c++) {
    const phrase = chaseLeadPhrase(16 * c);
    if (c === 4) {
      // Last cycle: swap the final bar for a rising run back to the loop top.
      lead.push(...phrase.filter((ev) => ev.t < 16 * c + 12));
      lead.push(
        N(76, "G4", 0.4, 0.7), N(76.5, "A4", 0.4, 0.72), N(77, "B4", 0.4, 0.74), N(77.5, "D5", 0.4, 0.76),
        N(78, "E5", 0.4, 0.78), N(78.5, "G5", 0.4, 0.8), N(79, "A5", 0.85, 0.82),
      );
    } else {
      lead.push(...phrase);
    }
  }

  const cycleChords = [V.C, V.Am, V.F, V.G];
  const cycleRoots = [36, 45, 41, 43];
  const pads: NoteEv[] = [];
  const bass: NoteEv[] = [];
  const gallop = [0, 0, 12, 0, 0, 12, 7, 12];
  const gallopVel = [0.85, 0.6, 0.7, 0.6, 0.85, 0.6, 0.7, 0.7];
  for (let b = 0; b < 20; b++) {
    pads.push(...chordNm(4 * b, cycleChords[b % 4], 3.8, 0.38));
    const root = cycleRoots[b % 4];
    for (let e = 0; e < 8; e++) bass.push(Nm(4 * b + e * 0.5, root + gallop[e], 0.38, gallopVel[e]));
  }

  const drums: DrumEv[] = [];
  hats8(drums, 0, 80, 0.4, 0.24);
  const fillBars = new Set([3, 7, 11, 15]);
  for (let b = 0; b < 20; b++) {
    drums.push({ t: 4 * b, type: "kick", vel: 0.9 }, { t: 4 * b + 2, type: "kick", vel: 0.8 });
    drums.push({ t: 4 * b + 1, type: "snare", vel: 0.65 });
    if (fillBars.has(b)) {
      drums.push(
        { t: 4 * b + 2.5, type: "tom", vel: 0.65, freq: 170 },
        { t: 4 * b + 3, type: "tom", vel: 0.68, freq: 135 },
        { t: 4 * b + 3.5, type: "tom", vel: 0.72, freq: 105 },
      );
    } else {
      drums.push({ t: 4 * b + 3, type: "snare", vel: 0.65 });
    }
  }

  return {
    name: "chase", bpm: 150, beatsPerBar: 4, bars: 20, loop: true, seed: 404,
    tracks: [
      { inst: LEAD, notes: lead },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 5: lost (80 bpm, 7 bars = exactly 21.0 s, seamless loop, A minor)
// ---------------------------------------------------------------------------

function lostCue(): CueSpec {
  const box: NoteEv[] = [
    N(0, "A5", 1, 0.6), N(1.5, "B5", 0.5, 0.5), N(2, "C6", 2, 0.6),
    N(4, "A5", 1, 0.55), N(5.5, "G5", 0.5, 0.5), N(6, "E5", 2, 0.55),
    N(8, "G5", 1.5, 0.55), N(10, "E5", 1, 0.5), N(11, "D5", 1, 0.5),
    N(12, "B5", 1.5, 0.55), N(14, "G5", 2, 0.5),
    N(16, "A5", 1, 0.55), N(17.5, "C6", 0.5, 0.5), N(18, "B5", 2, 0.55),
    N(20, "A5", 1.5, 0.5), N(22, "F5", 1, 0.48), N(23, "E5", 1, 0.48),
    N(24, "G5", 1.5, 0.5), N(26, "B5", 1, 0.5), N(27, "E5", 1, 0.45),
  ];

  const padBars: number[][] = [
    [57, 60, 64], [53, 57, 60], [55, 60, 64], [52, 55, 59], [57, 60, 64], [50, 53, 57], [52, 55, 59],
  ];
  const pads: NoteEv[] = padBars.flatMap((ch, b) => chordNm(4 * b, ch, 3.9, 0.35));

  const roots = [45, 41, 36, 40, 45, 38, 40];
  const bass: NoteEv[] = roots.map((r, b) => Nm(4 * b, r, 3, 0.4));

  const drums: DrumEv[] = [];
  for (let b = 0; b < 7; b++) {
    drums.push({ t: 4 * b, type: "kickSoft", vel: 0.45 }, { t: 4 * b + 0.45, type: "kickSoft", vel: 0.28 });
  }

  return {
    name: "lost", bpm: 80, beatsPerBar: 4, bars: 7, loop: true, seed: 505,
    tracks: [
      { inst: MUSICBOX, notes: box },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 6: hope-sting (4.0 s one-shot)
// ---------------------------------------------------------------------------

function hopeStingCue(): CueSpec {
  return {
    name: "hope-sting", bpm: 120, beatsPerBar: 4, bars: 2, durSec: 4, loop: false, seed: 606,
    tracks: [
      {
        inst: LEAD_SOFT,
        notes: [
          // The motif's first three notes, hesitant.
          N(0, "G4", 0.7, 0.55), N(0.9, "G4", 0.7, 0.5), N(1.8, "A4", 0.9, 0.6),
          // The fourth note blooms.
          N(2.8, "B4", 3.2, 0.8),
        ],
      },
      {
        inst: PAD,
        notes: [
          ...chordNm(0, [55, 62], 2.6, 0.26), // bare open fifth: the question
          ...chordNm(2.8, [55, 59, 62, 67], 3.2, 0.44), // G major bloom
        ],
      },
      { inst: BASS, notes: [Nm(2.8, 43, 3.2, 0.4)] },
      {
        inst: SPARKLE,
        notes: [74, 79, 83, 86, 91].map((m, i) => Nm(3 + i * 0.2, m, 0.5, 0.5 - i * 0.04)),
      },
    ],
    drums: [{ t: 2.8, type: "crash", vel: 0.18 }],
  };
}

// ---------------------------------------------------------------------------
// Cue 7: chase-final (158 bpm, 16 bars = 24.304 s, seamless loop, D major)
// ---------------------------------------------------------------------------

function chaseFinalPhrase(o: number): NoteEv[] {
  return [
    N(o, "A5", 0.4, 0.82), N(o + 0.75, "F#5", 0.35, 0.72), N(o + 1.5, "A5", 0.4, 0.76),
    N(o + 2.25, "B5", 0.4, 0.8), N(o + 3, "A5", 0.9, 0.82),
    N(o + 4.5, "F#5", 0.4, 0.72), N(o + 5.25, "E5", 0.4, 0.7), N(o + 6, "D5", 0.9, 0.76),
    N(o + 7, "E5", 0.4, 0.7), N(o + 7.5, "F#5", 0.4, 0.74),
    N(o + 8, "B5", 0.4, 0.8), N(o + 8.75, "A5", 0.35, 0.72), N(o + 9.5, "B5", 0.4, 0.76),
    N(o + 10.25, "D6", 0.4, 0.82), N(o + 11, "B5", 0.9, 0.8),
    N(o + 12, "A5", 0.4, 0.76), N(o + 12.5, "B5", 0.4, 0.76), N(o + 13, "C#6", 0.65, 0.8),
    N(o + 14, "E6", 1.2, 0.84),
  ];
}

function chaseFinalCue(): CueSpec {
  const lead: NoteEv[] = [];
  lead.push(...chaseFinalPhrase(0), ...chaseFinalPhrase(16));
  // Cycle 3 opens with the motif blast (in D, up an octave: A5 A5 B5 C#6 E6).
  lead.push(...motif(32, 14, 0.88, 1.8), ...chaseFinalPhrase(32).filter((ev) => ev.t >= 36));
  // Cycle 4 ends with a run that hands back to the loop top.
  lead.push(...chaseFinalPhrase(48).filter((ev) => ev.t < 61));
  lead.push(N(61, "C#6", 0.4, 0.78), N(61.5, "D6", 0.4, 0.8), N(62, "E6", 0.9, 0.84));

  const chordTones: number[][] = [
    [62, 66, 69, 74], // D
    [59, 62, 66, 71], // Bm
    [55, 59, 62, 67], // G
    [57, 61, 64, 69], // A
  ];
  const padChords: number[][] = [[62, 66, 69], [59, 62, 66], [59, 62, 67], [61, 64, 69]];
  const roots = [38, 47, 43, 45];
  const pads: NoteEv[] = [];
  const bass: NoteEv[] = [];
  const counter: NoteEv[] = [];
  const gallop = [0, 0, 12, 0, 0, 12, 7, 12];
  const gallopVel = [0.75, 0.5, 0.6, 0.5, 0.75, 0.5, 0.6, 0.6];
  const arpIdx = [0, 2, 1, 3, 0, 2, 1, 3];
  for (let b = 0; b < 16; b++) {
    pads.push(...chordNm(4 * b, padChords[b % 4], 3.8, 0.35));
    const root = roots[b % 4];
    const tones = chordTones[b % 4];
    for (let e = 0; e < 8; e++) {
      bass.push(Nm(4 * b + e * 0.5, root + gallop[e], 0.38, gallopVel[e]));
      counter.push(Nm(4 * b + e * 0.5, tones[arpIdx[e]], 0.35, 0.33));
    }
  }

  const drums: DrumEv[] = [];
  hats8(drums, 0, 64, 0.42, 0.26);
  const fillBars = new Set([3, 7, 11, 15]);
  for (let b = 0; b < 16; b++) {
    drums.push({ t: 4 * b, type: "kick", vel: 0.9 }, { t: 4 * b + 2, type: "kick", vel: 0.8 });
    // Driving snare on all four beats.
    drums.push(
      { t: 4 * b, type: "snare", vel: 0.42 },
      { t: 4 * b + 1, type: "snare", vel: 0.7 },
      { t: 4 * b + 2, type: "snare", vel: 0.48 },
    );
    if (fillBars.has(b)) {
      drums.push(
        { t: 4 * b + 2.5, type: "tom", vel: 0.7, freq: 170 },
        { t: 4 * b + 3, type: "tom", vel: 0.72, freq: 135 },
        { t: 4 * b + 3.5, type: "tom", vel: 0.75, freq: 105 },
      );
    } else {
      drums.push({ t: 4 * b + 3, type: "snare", vel: 0.7 });
    }
  }

  return {
    name: "chase-final", bpm: 158, beatsPerBar: 4, bars: 16, loop: true, seed: 707,
    tracks: [
      { inst: { ...LEAD, gain: 0.26 }, notes: lead },
      { inst: ARP_COUNTER, notes: counter },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 8: climax (100 bpm, 15.0 s one-shot; motif blasts at exactly 10.0 s)
// ---------------------------------------------------------------------------

function climaxCue(): CueSpec {
  const m = 50 / 3; // 10.0 s expressed in beats at 100 bpm

  const rise: NoteEv[] = [];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77];
  for (let c = 0; c < 8; c++) {
    for (let j = 0; j < 4; j++) rise.push(Nm(2 * c + 0.5 * j, scale[c + j], 0.4, 0.4 + 0.05 * c));
  }

  const pads: NoteEv[] = [
    ...chordNm(0, [48, 55], 4.2, 0.35),
    ...chordNm(4, [50, 57], 4.2, 0.42),
    ...chordNm(8, [52, 59], 4.2, 0.5),
    ...chordNm(12, [53, 60], 4.4, 0.58),
    ...chordNm(m + 2, [48, 55, 60, 64, 67], 5.4, 0.7), // Cadd9 wall under the held D5
  ];

  const bass: NoteEv[] = [
    Nm(0, 36, m, 0.65), // low C pedal, the strain
    Nm(m, 36, 2, 0.9),
    Nm(m + 2, 36, 5.4, 0.95),
  ];

  const drums: DrumEv[] = [];
  for (let b = 0; b < 8.1; b += 0.5) drums.push({ t: b, type: "hat", vel: 0.3 });
  for (let b = 8; b < m - 0.01; b += 0.25) drums.push({ t: b, type: "hat", vel: 0.3 + ((b - 8) / 8.67) * 0.3 });
  for (let b = 0; b <= 16; b += 2) drums.push({ t: b, type: "kick", vel: 0.55 + (b / 16) * 0.35 });
  for (let b = 12; b < m - 0.01; b += 0.25) drums.push({ t: b, type: "snare", vel: 0.25 + ((b - 12) / 4.67) * 0.5 });
  drums.push(
    { t: m, type: "kick", vel: 1 }, { t: m, type: "snare", vel: 0.9 }, { t: m, type: "crash", vel: 0.85 },
    { t: m + 0.5, type: "snare", vel: 0.8 }, { t: m + 1, type: "kick", vel: 0.85 },
    { t: m + 1.5, type: "snare", vel: 0.8 }, { t: m + 2, type: "kick", vel: 1 }, { t: m + 2, type: "crash", vel: 0.9 },
  );

  return {
    name: "climax", bpm: 100, beatsPerBar: 4, bars: 6.25, durSec: 15, loop: false, seed: 808,
    tracks: [
      { inst: BRASS, notes: [...rise, ...motif(m, 0, 0.95, 5.5)] },
      { inst: LEAD, notes: motif(m, 12, 0.6, 5.5) }, // octave double on the blast
      { inst: PAD_DARK, notes: pads },
      { inst: BASS, notes: bass },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 9: victory (120 bpm, 5 bars = exactly 10.0 s one-shot)
// ---------------------------------------------------------------------------

function victoryCue(): CueSpec {
  const lead: NoteEv[] = [
    N(0, "C5", 0.4, 0.8), N(0.5, "E5", 0.4, 0.8), N(1, "G5", 0.4, 0.82), N(1.5, "C6", 0.9, 0.85),
    N(3, "D5", 0.4, 0.72), N(3.5, "E5", 0.4, 0.75),
    ...motif(4, 12, 0.88, 3),
    // Diatonic thirds below the motif.
    N(4, "E5", 0.45, 0.55), N(4.5, "E5", 0.45, 0.55), N(5, "F5", 0.45, 0.55),
    N(5.5, "G5", 0.45, 0.55), N(6, "B5", 3, 0.58),
    N(10, "C6", 0.45, 0.8), N(10.5, "B5", 0.45, 0.76), N(11, "A5", 0.45, 0.74), N(11.5, "B5", 0.45, 0.76),
    N(12, "G5", 0.45, 0.74), N(12.5, "A5", 0.45, 0.76), N(13, "B5", 0.45, 0.78),
    N(14, "C6", 4, 0.95),
  ];

  const bells: NoteEv[] = [...motif(4, 12, 0.5, 1), Nm(14, 84, 1, 0.6)];

  const pads: NoteEv[] = [
    ...chordNm(0, V.C, 4, 0.5), ...chordNm(4, V.C, 4, 0.5),
    ...chordNm(8, V.G, 2, 0.5), ...chordNm(10, V.F, 2, 0.5), ...chordNm(12, V.G, 2, 0.55),
    ...chordNm(14, [55, 60, 64, 67, 72], 5, 0.8),
  ];

  const bass: NoteEv[] = [
    ...[36, 43, 40, 43].map((r, q) => Nm(q, r, 0.9, 0.8)),
    ...[36, 40, 43, 45].map((r, q) => Nm(4 + q, r, 0.9, 0.8)),
    ...[43, 47, 41, 45].map((r, q) => Nm(8 + q, r, 0.9, 0.8)),
    Nm(12, 43, 0.9, 0.8), Nm(13, 47, 0.9, 0.85),
    Nm(14, 36, 4, 0.9),
  ];

  const drums: DrumEv[] = [];
  hats8(drums, 0, 13.5, 0.4, 0.25);
  drums.push({ t: 0, type: "kick", vel: 1 }, { t: 0, type: "crash", vel: 0.7 });
  for (let b = 0; b < 3; b++) {
    if (b > 0) drums.push({ t: 4 * b, type: "kick", vel: 0.9 });
    drums.push({ t: 4 * b + 2, type: "kick", vel: 0.75 });
    drums.push({ t: 4 * b + 1, type: "snare", vel: 0.6 }, { t: 4 * b + 3, type: "snare", vel: 0.6 });
  }
  drums.push({ t: 12, type: "kick", vel: 0.85 });
  [0.4, 0.5, 0.6, 0.7].forEach((v, i) => drums.push({ t: 13 + 0.25 * i, type: "snare", vel: v }));
  drums.push({ t: 14, type: "kick", vel: 1 }, { t: 14, type: "snare", vel: 0.85 }, { t: 14, type: "crash", vel: 0.85 });

  return {
    name: "victory", bpm: 120, beatsPerBar: 4, bars: 5, loop: false, seed: 909,
    tracks: [
      { inst: LEAD, notes: lead },
      { inst: BELL, notes: bells },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
      { inst: SPARKLE, notes: [Nm(14.25, 88, 0.5, 0.5), Nm(14.5, 91, 0.5, 0.45), Nm(14.75, 96, 0.5, 0.4)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 10: golden (88 bpm, 3/4 waltz, 12 bars = 24.545 s, seamless loop, F major)
// ---------------------------------------------------------------------------

function goldenCue(): CueSpec {
  const chordMap: Record<string, number[]> = {
    F: [65, 69, 72], Dm: [62, 65, 69], Bb: [62, 65, 70], C: [60, 64, 67], Gm: [62, 67, 70],
  };
  const rootMap: Record<string, number> = { F: 41, Dm: 38, Bb: 46, C: 48, Gm: 43 };
  const barNames = ["F", "Dm", "Bb", "C", "F", "Dm", "Gm", "C", "Bb", "F", "Gm", "C"];

  const bass: NoteEv[] = [];
  const pah: NoteEv[] = [];
  const pads: NoteEv[] = [];
  const drums: DrumEv[] = [];
  barNames.forEach((nm, b) => {
    const o = 3 * b;
    bass.push(Nm(o, rootMap[nm], 1.2, 0.65));
    pah.push(...chordNm(o + 1, chordMap[nm], 0.8, 0.32), ...chordNm(o + 2, chordMap[nm], 0.8, 0.32));
    pads.push(...chordNm(o, chordMap[nm], 2.8, 0.2));
    // A soft downbeat thump keeps the waltz pulse (and the crest) alive.
    drums.push({ t: o, type: "kickSoft", vel: 0.4 });
    drums.push({ t: o + 1, type: "hat", vel: 0.13 }, { t: o + 2, type: "hat", vel: 0.13 });
  });

  const lead: NoteEv[] = [
    N(0, "A4", 2, 0.55), N(2, "C5", 1, 0.5),
    N(3, "D5", 2, 0.55), N(5, "E5", 1, 0.5),
    N(6, "F5", 2, 0.55), N(8, "D5", 1, 0.5),
    N(9, "E5", 2.5, 0.55),
    // Motif fragment slowed, transposed to F: C C D E then a held G.
    N(12, "C5", 1, 0.55), N(13, "C5", 1, 0.52), N(14, "D5", 1, 0.54),
    N(15, "E5", 2.5, 0.56),
    N(18, "G5", 2, 0.58), N(20, "F5", 1, 0.52),
    N(21, "E5", 2.5, 0.55),
    N(24, "F5", 2, 0.55), N(26, "G5", 1, 0.52),
    N(27, "A5", 2, 0.56), N(29, "F5", 1, 0.5),
    N(30, "G5", 1, 0.52), N(31, "F5", 1, 0.5), N(32, "D5", 1, 0.5),
    N(33, "E5", 2, 0.54), N(35, "C5", 1, 0.5),
  ];

  return {
    name: "golden", bpm: 88, beatsPerBar: 3, bars: 12, loop: true, seed: 1010,
    tracks: [
      { inst: LEAD_SOFT, notes: lead },
      { inst: WALTZ_PAH, notes: pah },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
      { inst: BELL, notes: [Nm(11, 84, 0.5, 0.25), Nm(23, 81, 0.5, 0.22)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 11: theme-reprise (132 bpm, 15.0 s one-shot; hit at beat 28, tail out)
// ---------------------------------------------------------------------------

function themeRepriseCue(): CueSpec {
  const lead: NoteEv[] = [
    N(0, "C5", 0.45, 0.75), N(0.5, "E5", 0.45, 0.75), N(1, "G5", 0.9, 0.78),
    N(2, "E5", 0.45, 0.72), N(2.5, "G5", 0.45, 0.74), N(3, "A5", 0.9, 0.78),
    ...motif(4, 0, 0.85, 3),
    N(4, "E4", 0.45, 0.55), N(4.5, "E4", 0.45, 0.55), N(5, "F4", 0.45, 0.55),
    N(5.5, "G4", 0.45, 0.55), N(6, "B4", 3, 0.58),
    N(12, "E5", 1, 0.78), N(13, "D5", 0.45, 0.74), N(13.5, "C5", 0.45, 0.74),
    N(14, "A4", 1, 0.74), N(15, "G4", 1, 0.72),
    N(16, "A4", 0.45, 0.72), N(16.5, "C5", 0.45, 0.74), N(17, "D5", 1.5, 0.78),
    N(20, "E5", 0.45, 0.75), N(20.5, "G5", 0.45, 0.76), N(21, "A5", 1, 0.8),
    N(22, "G5", 0.45, 0.76), N(22.5, "E5", 0.45, 0.74), N(23, "D5", 1, 0.75),
    N(24, "C5", 0.45, 0.74), N(24.5, "D5", 0.45, 0.74), N(25, "E5", 1.4, 0.78),
    N(27.5, "D5", 0.4, 0.85), N(28, "E5", 2.8, 0.95),
  ];

  const padBars = [V.C, V.C, V.G, V.F, V.C, V.F, V.G];
  const pads: NoteEv[] = padBars.flatMap((ch, b) => chordNm(4 * b, ch, 3.9, 0.48));
  pads.push(...chordNm(28, V.C, 2.6, 0.55));

  const bassBars: number[][] = [
    [36, 40, 43, 45], [36, 43, 40, 43], [43, 47, 50, 47], [41, 45, 48, 45], [36, 40, 43, 45], [41, 45, 48, 50],
  ];
  const bass: NoteEv[] = bassBars.flatMap((walk, b) => walk.map((m, q) => Nm(4 * b + q, m, 0.9, 0.8)));
  bass.push(Nm(24, 43, 0.9, 0.8), Nm(25, 45, 0.9, 0.8), Nm(26, 47, 0.9, 0.8));
  bass.push(Nm(27.5, 43, 0.4, 0.85), Nm(28, 36, 3, 0.95));

  const drums: DrumEv[] = [];
  hats8(drums, 0, 28, 0.42, 0.26);
  for (let b = 0; b < 6; b++) {
    drums.push({ t: 4 * b, type: "kick", vel: 0.88 }, { t: 4 * b + 2, type: "kick", vel: 0.75 });
    drums.push({ t: 4 * b + 1, type: "snare", vel: 0.62 }, { t: 4 * b + 3, type: "snare", vel: 0.62 });
  }
  drums.push(
    { t: 24, type: "kick", vel: 0.88 }, { t: 25, type: "snare", vel: 0.62 },
    { t: 26.5, type: "tom", vel: 0.6, freq: 170 }, { t: 27, type: "tom", vel: 0.66, freq: 135 },
    { t: 27.5, type: "kick", vel: 0.7 },
    { t: 4, type: "crash", vel: 0.45 },
    { t: 28, type: "kick", vel: 1 }, { t: 28, type: "snare", vel: 0.8 }, { t: 28, type: "crash", vel: 0.8 },
  );

  return {
    name: "theme-reprise", bpm: 132, beatsPerBar: 4, bars: 8, durSec: 15, loop: false, seed: 1111,
    tracks: [
      { inst: LEAD, notes: lead },
      { inst: PAD, notes: pads },
      { inst: BASS, notes: bass },
      { inst: STAB, notes: chordNm(28, [60, 64, 67, 72], 2.2, 0.9) },
      { inst: SPARKLE, notes: [Nm(28.5, 88, 0.5, 0.4), Nm(28.75, 91, 0.5, 0.35), Nm(29, 96, 0.5, 0.3)] },
    ],
    drums,
  };
}

// ---------------------------------------------------------------------------
// Cue 12: button (2.5 s one-shot)
// ---------------------------------------------------------------------------

function buttonCue(): CueSpec {
  return {
    name: "button", bpm: 120, beatsPerBar: 4, bars: 1.25, durSec: 2.5, loop: false, seed: 1212,
    tracks: [
      { inst: BASS, notes: [Nm(0, 36, 1.2, 0.95)] },
      { inst: STAB, notes: chordNm(0, [60, 64, 67, 72], 1, 0.95) },
      {
        inst: SPARKLE,
        notes: [
          Nm(0.5, 84, 0.5, 0.55), Nm(0.75, 88, 0.5, 0.5), Nm(1, 91, 0.5, 0.45), Nm(1.25, 96, 0.5, 0.42),
        ],
      },
    ],
    drums: [
      { t: 0, type: "kick", vel: 1 },
      { t: 0, type: "snare", vel: 0.6 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Render pipeline
// ---------------------------------------------------------------------------

function renderCue(spec: CueSpec): Float64Array {
  const spb = 60 / spec.bpm;
  const gridSec = spec.bars * spec.beatsPerBar * spb;
  const durSec = spec.durSec ?? gridSec;
  if (spec.loop) {
    if (!Number.isInteger(spec.bars)) throw new Error(`${spec.name}: loop cue must span integer bars`);
    if (spec.durSec !== undefined) throw new Error(`${spec.name}: loop cue duration must come from the bar grid`);
  }
  const n = Math.round(durSec * SR);
  const buf = new Float64Array(n);
  const rng = mulberry32(spec.seed);

  for (const tr of spec.tracks) {
    for (const ev of tr.notes) renderNote(buf, spec.loop, ev.t * spb, ev.midi, ev.dur * spb, ev.vel, tr.inst);
  }
  for (const d of spec.drums) {
    const t = d.t * spb;
    switch (d.type) {
      case "kick": drumKick(buf, spec.loop, t, d.vel, rng, false); break;
      case "kickSoft": drumKick(buf, spec.loop, t, d.vel, rng, true); break;
      case "snare": drumSnare(buf, spec.loop, t, d.vel, rng); break;
      case "hat": drumHat(buf, spec.loop, t, d.vel, rng, false); break;
      case "openhat": drumHat(buf, spec.loop, t, d.vel, rng, true); break;
      case "tom": drumTom(buf, spec.loop, t, d.vel, d.freq ?? 130, rng); break;
      case "crash": drumCrash(buf, spec.loop, t, d.vel, rng); break;
    }
  }

  // Master: gentle tanh soft-clip, then normalize to just under -1 dBFS.
  // Drive below 1 keeps the clip a safety net rather than a squash, which
  // preserves crest factor (peak at -1 dBFS, body around -16 dBFS).
  const drive = spec.drive ?? 0.85;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    buf[i] = Math.tanh(buf[i] * drive);
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? PEAK_TARGET / peak : 1;
  for (let i = 0; i < n; i++) buf[i] *= scale;

  // 5 ms edge fades for one-shots only; loop cues must wrap sample-exact.
  if (!spec.loop) {
    const f = Math.round(0.005 * SR);
    for (let i = 0; i < f; i++) {
      const g = i / f;
      buf[i] *= g;
      buf[n - 1 - i] *= g;
    }
  }
  return buf;
}

function writeWav(path: string, samples: Float64Array): void {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767)));
    b.writeInt16LE(v, 44 + i * 2);
  }
  writeFileSync(path, b);
}

interface WavStats {
  seconds: number;
  peak: number;
  rms: number;
  bytes: number;
}

function verifyWav(path: string): WavStats {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: bad RIFF header`);
  }
  if (b.toString("ascii", 12, 16) !== "fmt " || b.toString("ascii", 36, 40) !== "data") {
    throw new Error(`${path}: unexpected chunk layout`);
  }
  if (b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1) throw new Error(`${path}: not mono PCM`);
  if (b.readUInt32LE(24) !== SR || b.readUInt16LE(34) !== 16) throw new Error(`${path}: wrong rate/depth`);
  const dataLen = b.readUInt32LE(40);
  if (b.readUInt32LE(4) !== 36 + dataLen || b.length !== 44 + dataLen) throw new Error(`${path}: bad sizes`);
  const count = dataLen / 2;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = b.readInt16LE(44 + i * 2) / 32767;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { seconds: count / SR, peak, rms: Math.sqrt(sum / count), bytes: b.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "audio", "music");
mkdirSync(outDir, { recursive: true });

const cues: CueSpec[] = [
  themeCue(),
  meadowCue(),
  tensionRiseCue(),
  chaseCue(),
  lostCue(),
  hopeStingCue(),
  chaseFinalCue(),
  climaxCue(),
  victoryCue(),
  goldenCue(),
  themeRepriseCue(),
  buttonCue(),
];

const dB = (x: number): string => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : "-inf");

let totalSec = 0;
let totalBytes = 0;
const rows: string[] = [];
for (const spec of cues) {
  const buf = renderCue(spec);
  const path = join(outDir, `${spec.name}.wav`);
  writeWav(path, buf);
  const st = verifyWav(path);
  if (st.peak > 0.891) throw new Error(`${spec.name}: clipping guard failed, peak ${st.peak}`);
  const expected = Math.round((spec.durSec ?? spec.bars * spec.beatsPerBar * (60 / spec.bpm)) * SR);
  if (Math.round(st.seconds * SR) !== expected) throw new Error(`${spec.name}: duration mismatch`);
  totalSec += st.seconds;
  totalBytes += st.bytes;
  const shape = spec.loop ? `LOOP ${spec.bars} bars` : "one-shot";
  rows.push(
    `${spec.name.padEnd(14)} ${spec.bpm.toString().padStart(3)}bpm  ${st.seconds.toFixed(3).padStart(7)}s  ` +
      `${shape.padEnd(13)}  peak ${dB(st.peak).padStart(5)} dBFS  rms ${dB(st.rms).padStart(6)} dBFS  ` +
      `${(st.bytes / 1024).toFixed(0).padStart(5)} KiB`,
  );
}

console.log(`GUNNER! underscore render -> ${outDir}`);
for (const r of rows) console.log("  " + r);
console.log(`total: ${totalSec.toFixed(1)} s of audio, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
