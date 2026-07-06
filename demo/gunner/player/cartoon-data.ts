// GUNNER! Episode 1 "Big Heart at Willow Creek": the storyboard as data. Times are seconds on the
// 300 s master clock (storyboard.md is the timing authority). The player is the interpreter: it
// spawns actors per shot, drives base/blink/mouth animation tracks, schedules audio, moves the
// camera, and runs transitions. Dialogue lines auto-space at runtime using measured mp3 durations
// (a line never starts before the previous line in the same shot ends plus a beat).

export interface Cam {
  readonly x: number; // world point the camera centers on
  readonly y: number;
  readonly zoom: number;
}

export interface ActorTween {
  readonly t0: number; // seconds relative to shot start
  readonly t1: number;
  readonly to: { readonly x: number; readonly y: number };
  readonly ease?: 'linear' | 'inout' | 'out';
  readonly animDuring?: string;
  readonly animAfter?: string;
  readonly arc?: number; // parabolic arc height in px (positive = up)
}

export interface ActorPlacement {
  readonly actor: string; // gunner | pip | luna | beans | mama | duckling-1..3
  readonly anim: string;
  readonly loop?: boolean; // default true
  readonly after?: string; // anim to crossfade into once a non-looping `anim` completes (default 'idle')
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
  readonly flip?: boolean; // true = face right (rigs face left natively; mama faces right natively)
  readonly at?: number; // spawn delay relative to shot start
  readonly eyes?: string; // initial eyes micro anim
  readonly tweens?: readonly ActorTween[];
}

export interface PropPlacement {
  readonly prop: string; // region name in the props atlas
  readonly x: number;
  readonly y: number;
  readonly scale?: number;
  readonly rotation?: number;
  readonly flip?: boolean;
  readonly at?: number;
  readonly behavior?:
    | 'sun-rays'
    | 'logo-drop'
    | 'butterfly'
    | 'float-bob'
    | 'branch-arc'
    | 'branch-fall'
    | 'bark-ring'
    | 'drift-cloud';
  readonly tweens?: readonly ActorTween[];
}

export interface AudioCue {
  readonly id: string; // dialogue line id or sfx id
  readonly at: number; // relative to shot start
  readonly kind: 'dlg' | 'sfx';
  readonly actor?: string; // dlg: which actor lip-syncs
  readonly loop?: boolean; // sfx ambience loops until shot end
  readonly volume?: number;
}

export interface MusicCue {
  readonly cue: string;
  readonly at: number; // relative to shot start
  readonly loop: boolean;
  readonly fade?: number; // crossfade seconds (default 1.0)
}

export interface RopeSpec {
  readonly fromActor: string;
  readonly fromOffset: { readonly x: number; readonly y: number };
  readonly toActor?: string; // or fixed point
  readonly toProp?: string;
  readonly toOffset: { readonly x: number; readonly y: number };
  readonly sag?: number;
}

export interface Shot {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly bg: string;
  readonly bgTint?: number;
  readonly bgScroll?: number; // px/s horizontal wrap-scroll of a doubled background
  readonly camera?: { readonly from: Cam; readonly to: Cam; readonly ease?: 'linear' | 'inout' };
  readonly transitionOut?: { readonly kind: 'iris' | 'fade'; readonly at: number };
  readonly transitionIn?: { readonly kind: 'iris' | 'fade'; readonly duration: number };
  readonly actors: readonly ActorPlacement[];
  readonly props?: readonly PropPlacement[];
  readonly rope?: RopeSpec;
  readonly audio: readonly AudioCue[];
  readonly music?: readonly MusicCue[];
}

export const STAGE_W = 1920;
export const STAGE_H = 1080;
export const GROUND_Y = 880;
export const WATER_Y = 640;
const CAM_CENTER: Cam = { x: 960, y: 540, zoom: 1 };

// Actor stage scales (rig world px to stage px)
export const ACTOR_SCALE: Record<string, number> = {
  gunner: 0.82,
  luna: 0.85,
  beans: 0.85,
  pip: 0.85,
  mama: 0.85,
  'duckling-1': 0.85,
  'duckling-2': 0.8,
  'duckling-3': 0.75,
};

export const SHOTS: readonly Shot[] = [
  // ---------------- SCENE 1: MAIN TITLE ----------------
  {
    id: 'SH-101',
    start: 0,
    end: 3,
    bg: 'bg-title-skyline',
    transitionIn: { kind: 'fade', duration: 1.2 },
    camera: { from: { x: 960, y: 540, zoom: 1 }, to: { x: 960, y: 540, zoom: 1.04 }, ease: 'inout' },
    actors: [],
    audio: [],
    music: [{ cue: 'theme', at: 0.2, loop: false }],
  },
  {
    id: 'SH-102',
    start: 3,
    end: 8,
    bg: 'bg-title-skyline',
    actors: [
      {
        actor: 'gunner',
        anim: 'run',
        x: 2200,
        y: GROUND_Y,
        tweens: [{ t0: 0.2, t1: 3.4, to: { x: 980, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
    ],
    audio: [
      { id: 'whoosh-run', at: 0.2, kind: 'sfx' },
      { id: 'skid', at: 3.0, kind: 'sfx' },
      { id: 'dust-poof', at: 3.4, kind: 'sfx', volume: 0.6 },
    ],
  },
  {
    id: 'SH-103',
    start: 8,
    end: 14,
    bg: 'bg-title-skyline',
    actors: [{ actor: 'gunner', anim: 'hero-pose', loop: false, x: 980, y: GROUND_Y }],
    props: [
      { prop: 'logo', x: 960, y: 300, scale: 1.05, behavior: 'logo-drop', at: 0.8 },
    ],
    audio: [
      { id: 'sparkle-pop', at: 1.0, kind: 'sfx' },
      { id: 'wink-ting', at: 4.5, kind: 'sfx' },
    ],
  },
  {
    id: 'SH-104',
    start: 14,
    end: 20,
    bg: 'bg-title-skyline',
    transitionOut: { kind: 'iris', at: 4.8 },
    actors: [{ actor: 'gunner', anim: 'talk', x: 980, y: GROUND_Y }],
    props: [
      { prop: 'logo', x: 960, y: 300, scale: 1.05 },
    ],
    audio: [{ id: 'G-101', at: 0.4, kind: 'dlg', actor: 'gunner' }],
  },

  // ---------------- SCENE 2: SUNNY MEADOW PARK ----------------
  {
    id: 'SH-201',
    start: 20,
    end: 27,
    bg: 'bg-meadow',
    transitionIn: { kind: 'iris', duration: 0.8 },
    actors: [
      { actor: 'gunner', anim: 'tug-strain', x: 820, y: GROUND_Y, flip: true },
      {
        actor: 'beans',
        anim: 'run',
        x: 1180,
        y: GROUND_Y,
        tweens: [
          { t0: 5.2, t1: 5.9, to: { x: 1420, y: GROUND_Y }, ease: 'out', arc: 120, animDuring: 'freeze-shiver', animAfter: 'idle' },
        ],
      },
      { actor: 'luna', anim: 'crank-gadget', x: 430, y: GROUND_Y },
    ],
    props: [
      { prop: 'wagon-catapult', x: 210, y: GROUND_Y - 40, scale: 0.8 },
      { prop: 'basket', x: 1650, y: GROUND_Y - 10, scale: 0.85 },
      { prop: 'blanket', x: 1600, y: GROUND_Y + 40, scale: 1.0 },
      { prop: 'butterfly-up', x: 500, y: 500, scale: 0.18, behavior: 'butterfly' },
      { prop: 'butterfly-flat', x: 1300, y: 430, scale: 0.16, behavior: 'butterfly', at: 1.0 },
    ],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 95, y: -132 },
      toActor: 'beans',
      toOffset: { x: -30, y: -50 },
      sag: 30,
    },
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'tug-growl', at: 0.5, kind: 'sfx', volume: 0.8 },
      { id: 'crank-ratchet', at: 1.0, kind: 'sfx', volume: 0.7 },
      { id: 'B-201', at: 2.0, kind: 'dlg', actor: 'beans' },
      { id: 'boing-tumble', at: 5.3, kind: 'sfx' },
    ],
    music: [{ cue: 'meadow', at: 0, loop: true, fade: 1.5 }],
  },
  {
    id: 'SH-202',
    start: 27,
    end: 31.5,
    bg: 'bg-meadow',
    camera: { from: CAM_CENTER, to: { x: 1150, y: 640, zoom: 1.35 }, ease: 'inout' },
    actors: [
      { actor: 'gunner', anim: 'talk', x: 820, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 1420, y: GROUND_Y, eyes: 'eyes-closed' },
    ],
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'G-202', at: 0.4, kind: 'dlg', actor: 'gunner' },
    ],
  },
  {
    id: 'SH-203',
    start: 31.5,
    end: 38,
    bg: 'bg-meadow',
    camera: { from: { x: 1150, y: 640, zoom: 1.35 }, to: { x: 450, y: 660, zoom: 1.3 }, ease: 'inout' },
    actors: [
      { actor: 'luna', anim: 'point', loop: false, x: 430, y: GROUND_Y },
      { actor: 'gunner', anim: 'idle', x: 820, y: GROUND_Y, flip: true },
    ],
    props: [{ prop: 'wagon-catapult', x: 210, y: GROUND_Y - 40, scale: 0.8 }],
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'L-203', at: 0.5, kind: 'dlg', actor: 'luna' },
      { id: 'creak-gadget', at: 4.5, kind: 'sfx', volume: 0.8 },
    ],
  },
  {
    id: 'SH-204',
    start: 38,
    end: 46,
    bg: 'bg-meadow',
    actors: [
      { actor: 'gunner', anim: 'idle', x: 700, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 400, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 1000, y: GROUND_Y, flip: true },
      {
        actor: 'pip',
        anim: 'fly',
        x: 2100,
        y: 200,
        tweens: [{ t0: 0.1, t1: 0.8, to: { x: 1620, y: GROUND_Y - 150 }, ease: 'out', animAfter: 'talk' }],
      },
    ],
    props: [
      { prop: 'basket', x: 1650, y: GROUND_Y - 10, scale: 0.85 },
      { prop: 'blanket', x: 1600, y: GROUND_Y + 40, scale: 1.0 },
    ],
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'flap-land', at: 0.6, kind: 'sfx' },
      { id: 'P-204', at: 1.6, kind: 'dlg', actor: 'pip' },
    ],
  },
  {
    id: 'SH-205',
    start: 46,
    end: 52.5,
    bg: 'bg-meadow',
    actors: [
      {
        actor: 'gunner',
        anim: 'hero-pose',
        loop: false,
        x: 700,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 4.6, t1: 6.2, to: { x: 2300, y: GROUND_Y }, ease: 'linear', animDuring: 'run' }],
      },
      {
        actor: 'luna',
        anim: 'idle',
        x: 400,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 4.9, t1: 6.4, to: { x: 2300, y: GROUND_Y }, ease: 'linear', animDuring: 'run' }],
      },
      {
        actor: 'pip',
        anim: 'hover',
        x: 1620,
        y: GROUND_Y - 150,
        flip: true,
        tweens: [{ t0: 4.7, t1: 6.0, to: { x: 2300, y: 500 }, ease: 'linear', animDuring: 'fly' }],
      },
    ],
    props: [
      { prop: 'basket', x: 1650, y: GROUND_Y - 10, scale: 0.85 },
      { prop: 'blanket', x: 1600, y: GROUND_Y + 40, scale: 1.0 },
    ],
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'G-205', at: 0.3, kind: 'dlg', actor: 'gunner' },
      { id: 'whoosh-group', at: 4.8, kind: 'sfx' },
    ],
  },
  {
    id: 'SH-206',
    start: 52.5,
    end: 55,
    bg: 'bg-meadow',
    transitionOut: { kind: 'fade', at: 1.7 },
    actors: [
      {
        actor: 'beans',
        anim: 'run',
        x: -200,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.3, t1: 2.3, to: { x: 2200, y: GROUND_Y }, ease: 'linear' }],
      },
    ],
    audio: [
      { id: 'birds-meadow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'B-206', at: 0.5, kind: 'dlg', actor: 'beans' },
    ],
  },

  // ---------------- SCENE 3: WILLOW CREEK ----------------
  {
    id: 'SH-301',
    start: 55,
    end: 63,
    bg: 'bg-creek',
    transitionIn: { kind: 'fade', duration: 0.8 },
    actors: [
      {
        actor: 'mama',
        anim: 'idle',
        x: 500,
        y: WATER_Y,
        tweens: [{ t0: 0, t1: 8, to: { x: 980, y: WATER_Y }, ease: 'linear' }],
      },
      {
        actor: 'duckling-1',
        anim: 'bob-float',
        x: 360,
        y: WATER_Y + 15,
        tweens: [{ t0: 0, t1: 8, to: { x: 840, y: WATER_Y + 15 }, ease: 'linear' }],
      },
      {
        actor: 'duckling-2',
        anim: 'bob-float',
        x: 250,
        y: WATER_Y + 18,
        tweens: [{ t0: 0, t1: 8, to: { x: 730, y: WATER_Y + 18 }, ease: 'linear' }],
      },
      {
        actor: 'duckling-3',
        anim: 'bob-float',
        x: 140,
        y: WATER_Y + 20,
        tweens: [{ t0: 0, t1: 8, to: { x: 620, y: WATER_Y + 20 }, ease: 'linear' }],
      },
      {
        actor: 'gunner',
        anim: 'run',
        x: -250,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.5, t1: 2.2, to: { x: 560, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'luna',
        anim: 'run',
        x: -420,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.7, t1: 2.6, to: { x: 220, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'beans',
        anim: 'run',
        x: -560,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.9, t1: 3.0, to: { x: 860, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'pip',
        anim: 'fly',
        x: -300,
        y: 400,
        flip: true,
        tweens: [{ t0: 0.5, t1: 2.4, to: { x: 810, y: GROUND_Y - 410 }, ease: 'out', animAfter: 'hover' }],
      },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'quack-mama', at: 2.0, kind: 'sfx', volume: 0.9 },
      { id: 'quack-babies', at: 4.0, kind: 'sfx' },
    ],
    music: [{ cue: 'meadow', at: 0, loop: true, fade: 2.0 }],
  },
  {
    id: 'SH-302',
    start: 63,
    end: 71,
    bg: 'bg-creek',
    camera: { from: CAM_CENTER, to: { x: 550, y: 700, zoom: 1.3 }, ease: 'inout' },
    actors: [
      { actor: 'gunner', anim: 'idle', x: 560, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'luna', anim: 'talk', x: 220, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'beans', anim: 'idle', x: 860, y: GROUND_Y, flip: true, eyes: 'eyes-open' },
      { actor: 'pip', anim: 'hover', x: 810, y: GROUND_Y - 410, flip: true },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'L-301', at: 0.4, kind: 'dlg', actor: 'luna' },
      { id: 'G-302', at: 2.6, kind: 'dlg', actor: 'gunner' },
      { id: 'B-303', at: 5.2, kind: 'dlg', actor: 'beans' },
    ],
  },
  {
    id: 'SH-303',
    start: 71,
    end: 79,
    bg: 'bg-creek',
    actors: [
      { actor: 'gunner', anim: 'idle', x: 560, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 220, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 860, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'hover', x: 810, y: GROUND_Y - 410, flip: true },
      { actor: 'mama', anim: 'idle', x: 980, y: WATER_Y },
      {
        actor: 'duckling-1',
        anim: 'bob-float',
        x: 840,
        y: WATER_Y + 15,
        tweens: [{ t0: 3.8, t1: 4.4, to: { x: 1210, y: WATER_Y - 40 }, ease: 'out', arc: 90, animDuring: 'quack-hop', animAfter: 'bob-float' }],
      },
      {
        actor: 'duckling-2',
        anim: 'bob-float',
        x: 730,
        y: WATER_Y + 18,
        tweens: [{ t0: 4.6, t1: 5.2, to: { x: 1140, y: WATER_Y - 30 }, ease: 'out', arc: 100, animDuring: 'quack-hop', animAfter: 'bob-float' }],
      },
      {
        actor: 'duckling-3',
        anim: 'bob-float',
        x: 620,
        y: WATER_Y + 20,
        tweens: [{ t0: 5.4, t1: 6.0, to: { x: 1280, y: WATER_Y - 30 }, ease: 'out', arc: 100, animDuring: 'quack-hop', animAfter: 'bob-float' }],
      },
    ],
    props: [
      {
        prop: 'float-donut',
        x: -150,
        y: 350,
        scale: 0.5,
        behavior: 'float-bob',
        tweens: [{ t0: 0.4, t1: 3.6, to: { x: 1220, y: WATER_Y + 30 }, ease: 'out', arc: 160 }],
      },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'wind-gust', at: 0.2, kind: 'sfx' },
      { id: 'boing-soft', at: 3.8, kind: 'sfx' },
      { id: 'boing-soft', at: 4.6, kind: 'sfx' },
      { id: 'boing-soft', at: 5.4, kind: 'sfx' },
      { id: 'quack-babies', at: 6.0, kind: 'sfx' },
    ],
  },
  {
    id: 'SH-304',
    start: 79,
    end: 86,
    bg: 'bg-creek',
    camera: { from: CAM_CENTER, to: { x: 1300, y: 540, zoom: 1.1 }, ease: 'inout' },
    actors: [
      { actor: 'mama', anim: 'alarm-flap', x: 980, y: WATER_Y },
      {
        actor: 'duckling-1',
        anim: 'bob-float',
        x: 1210,
        y: WATER_Y - 40,
        tweens: [{ t0: 0, t1: 7, to: { x: 1900, y: WATER_Y - 40 }, ease: 'linear' }],
      },
      {
        actor: 'duckling-2',
        anim: 'bob-float',
        x: 1140,
        y: WATER_Y - 30,
        tweens: [{ t0: 0, t1: 7, to: { x: 1830, y: WATER_Y - 30 }, ease: 'linear' }],
      },
      {
        actor: 'duckling-3',
        anim: 'bob-float',
        x: 1280,
        y: WATER_Y - 30,
        tweens: [{ t0: 0, t1: 7, to: { x: 1970, y: WATER_Y - 30 }, ease: 'linear' }],
      },
      { actor: 'gunner', anim: 'idle', x: 560, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 220, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 860, y: GROUND_Y, flip: true, eyes: 'eyes-worried' },
    ],
    props: [
      {
        prop: 'float-donut',
        x: 1220,
        y: WATER_Y + 30,
        scale: 0.5,
        behavior: 'float-bob',
        tweens: [{ t0: 0, t1: 7, to: { x: 1910, y: WATER_Y + 30 }, ease: 'linear' }],
      },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'quack-alarm', at: 1.0, kind: 'sfx' },
      { id: 'flap-panic', at: 1.5, kind: 'sfx' },
    ],
    music: [{ cue: 'tension-rise', at: 3.0, loop: false }],
  },
  {
    id: 'SH-305',
    start: 86,
    end: 90,
    bg: 'bg-creek',
    transitionOut: { kind: 'iris', at: 3.2 },
    camera: { from: { x: 700, y: 600, zoom: 1.25 }, to: { x: 600, y: 700, zoom: 1.3 }, ease: 'inout' },
    actors: [
      { actor: 'pip', anim: 'hover', x: 810, y: 460, flip: true },
      {
        actor: 'gunner', anim: 'idle', x: 560, y: GROUND_Y, flip: true,
        tweens: [{ t0: 1.8, t1: 1.85, to: { x: 560, y: GROUND_Y }, animAfter: 'hero-pose' }],
      },
      { actor: 'luna', anim: 'idle', x: 220, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 860, y: GROUND_Y, flip: true, eyes: 'eyes-worried' },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'P-304', at: 0.2, kind: 'dlg', actor: 'pip' },
      { id: 'G-305', at: 2.2, kind: 'dlg', actor: 'gunner' },
    ],
    music: [{ cue: 'chase', at: 3.5, loop: true, fade: 0.8 }],
  },

  // ---------------- SCENE 4: THE CHASE / PIP'S TRY ----------------
  {
    id: 'SH-401',
    start: 90,
    end: 100,
    bg: 'bg-bank-run',
    bgScroll: 260,
    transitionIn: { kind: 'iris', duration: 0.8 },
    actors: [
      { actor: 'gunner', anim: 'run', x: 820, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'run', x: 460, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'run', x: 150, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'fly', x: 1080, y: 460, flip: true },
      { actor: 'duckling-1', anim: 'panic', x: 1450, y: WATER_Y - 35 },
      { actor: 'duckling-2', anim: 'bob-float', x: 1390, y: WATER_Y - 25 },
      { actor: 'duckling-3', anim: 'panic', x: 1510, y: WATER_Y - 25 },
    ],
    props: [{ prop: 'float-donut', x: 1450, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' }],
    audio: [
      { id: 'river-fast', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'paws-running', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
    ],
  },
  {
    id: 'SH-402',
    start: 100,
    end: 104,
    bg: 'bg-bank-run',
    bgScroll: 260,
    actors: [
      { actor: 'gunner', anim: 'run', x: 820, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'run', x: 460, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'run', x: 150, y: GROUND_Y, flip: true },
      {
        actor: 'pip',
        anim: 'fly',
        x: 760,
        y: 520,
        flip: true,
        tweens: [{ t0: 1.2, t1: 2.6, to: { x: 1700, y: 480 }, ease: 'inout' }],
      },
      { actor: 'duckling-1', anim: 'panic', x: 1450, y: WATER_Y - 35 },
      { actor: 'duckling-2', anim: 'bob-float', x: 1390, y: WATER_Y - 25 },
      { actor: 'duckling-3', anim: 'panic', x: 1510, y: WATER_Y - 25 },
    ],
    props: [{ prop: 'float-donut', x: 1450, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' }],
    audio: [
      { id: 'river-fast', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'paws-running', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'P-401', at: 0.3, kind: 'dlg', actor: 'pip' },
      { id: 'flap-fast', at: 2.0, kind: 'sfx', volume: 0.8 },
    ],
  },
  {
    id: 'SH-403',
    start: 104,
    end: 114,
    bg: 'bg-bank-run',
    camera: { from: { x: 1250, y: 600, zoom: 1.25 }, to: { x: 1250, y: 600, zoom: 1.25 } },
    actors: [
      {
        actor: 'pip',
        anim: 'fly',
        x: 1700,
        y: 480,
        flip: false,
        tweens: [{ t0: 0.2, t1: 1.2, to: { x: 1450, y: WATER_Y - 120 }, ease: 'out', animAfter: 'lift-strain' }],
      },
      { actor: 'duckling-1', anim: 'panic', x: 1450, y: WATER_Y - 35 },
      { actor: 'duckling-2', anim: 'bob-float', x: 1390, y: WATER_Y - 25 },
      { actor: 'duckling-3', anim: 'panic', x: 1510, y: WATER_Y - 25 },
    ],
    props: [{ prop: 'float-donut', x: 1450, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' }],
    audio: [
      { id: 'river-fast', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'strain-squeak', at: 2.0, kind: 'sfx' },
      { id: 'feather-pop', at: 7.0, kind: 'sfx' },
      { id: 'P-402', at: 7.4, kind: 'dlg', actor: 'pip' },
    ],
  },
  {
    id: 'SH-404',
    start: 114,
    end: 120,
    bg: 'bg-bank-run',
    camera: { from: { x: 700, y: 650, zoom: 1.3 }, to: { x: 700, y: 650, zoom: 1.3 } },
    actors: [
      { actor: 'gunner', anim: 'idle', x: 700, y: GROUND_Y, flip: true },
      {
        actor: 'pip',
        anim: 'fly',
        x: 1300,
        y: 400,
        tweens: [{ t0: 0.1, t1: 0.5, to: { x: 860, y: GROUND_Y - 300 }, ease: 'out', animAfter: 'hover' }],
      },
      { actor: 'luna', anim: 'idle', x: 350, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 1020, y: GROUND_Y },
    ],
    audio: [
      { id: 'river-fast', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'flop-soft', at: 0.5, kind: 'sfx' },
      { id: 'G-403', at: 1.0, kind: 'dlg', actor: 'gunner' },
      { id: 'P-404', at: 3.0, kind: 'dlg', actor: 'pip' },
    ],
  },
  {
    id: 'SH-405',
    start: 120,
    end: 130,
    bg: 'bg-bank-run',
    bgScroll: 260,
    transitionOut: { kind: 'fade', at: 9.2 },
    actors: [
      { actor: 'luna', anim: 'talk', x: 460, y: GROUND_Y, flip: true, tweens: [{ t0: 5.0, t1: 5.4, to: { x: 460, y: GROUND_Y }, animAfter: 'run' }] },
      { actor: 'gunner', anim: 'run', x: 820, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'run', x: 150, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'fly', x: 1080, y: 460, flip: true },
    ],
    audio: [
      { id: 'river-fast', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'paws-running', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'L-405', at: 0.5, kind: 'dlg', actor: 'luna' },
    ],
  },

  // ---------------- SCENE 5: OLD LOG BEND ----------------
  {
    id: 'SH-501',
    start: 130,
    end: 137,
    bg: 'bg-log-bend',
    transitionIn: { kind: 'fade', duration: 0.8 },
    actors: [
      {
        actor: 'gunner',
        anim: 'run',
        x: -200,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.2, t1: 1.4, to: { x: 620, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'luna',
        anim: 'run',
        x: -350,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.4, t1: 1.8, to: { x: 260, y: GROUND_Y }, ease: 'out', animAfter: 'crank-gadget' }],
      },
      {
        actor: 'beans',
        anim: 'run',
        x: -500,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 0.6, t1: 2.2, to: { x: 940, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'pip',
        anim: 'fly',
        x: -250,
        y: 420,
        flip: true,
        tweens: [{ t0: 0.2, t1: 1.6, to: { x: 780, y: GROUND_Y - 230 }, ease: 'out', animAfter: 'hover' }],
      },
    ],
    props: [{ prop: 'wagon-catapult', x: 180, y: GROUND_Y - 40, scale: 0.8 }],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'skid', at: 1.2, kind: 'sfx', volume: 0.7 },
      { id: 'crank-ratchet', at: 2.0, kind: 'sfx' },
    ],
    music: [{ cue: 'chase', at: 0, loop: true, fade: 1.0 }],
  },
  {
    id: 'SH-502',
    start: 137,
    end: 143,
    bg: 'bg-log-bend',
    actors: [
      { actor: 'luna', anim: 'talk', x: 260, y: GROUND_Y, flip: true },
      { actor: 'gunner', anim: 'idle', x: 620, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 940, y: GROUND_Y, flip: true },
    ],
    props: [
      { prop: 'wagon-catapult', x: 180, y: GROUND_Y - 40, scale: 0.8 },
      {
        prop: 'branch',
        x: 260,
        y: GROUND_Y - 120,
        scale: 0.5,
        at: 2.0,
        behavior: 'branch-arc',
        tweens: [{ t0: 0, t1: 2.2, to: { x: 1150, y: 620 }, ease: 'out', arc: 320 }],
      },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'L-501', at: 0.2, kind: 'dlg', actor: 'luna' },
      { id: 'catapult-twang', at: 2.0, kind: 'sfx' },
      { id: 'branch-thunk', at: 4.2, kind: 'sfx' },
    ],
    music: [{ cue: 'tension-rise', at: 3.5, loop: false }],
  },
  {
    id: 'SH-503',
    start: 143,
    end: 151,
    bg: 'bg-log-bend',
    camera: { from: CAM_CENTER, to: { x: 1050, y: 620, zoom: 1.2 }, ease: 'inout' },
    actors: [
      { actor: 'beans', anim: 'talk', x: 940, y: GROUND_Y, flip: true,
        tweens: [{ t0: 3.2, t1: 6.5, to: { x: 1080, y: 640 }, ease: 'inout', animDuring: 'proud-strut', animAfter: 'idle' }] },
      { actor: 'gunner', anim: 'idle', x: 620, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 260, y: GROUND_Y, flip: true },
    ],
    props: [{ prop: 'branch', x: 1150, y: 620, scale: 0.5, rotation: 0.06 }],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'B-502', at: 0.4, kind: 'dlg', actor: 'beans' },
    ],
  },
  {
    id: 'SH-504',
    start: 151,
    end: 158,
    bg: 'bg-log-bend',
    camera: { from: { x: 1080, y: 620, zoom: 1.35 }, to: { x: 1080, y: 620, zoom: 1.4 }, ease: 'inout' },
    actors: [
      { actor: 'beans', anim: 'freeze-shiver', x: 1080, y: 640, flip: true, eyes: 'eyes-worried' },
      { actor: 'duckling-1', anim: 'panic', x: 900, y: WATER_Y + 60,
        tweens: [{ t0: 2.0, t1: 6.5, to: { x: 2050, y: WATER_Y + 60 }, ease: 'linear' }] },
      { actor: 'duckling-2', anim: 'bob-float', x: 830, y: WATER_Y + 70,
        tweens: [{ t0: 2.0, t1: 6.5, to: { x: 1980, y: WATER_Y + 70 }, ease: 'linear' }] },
      { actor: 'duckling-3', anim: 'panic', x: 960, y: WATER_Y + 70,
        tweens: [{ t0: 2.0, t1: 6.5, to: { x: 2110, y: WATER_Y + 70 }, ease: 'linear' }] },
    ],
    props: [
      { prop: 'branch', x: 1150, y: 620, scale: 0.5, rotation: 0.06 },
      { prop: 'float-donut', x: 895, y: WATER_Y + 130, scale: 0.5, behavior: 'float-bob',
        tweens: [{ t0: 2.0, t1: 6.5, to: { x: 2045, y: WATER_Y + 130 }, ease: 'linear' }] },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'wobble-creak', at: 0.5, kind: 'sfx' },
      { id: 'shiver-rattle', at: 1.0, kind: 'sfx' },
      { id: 'B-503', at: 3.0, kind: 'dlg', actor: 'beans' },
    ],
  },
  {
    id: 'SH-505',
    start: 158,
    end: 165,
    bg: 'bg-log-bend',
    actors: [
      {
        actor: 'gunner',
        anim: 'talk',
        x: 620,
        y: GROUND_Y,
        flip: true,
        tweens: [{ t0: 2.4, t1: 3.0, to: { x: 860, y: GROUND_Y }, ease: 'out', animDuring: 'yank-grab', animAfter: 'idle' }],
      },
      {
        actor: 'beans',
        anim: 'freeze-shiver',
        x: 1080,
        y: 640,
        flip: true,
        eyes: 'eyes-worried',
        tweens: [{ t0: 3.4, t1: 4.0, to: { x: 900, y: GROUND_Y }, ease: 'out', arc: 100, animAfter: 'idle' }],
      },
      { actor: 'luna', anim: 'idle', x: 260, y: GROUND_Y, flip: true },
    ],
    props: [
      {
        prop: 'branch',
        x: 1150,
        y: 620,
        scale: 0.5,
        rotation: 0.06,
        behavior: 'branch-fall',
        tweens: [{ t0: 3.0, t1: 4.0, to: { x: 1250, y: 900 }, ease: 'linear' }],
      },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'G-504', at: 0.2, kind: 'dlg', actor: 'gunner' },
      { id: 'crack-snap', at: 3.0, kind: 'sfx' },
      { id: 'splash-big', at: 3.5, kind: 'sfx' },
      { id: 'yank-grab', at: 3.6, kind: 'sfx' },
    ],
  },
  {
    id: 'SH-506',
    start: 165,
    end: 170,
    bg: 'bg-log-bend',
    transitionOut: { kind: 'fade', at: 4.2 },
    camera: { from: CAM_CENTER, to: { x: 500, y: 700, zoom: 1.25 }, ease: 'inout' },
    actors: [
      { actor: 'beans', anim: 'idle', x: 900, y: GROUND_Y, flip: true, eyes: 'eyes-worried' },
      { actor: 'luna', anim: 'talk', x: 260, y: GROUND_Y, flip: true },
      { actor: 'gunner', anim: 'idle', x: 620, y: GROUND_Y, flip: true },
    ],
    audio: [
      { id: 'creek-flow', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'L-505', at: 0.6, kind: 'dlg', actor: 'luna' },
    ],
    music: [{ cue: 'chase-final', at: 4.0, loop: true, fade: 1.0 }],
  },

  // ---------------- SCENE 6: FOG HOLLOW ----------------
  {
    id: 'SH-601',
    start: 170,
    end: 177,
    bg: 'bg-fog-hollow',
    transitionIn: { kind: 'fade', duration: 1.0 },
    actors: [
      {
        actor: 'gunner', anim: 'walk', x: 380, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0, t1: 6.8, to: { x: 780, y: GROUND_Y }, ease: 'linear' }],
      },
      {
        actor: 'luna', anim: 'walk', x: 40, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0, t1: 6.8, to: { x: 440, y: GROUND_Y }, ease: 'linear' }],
      },
      {
        actor: 'beans', anim: 'walk', x: 720, y: GROUND_Y, flip: true, eyes: 'eyes-worried',
        tweens: [{ t0: 0, t1: 6.8, to: { x: 1120, y: GROUND_Y }, ease: 'linear' }],
      },
      {
        actor: 'pip', anim: 'hover', x: 600, y: 360, flip: true,
        tweens: [{ t0: 0, t1: 6.8, to: { x: 1000, y: 360 }, ease: 'linear' }],
      },
    ],
    audio: [
      { id: 'fog-wind', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'G-601', at: 4.0, kind: 'dlg', actor: 'gunner' },
    ],
    music: [{ cue: 'lost', at: 0.5, loop: true, fade: 1.8 }],
  },
  {
    id: 'SH-602',
    start: 177,
    end: 186,
    bg: 'bg-fog-hollow',
    camera: { from: CAM_CENTER, to: { x: 1120, y: 720, zoom: 1.3 }, ease: 'inout' },
    actors: [
      { actor: 'beans', anim: 'talk', x: 1120, y: GROUND_Y, flip: true, eyes: 'eyes-worried' },
      { actor: 'gunner', anim: 'idle', x: 780, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 440, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'hover', x: 1000, y: 360, flip: true },
    ],
    audio: [
      { id: 'fog-wind', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'B-602', at: 1.0, kind: 'dlg', actor: 'beans' },
    ],
  },
  {
    id: 'SH-603',
    start: 186,
    end: 194,
    bg: 'bg-fog-hollow',
    camera: { from: { x: 780, y: 700, zoom: 1.2 }, to: { x: 780, y: 700, zoom: 1.2 } },
    actors: [
      { actor: 'gunner', anim: 'talk', x: 780, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 1120, y: GROUND_Y, flip: true, eyes: 'eyes-worried' },
      { actor: 'luna', anim: 'idle', x: 440, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'hover', x: 1000, y: 360, flip: true },
    ],
    audio: [
      { id: 'fog-wind', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'G-603', at: 0.4, kind: 'dlg', actor: 'gunner' },
      { id: 'B-604', at: 5.0, kind: 'dlg', actor: 'beans' },
      { id: 'G-605', at: 6.2, kind: 'dlg', actor: 'gunner' },
    ],
  },
  {
    id: 'SH-604',
    start: 194,
    end: 200,
    bg: 'bg-fog-hollow',
    transitionOut: { kind: 'fade', at: 5.2 },
    camera: { from: { x: 1120, y: 700, zoom: 1.2 }, to: CAM_CENTER, ease: 'inout' },
    actors: [
      {
        actor: 'beans', anim: 'idle', x: 1120, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0.5, t1: 0.55, to: { x: 1120, y: GROUND_Y }, animAfter: 'mega-bark' }],
      },
      { actor: 'gunner', anim: 'idle', x: 780, y: GROUND_Y, flip: true },
      {
        actor: 'luna', anim: 'idle', x: 440, y: GROUND_Y,
        tweens: [{ t0: 3.8, t1: 3.85, to: { x: 440, y: GROUND_Y }, animAfter: 'point' }],
      },
      { actor: 'pip', anim: 'hover', x: 1000, y: 360, flip: true },
    ],
    props: [{ prop: 'cloud', x: 1120, y: 750, scale: 0.01, at: 1.1, behavior: 'bark-ring' }],
    audio: [
      { id: 'fog-wind', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'mega-bark', at: 1.0, kind: 'sfx' },
      { id: 'quack-distant', at: 3.2, kind: 'sfx' },
      { id: 'L-606', at: 4.0, kind: 'dlg', actor: 'luna' },
    ],
    music: [
      { cue: 'hope-sting', at: 3.5, loop: false },
      { cue: 'chase-final', at: 5.0, loop: true, fade: 0.8 },
    ],
  },

  // ---------------- SCENE 7: WATERFALL POINT ----------------
  {
    id: 'SH-701',
    start: 200,
    end: 206,
    bg: 'bg-waterfall',
    transitionIn: { kind: 'fade', duration: 0.8 },
    actors: [
      { actor: 'duckling-1', anim: 'panic', x: 950, y: WATER_Y - 35,
        tweens: [{ t0: 0, t1: 6, to: { x: 1350, y: WATER_Y - 35 }, ease: 'linear' }] },
      { actor: 'duckling-2', anim: 'panic', x: 890, y: WATER_Y - 25,
        tweens: [{ t0: 0, t1: 6, to: { x: 1290, y: WATER_Y - 25 }, ease: 'linear' }] },
      { actor: 'duckling-3', anim: 'panic', x: 1010, y: WATER_Y - 25,
        tweens: [{ t0: 0, t1: 6, to: { x: 1410, y: WATER_Y - 25 }, ease: 'linear' }] },
      {
        actor: 'gunner', anim: 'run', x: -200, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0.5, t1: 1.8, to: { x: 480, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'luna', anim: 'run', x: -350, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0.7, t1: 2.1, to: { x: 150, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'beans', anim: 'run', x: -500, y: GROUND_Y, flip: true,
        tweens: [{ t0: 0.9, t1: 2.4, to: { x: 820, y: GROUND_Y }, ease: 'out', animAfter: 'idle' }],
      },
      {
        actor: 'pip', anim: 'fly', x: -250, y: 400, flip: true,
        tweens: [{ t0: 0.5, t1: 2.0, to: { x: 650, y: GROUND_Y - 240 }, ease: 'out', animAfter: 'hover' }],
      },
    ],
    props: [{ prop: 'float-donut', x: 950, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob',
      tweens: [{ t0: 0, t1: 6, to: { x: 1350, y: WATER_Y + 35 }, ease: 'linear' }] }],
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.65 },
      { id: 'P-701', at: 3.5, kind: 'dlg', actor: 'pip' },
    ],
  },
  {
    id: 'SH-702',
    start: 206,
    end: 215,
    bg: 'bg-waterfall',
    camera: { from: CAM_CENTER, to: { x: 480, y: 700, zoom: 1.25 }, ease: 'inout' },
    actors: [
      { actor: 'gunner', anim: 'talk', x: 480, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 150, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 820, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'hover', x: 650, y: GROUND_Y - 240, flip: true },
    ],
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'G-702', at: 0.5, kind: 'dlg', actor: 'gunner' },
    ],
  },
  {
    id: 'SH-703',
    start: 215,
    end: 221,
    bg: 'bg-waterfall',
    camera: { from: { x: 300, y: 720, zoom: 1.4 }, to: { x: 300, y: 720, zoom: 1.4 } },
    actors: [
      { actor: 'luna', anim: 'tie-knot', loop: false, x: 260, y: GROUND_Y, flip: true },
      { actor: 'gunner', anim: 'idle', x: 620, y: GROUND_Y, flip: true },
    ],
    props: [{ prop: 'float-donut', x: 330, y: GROUND_Y - 15, scale: 0.4 }],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 60, y: -160 },
      toProp: 'float-donut',
      toOffset: { x: 0, y: -12 },
      sag: 45,
    },
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'rope-whip', at: 0.5, kind: 'sfx' },
      { id: 'L-703', at: 3.5, kind: 'dlg', actor: 'luna' },
    ],
    music: [{ cue: 'climax', at: 4.5, loop: false }],
  },
  {
    id: 'SH-704',
    start: 221,
    end: 228,
    bg: 'bg-waterfall',
    actors: [
      {
        actor: 'pip', anim: 'fly', x: 400, y: 600, flip: true,
        tweens: [{ t0: 0.5, t1: 4.0, to: { x: 1380, y: WATER_Y - 90 }, ease: 'inout', animAfter: 'hover' }],
      },
      { actor: 'gunner', anim: 'idle', x: 480, y: GROUND_Y, flip: true },
      { actor: 'duckling-1', anim: 'panic', x: 1400, y: WATER_Y - 35 },
      { actor: 'duckling-2', anim: 'panic', x: 1340, y: WATER_Y - 25 },
      { actor: 'duckling-3', anim: 'panic', x: 1460, y: WATER_Y - 25 },
    ],
    props: [{ prop: 'float-donut', x: 1400, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' }],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 60, y: -160 },
      toActor: 'pip',
      toOffset: { x: 0, y: 40 },
      sag: 60,
    },
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'flap-fast', at: 0.5, kind: 'sfx' },
      { id: 'hook-click', at: 4.5, kind: 'sfx' },
      { id: 'P-704', at: 5.0, kind: 'dlg', actor: 'pip' },
    ],
  },
  {
    id: 'SH-705',
    start: 228,
    end: 234,
    bg: 'bg-waterfall',
    camera: { from: { x: 768, y: 648, zoom: 1.25 }, to: { x: 768, y: 648, zoom: 1.25 } },
    actors: [
      { actor: 'gunner', anim: 'dig-in', loop: false, after: 'tug-strain', x: 560, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'talk', x: 330, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 90, y: GROUND_Y, flip: true },
    ],
    props: [
      { prop: 'boulder', x: 700, y: GROUND_Y + 10, scale: 0.7 },
      { prop: 'float-donut', x: 1680, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' },
    ],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 95, y: -132 },
      toProp: 'float-donut',
      toOffset: { x: -80, y: -20 },
      sag: 25,
    },
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'paw-dig', at: 1.0, kind: 'sfx' },
      { id: 'B-705', at: 3.0, kind: 'dlg', actor: 'beans' },
    ],
  },
  {
    id: 'SH-706',
    start: 234,
    end: 244,
    bg: 'bg-waterfall',
    camera: { from: { x: 900, y: 640, zoom: 1.1 }, to: { x: 1000, y: 620, zoom: 1.15 }, ease: 'inout' },
    actors: [
      { actor: 'gunner', anim: 'tug-strain', x: 560, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 90, y: GROUND_Y, flip: true },
      { actor: 'beans', anim: 'idle', x: 330, y: GROUND_Y, flip: true },
      { actor: 'pip', anim: 'hover', x: 950, y: 400, flip: true },
      { actor: 'duckling-1', anim: 'panic', x: 1680, y: WATER_Y - 35 },
      { actor: 'duckling-2', anim: 'panic', x: 1620, y: WATER_Y - 25 },
      { actor: 'duckling-3', anim: 'panic', x: 1740, y: WATER_Y - 25 },
    ],
    props: [
      { prop: 'boulder', x: 700, y: GROUND_Y + 10, scale: 0.7 },
      { prop: 'float-donut', x: 1680, y: WATER_Y + 35, scale: 0.5, behavior: 'float-bob' },
    ],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 95, y: -132 },
      toProp: 'float-donut',
      toOffset: { x: -80, y: -20 },
      sag: 8,
    },
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.6 },
      { id: 'rope-stretch', at: 0.5, kind: 'sfx' },
      { id: 'G-706', at: 6.0, kind: 'dlg', actor: 'gunner' },
    ],
  },
  {
    id: 'SH-707',
    start: 244,
    end: 250,
    bg: 'bg-waterfall',
    actors: [
      { actor: 'gunner', anim: 'yank-grab', loop: false, x: 560, y: GROUND_Y, flip: true, at: 0.8 },
      { actor: 'luna', anim: 'idle', x: 90, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'beans', anim: 'idle', x: 330, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'pip', anim: 'hover', x: 950, y: 400, flip: true },
      { actor: 'duckling-1', anim: 'panic', x: 1680, y: WATER_Y - 35,
        tweens: [{ t0: 1.0, t1: 2.8, to: { x: 700, y: GROUND_Y - 20 }, ease: 'out', arc: 140, animDuring: 'quack-hop', animAfter: 'waddle' }] },
      { actor: 'duckling-2', anim: 'panic', x: 1620, y: WATER_Y - 25,
        tweens: [{ t0: 1.1, t1: 2.9, to: { x: 600, y: GROUND_Y - 10 }, ease: 'out', arc: 150, animDuring: 'quack-hop', animAfter: 'waddle' }] },
      { actor: 'duckling-3', anim: 'panic', x: 1740, y: WATER_Y - 25,
        tweens: [{ t0: 1.2, t1: 3.0, to: { x: 800, y: GROUND_Y - 10 }, ease: 'out', arc: 150, animDuring: 'quack-hop', animAfter: 'waddle' }] },
    ],
    props: [
      { prop: 'float-donut', x: 1680, y: WATER_Y + 35, scale: 0.5,
        tweens: [{ t0: 1.0, t1: 2.6, to: { x: 650, y: GROUND_Y + 20 }, ease: 'out', arc: 60 }] },
    ],
    rope: {
      fromActor: 'gunner',
      fromOffset: { x: 95, y: -132 },
      toProp: 'float-donut',
      toOffset: { x: -80, y: -20 },
      sag: 40,
    },
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.55 },
      { id: 'G-707', at: 0.2, kind: 'dlg', actor: 'gunner' },
      { id: 'heave-yank', at: 1.0, kind: 'sfx' },
      { id: 'slide-thump', at: 2.6, kind: 'sfx' },
      { id: 'quack-babies', at: 3.2, kind: 'sfx' },
    ],
  },
  {
    id: 'SH-708',
    start: 250,
    end: 262,
    bg: 'bg-waterfall',
    transitionOut: { kind: 'fade', at: 11.2 },
    camera: { from: CAM_CENTER, to: { x: 640, y: 700, zoom: 1.2 }, ease: 'inout' },
    actors: [
      {
        actor: 'mama', anim: 'waddle', x: -150, y: GROUND_Y - 10,
        tweens: [{ t0: 0.2, t1: 1.6, to: { x: 500, y: GROUND_Y - 10 }, ease: 'out', animAfter: 'idle' }],
      },
      { actor: 'duckling-1', anim: 'waddle', x: 700, y: GROUND_Y - 20,
        tweens: [{ t0: 1.6, t1: 2.4, to: { x: 580, y: GROUND_Y - 15 }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'duckling-2', anim: 'waddle', x: 600, y: GROUND_Y - 10,
        tweens: [{ t0: 1.7, t1: 2.4, to: { x: 380, y: GROUND_Y - 5 }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'duckling-3', anim: 'waddle', x: 800, y: GROUND_Y - 10,
        tweens: [{ t0: 1.8, t1: 2.5, to: { x: 660, y: GROUND_Y - 5 }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'gunner', anim: 'idle', x: 880, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'luna', anim: 'talk', x: 1180, y: GROUND_Y, flip: false, eyes: 'eyes-happy' },
      { actor: 'beans', anim: 'idle', x: 1400, y: GROUND_Y, flip: false, eyes: 'eyes-happy' },
      { actor: 'pip', anim: 'hover', x: 1040, y: 470, flip: false },
    ],
    audio: [
      { id: 'waterfall-roar', at: 0, kind: 'sfx', loop: true, volume: 0.45 },
      { id: 'quack-mama', at: 0.5, kind: 'sfx' },
      { id: 'flap-land', at: 0.8, kind: 'sfx' },
      { id: 'L-708', at: 5.0, kind: 'dlg', actor: 'luna' },
      { id: 'G-709', at: 7.5, kind: 'dlg', actor: 'gunner' },
    ],
    music: [{ cue: 'victory', at: 0.5, loop: false, fade: 0.5 }],
  },

  // ---------------- SCENE 8: GOLDEN HOUR ----------------
  {
    id: 'SH-801',
    start: 262,
    end: 270,
    bg: 'bg-golden-meadow',
    transitionIn: { kind: 'fade', duration: 1.0 },
    actors: [
      { actor: 'gunner', anim: 'idle', x: 860, y: GROUND_Y, flip: true, eyes: 'eyes-half' },
      { actor: 'luna', anim: 'idle', x: 560, y: GROUND_Y, flip: true, eyes: 'eyes-half' },
      { actor: 'beans', anim: 'talk', x: 1140, y: GROUND_Y, flip: false },
      { actor: 'pip', anim: 'talk', x: 1340, y: GROUND_Y, flip: false },
      { actor: 'mama', anim: 'idle', x: 300, y: GROUND_Y },
      { actor: 'duckling-1', anim: 'bob-float', x: 1480, y: GROUND_Y },
      { actor: 'duckling-2', anim: 'bob-float', x: 1580, y: GROUND_Y },
      { actor: 'duckling-3', anim: 'bob-float', x: 1680, y: GROUND_Y },
    ],
    props: [
      { prop: 'basket', x: 1800, y: GROUND_Y - 10, scale: 0.85 },
      { prop: 'blanket', x: 1720, y: GROUND_Y + 40, scale: 1.0 },
      { prop: 'leaf-hat', x: 1480, y: GROUND_Y - 78, scale: 0.4 },
      { prop: 'leaf-hat', x: 1580, y: GROUND_Y - 74, scale: 0.36 },
      { prop: 'leaf-hat', x: 1680, y: GROUND_Y - 70, scale: 0.34 },
    ],
    audio: [
      { id: 'birds-evening', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'P-801', at: 0.5, kind: 'dlg', actor: 'pip' },
      { id: 'B-802', at: 3.0, kind: 'dlg', actor: 'beans' },
      { id: 'P-803', at: 5.6, kind: 'dlg', actor: 'pip' },
    ],
    music: [{ cue: 'golden', at: 0, loop: true, fade: 2.0 }],
  },
  {
    id: 'SH-802',
    start: 270,
    end: 279,
    bg: 'bg-golden-meadow',
    camera: { from: CAM_CENTER, to: { x: 860, y: 660, zoom: 1.25 }, ease: 'inout' },
    actors: [
      { actor: 'gunner', anim: 'talk', x: 860, y: GROUND_Y, flip: true },
      { actor: 'luna', anim: 'idle', x: 560, y: GROUND_Y, flip: true, eyes: 'eyes-half' },
      { actor: 'beans', anim: 'idle', x: 1140, y: GROUND_Y, flip: false },
    ],
    audio: [
      { id: 'birds-evening', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'G-804', at: 0.4, kind: 'dlg', actor: 'gunner' },
      { id: 'L-805', at: 6.0, kind: 'dlg', actor: 'luna' },
    ],
  },
  {
    id: 'SH-803',
    start: 279,
    end: 285,
    bg: 'bg-golden-meadow',
    transitionOut: { kind: 'fade', at: 5.2 },
    actors: [
      { actor: 'gunner', anim: 'idle', x: 860, y: GROUND_Y, flip: true, eyes: 'eyes-happy' },
      { actor: 'duckling-1', anim: 'waddle', x: 1480, y: GROUND_Y,
        tweens: [{ t0: 0.2, t1: 1.4, to: { x: 1060, y: GROUND_Y }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'duckling-2', anim: 'waddle', x: 1580, y: GROUND_Y,
        tweens: [{ t0: 0.4, t1: 1.7, to: { x: 1150, y: GROUND_Y }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'duckling-3', anim: 'waddle', x: 1680, y: GROUND_Y,
        tweens: [{ t0: 0.6, t1: 2.0, to: { x: 1240, y: GROUND_Y }, ease: 'inout', animAfter: 'imprint-pose' }] },
      { actor: 'luna', anim: 'idle', x: 560, y: GROUND_Y, flip: true, eyes: 'eyes-half' },
    ],
    audio: [
      { id: 'birds-evening', at: 0, kind: 'sfx', loop: true, volume: 0.5 },
      { id: 'quack-squeak', at: 1.0, kind: 'sfx' },
      { id: 'pop-cute', at: 1.5, kind: 'sfx' },
      { id: 'G-806', at: 3.0, kind: 'dlg', actor: 'gunner' },
    ],
  },

  // ---------------- SCENE 9: THE END ----------------
  {
    id: 'SH-901',
    start: 285,
    end: 292,
    bg: 'bg-title-skyline',
    bgTint: 0xffc9a0,
    transitionIn: { kind: 'fade', duration: 0.8 },
    transitionOut: { kind: 'iris', at: 5.5 },
    actors: [
      {
        actor: 'gunner',
        anim: 'hero-pose',
        loop: false,
        x: 960,
        y: GROUND_Y,
        tweens: [{ t0: 4.9, t1: 5.0, to: { x: 960, y: GROUND_Y }, animAfter: 'wink' }],
      },
    ],
    audio: [
      { id: 'G-901', at: 2.0, kind: 'dlg', actor: 'gunner' },
      { id: 'wink-ting', at: 5.0, kind: 'sfx' },
    ],
    music: [{ cue: 'theme-reprise', at: 0, loop: false, fade: 0.8 }],
  },
  {
    id: 'SH-902',
    start: 292,
    end: 300,
    bg: 'card-the-end',
    actors: [
      {
        actor: 'duckling-1', anim: 'waddle', x: 2050, y: 950,
        tweens: [{ t0: 1.5, t1: 2.5, to: { x: 1650, y: 950 }, ease: 'out', animAfter: 'quack-hop' }],
      },
    ],
    audio: [
      { id: 'quack-squeak', at: 2.5, kind: 'sfx' },
      { id: 'iris-pop', at: 4.0, kind: 'sfx' },
    ],
    music: [{ cue: 'button', at: 5.0, loop: false }],
  },
];

// Lip-sync mouth mappings per character (micro animation names authored in each rig)
export const MOUTH_MAP: Record<string, { closed: string; small: string; big: string }> = {
  gunner: { closed: 'mouth-closed', small: 'mouth-small', big: 'mouth-wide' },
  luna: { closed: 'mouth-closed', small: 'mouth-small', big: 'mouth-smile' },
  beans: { closed: 'mouth-closed', small: 'mouth-small', big: 'mouth-wide' },
  pip: { closed: 'mouth-closed', small: 'mouth-small', big: 'mouth-wide' },
  mama: { closed: 'mouth-closed', small: 'mouth-wide', big: 'mouth-wide' },
  'duckling-1': { closed: 'mouth-closed', small: 'mouth-wide', big: 'mouth-wide' },
  'duckling-2': { closed: 'mouth-closed', small: 'mouth-wide', big: 'mouth-wide' },
  'duckling-3': { closed: 'mouth-closed', small: 'mouth-wide', big: 'mouth-wide' },
};

export const RIG_OF_ACTOR: Record<string, string> = {
  gunner: 'gunner',
  luna: 'luna',
  beans: 'beans',
  pip: 'pip',
  mama: 'mama',
  'duckling-1': 'duckling',
  'duckling-2': 'duckling',
  'duckling-3': 'duckling',
};

// mama faces RIGHT natively; everyone else faces LEFT. The player XORs this with placement flip.
export const NATIVE_FACES_RIGHT: Record<string, boolean> = {
  gunner: false,
  luna: false,
  beans: false,
  pip: false,
  mama: true,
  'duckling-1': false,
  'duckling-2': false,
  'duckling-3': false,
};
