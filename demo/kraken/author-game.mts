import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../packages/mcp-server/src/index';
import { regionToMeshInit } from '../../apps/editor/src/renderer/modules/mesh/region-to-mesh';
import { autoGridFillGeometry } from '../../apps/editor/src/renderer/modules/mesh/topology-edit';
import { exportEffects } from '../../packages/document-core/src/index';

// KRAKEN'S HOARD: the full-game authoring demonstration. Every document mutation below goes through the
// LITERAL MCP tool handlers (TOOLS by name, Zod-validated input, Law 2 commands on the live History),
// exactly what an external LLM speaks over stdio; this script is that client minus the JSON-RPC framing.

const here = dirname(fileURLToPath(import.meta.url));
const deps: ToolDeps = {
  sessions: new SessionRegistry(),
  files: createNodeFileStore(here),
};
const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function call(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = byName.get(name);
  if (tool === undefined) throw new Error(`no such tool: ${name}`);
  try {
    return await tool.handler(deps, input);
  } catch (error) {
    console.error(`TOOL FAILED ${name}: ${(error as Error).message}`);
    throw error;
  }
}

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

// Cubic-bezier easing presets. A kf.set `curve` is the keyframe's OUTGOING segment easing; cx1/cx2 stay in
// [0, 1] so the ease is a function of time, cy1/cy2 may exceed 1 (overshoot) or go negative (anticipation)
// so a single segment can "punch past" its end value and settle (the eased y IS the interpolation fraction,
// so cy > 1 pushes the value beyond the segment's end key, then the curve returns it to the end at t=1).
type Bezier = { readonly type: 'bezier'; cx1: number; cy1: number; cx2: number; cy2: number };
const EASE_OUT: Bezier = { type: 'bezier', cx1: 0.22, cy1: 1, cx2: 0.36, cy2: 1 };
const EASE_IN: Bezier = { type: 'bezier', cx1: 0.55, cy1: 0, cx2: 0.78, cy2: 0 };
const EASE_IN_OUT: Bezier = { type: 'bezier', cx1: 0.65, cy1: 0, cx2: 0.35, cy2: 1 };
const EASE_OUT_BACK: Bezier = { type: 'bezier', cx1: 0.34, cy1: 1.56, cx2: 0.64, cy2: 1 };

// ---- 1. document + atlas -------------------------------------------------------------------------
const { documentId } = await call('document.new', { name: 'krakens-hoard' });
const atlasRef = JSON.parse(readFileSync(join(here, 'atlas', 'atlas-ref.json'), 'utf8'));
// Page files are project-relative for the render tool; the atlas dir holds them.
atlasRef.pages = atlasRef.pages.map((p: { file: string; [key: string]: unknown }) => ({
  ...p,
  file: join('atlas', p.file),
}));
await call('atlas.set', { documentId, atlas: atlasRef });

// Region pixel sizes (trimmed) by name, for authored attachment sizing at native aspect.
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) {
  for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
}
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

// ---- 2. scene skeleton ---------------------------------------------------------------------------
const { boneId: root } = await call('bone.create', { documentId, name: 'root', length: 10 });

async function staticSlot(
  name: string,
  bone: string,
  region: string,
  targetH: number,
  x: number,
  y: number,
  alpha = 1,
): Promise<string> {
  const { slotId } = await call('slot.create', {
    documentId,
    name,
    boneId: bone,
    color: { ...WHITE, a: alpha },
    attachment: region,
  });
  await call('attach.region.add', {
    documentId,
    slotId,
    name: region,
    path: region,
    x,
    y,
    ...sized(region, targetH),
  });
  return slotId;
}

// Backdrop, frame, title (world units; y-down; scene rect is set at render time).
await staticSlot('bg', root, 'bg', 2400, 0, 0);
await staticSlot('frame', root, 'frame', 1150, 0, 40);
await staticSlot('title', root, 'title', 260, 0, -560);

// ---- 3. the 5x3 reel grid ------------------------------------------------------------------------
const CELL = 170;
const COLS = [-360, -180, 0, 180, 360];
const ROWS = [-140, 40, 220];

// The full symbol vocabulary (also drives the symbol library in section 8). EVERY cell slot receives a
// region attachment for ALL of these (name == symbol, unique per slot), so an attachment-swap timeline
// (kf.attachment.set) can cycle any symbol onto any cell. The player never needs this (it scrolls its
// own strips), but it makes the authored document a complete reel that any tool can re-symbol.
const SYMBOLS = [
  'blue_ruby',
  'green_ruby',
  'purple_ruby',
  'diamond',
  'pearl',
  'orb',
  'chest',
  'treasure',
  'kraken',
  'princess',
  'snake',
  'trident',
  'wild',
  'scatter',
  'bonus',
];

// The CRAFTED landing outcome (Law 1 note: this is the DEMO's fixed board, authored as the setup pose so
// the player can reveal it with zero document mutation; a real game gets the board from SpinResult). The
// trigger symbols are placed left to right so the anticipation beat reads: scatter on reel 1 (r0c0),
// scatter on reel 3 (r1c2) arms the 2-scatter anticipation, and the bonus on reel 5 (r1c4) is the third
// trigger that fires the free-spins intro. The kraken hero stays at r0c2 (it becomes the weighted mesh).
const LAYOUT: string[][] = [
  ['scatter', 'chest', 'kraken', 'pearl', 'green_ruby'],
  ['trident', 'wild', 'scatter', 'diamond', 'bonus'],
  ['purple_ruby', 'snake', 'treasure', 'orb', 'blue_ruby'],
];

// One bone per cell (the pulse/pop animations key these), one slot per cell.
const cellBones: string[][] = [];
const cellSlots: string[][] = [];
for (let r = 0; r < 3; r += 1) {
  cellBones.push([]);
  cellSlots.push([]);
  for (let c = 0; c < 5; c += 1) {
    const symbol = LAYOUT[r]![c]!;
    const { boneId } = await call('bone.create', {
      documentId,
      parentId: root,
      name: `cell_${r}_${c}`,
      x: COLS[c],
      y: ROWS[r],
      length: 5,
    });
    const { slotId } = await call('slot.create', {
      documentId,
      name: `sym_${r}_${c}`,
      boneId,
      color: { ...WHITE },
      attachment: symbol,
    });
    // Every cell carries all 15 symbol attachments; the setup active attachment is the crafted symbol.
    for (const sym of SYMBOLS) {
      await call('attach.region.add', {
        documentId,
        slotId,
        name: sym,
        path: sym,
        ...sized(sym, CELL),
      });
    }
    cellBones[r]!.push(boneId);
    cellSlots[r]!.push(slotId);
  }
}

// ---- 3b. animation keying helpers + the per-symbol win-character vocabulary ----------------------
type Curve = 'linear' | 'stepped' | Bezier;
type Vec2 = { x: number; y: number };
type Rgba = { r: number; g: number; b: number; a: number };

async function boneKey(
  animationId: string,
  channel: 'rotate' | 'translate' | 'scale' | 'shear',
  boneId: string,
  time: number,
  value: Vec2 | { angle: number },
  curve?: Curve,
): Promise<void> {
  await call('kf.set', {
    documentId,
    animationId,
    channel,
    boneId,
    time,
    value,
    ...(curve !== undefined ? { curve } : {}),
  });
}

async function colorKey(
  animationId: string,
  targetSlot: string,
  time: number,
  color: Rgba,
  curve?: Curve,
): Promise<void> {
  await call('kf.set', {
    documentId,
    animationId,
    channel: 'color',
    slotId: targetSlot,
    time,
    value: { color },
    ...(curve !== undefined ? { curve } : {}),
  });
}

const gold = (a = 1): Rgba => ({ r: 1, g: 0.82, b: 0.3, a });

// Each symbol reacts with its OWN character during win_celebration (this is the "juice" the PO wanted).
// spinPop: a gem/shiny snaps up past its target (ease-out-back) then squashes wide/short and settles,
// spinning a full turn on the way. Applied to every gem-class cell so the whole board reacts, not the
// middle row alone (which the MEGA WIN banner occludes at the peak).
async function spinPop(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(animationId, 'scale', boneId, 0.28, { x: 1.28, y: 1.28 }, EASE_OUT);
  await boneKey(animationId, 'scale', boneId, 0.44, { x: 1.14, y: 0.9 }, EASE_IN_OUT); // squash
  await boneKey(animationId, 'scale', boneId, 0.62, { x: 0.96, y: 1.06 }, EASE_IN_OUT); // counter-stretch
  await boneKey(animationId, 'scale', boneId, 0.9, { x: 1, y: 1 });
  await boneKey(animationId, 'rotate', boneId, 0, { angle: 0 }, EASE_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.5, { angle: 360 });
}

// heavyBounce: a chest slams down (drop + wide/short impact squash), rebounds tall/narrow, then settles.
// translate values are OFFSETS from the bone's setup local position (the solve adds them to setup), so the
// y drop/lift is keyed as a pure delta with x held at 0.
async function heavyBounce(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'translate', boneId, 0, { x: 0, y: 0 }, EASE_IN);
  await boneKey(animationId, 'translate', boneId, 0.16, { x: 0, y: 18 }, EASE_OUT);
  await boneKey(animationId, 'translate', boneId, 0.34, { x: 0, y: -12 }, EASE_IN_OUT);
  await boneKey(animationId, 'translate', boneId, 0.55, { x: 0, y: 3 }, EASE_OUT);
  await boneKey(animationId, 'translate', boneId, 0.75, { x: 0, y: 0 });
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_IN);
  await boneKey(animationId, 'scale', boneId, 0.16, { x: 1.3, y: 0.75 }, EASE_OUT); // impact squash
  await boneKey(animationId, 'scale', boneId, 0.34, { x: 0.85, y: 1.2 }, EASE_IN_OUT); // stretch
  await boneKey(animationId, 'scale', boneId, 0.55, { x: 1.04, y: 0.97 }, EASE_OUT);
  await boneKey(animationId, 'scale', boneId, 0.75, { x: 1, y: 1 });
}

// swing: a trident/serpent pendulums +24 -> -18 -> 6 -> 0 with an eased-in-out settle and a gentle heave.
async function swing(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'rotate', boneId, 0, { angle: 0 }, EASE_IN_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.35, { angle: 18 }, EASE_IN_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.85, { angle: -13 }, EASE_IN_OUT);
  await boneKey(animationId, 'rotate', boneId, 1.3, { angle: 5 }, EASE_IN_OUT);
  await boneKey(animationId, 'rotate', boneId, 1.7, { angle: 0 });
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.5, { x: 1.06, y: 1.06 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 1.7, { x: 1, y: 1 });
}

// heartbeat: the wild throws two quick scale beats and pulses gold in step, then settles white.
async function heartbeat(animationId: string, boneId: string, targetSlot: string): Promise<void> {
  const beats: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [0.12, 1.17],
    [0.24, 1],
    [0.38, 1.14],
    [0.52, 1],
  ];
  for (const [t, s] of beats) {
    await boneKey(animationId, 'scale', boneId, t, { x: s, y: s }, s > 1 ? EASE_OUT : EASE_IN);
  }
  const pulses: ReadonlyArray<readonly [number, Rgba]> = [
    [0, WHITE],
    [0.12, gold()],
    [0.24, WHITE],
    [0.38, gold()],
    [0.52, WHITE],
  ];
  for (const [t, c] of pulses) await colorKey(animationId, targetSlot, t, c, EASE_IN_OUT);
}

// flash: a scatter/bonus pops with an ease-out-back overshoot and a brighter TWO-stage near-white flash.
async function flash(animationId: string, boneId: string, targetSlot: string): Promise<void> {
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(animationId, 'scale', boneId, 0.18, { x: 1.3, y: 1.3 }, EASE_OUT);
  await boneKey(animationId, 'scale', boneId, 0.45, { x: 1, y: 1 });
  await colorKey(animationId, targetSlot, 0, WHITE, EASE_OUT);
  await colorKey(animationId, targetSlot, 0.1, { r: 1, g: 0.99, b: 0.85, a: 1 }, EASE_IN);
  await colorKey(animationId, targetSlot, 0.22, { r: 1, g: 0.92, b: 0.68, a: 1 }, EASE_OUT);
  await colorKey(animationId, targetSlot, 0.32, { r: 1, g: 1, b: 0.95, a: 1 }, EASE_IN); // 2nd, brighter
  await colorKey(animationId, targetSlot, 0.5, WHITE);
}

const GEM_SYMBOLS = new Set([
  'blue_ruby',
  'green_ruby',
  'purple_ruby',
  'diamond',
  'pearl',
  'orb',
  'princess',
]);
const CHEST_SYMBOLS = new Set(['chest', 'treasure']);
const SWING_SYMBOLS = new Set(['trident', 'snake']);

// ---- 4. the kraken hero cell becomes a WEIGHTED MESH (rig it like a character) --------------------
// Center-top cell (row 0, col 2) carries the kraken: convert its region to a grid-filled mesh, bind it
// to a two-bone chain, auto-weight, so the win celebration can wave the tentacles with deform.
const krakenSlot = cellSlots[0]![2]!;
const krakenBase = cellBones[0]![2]!;
const { boneId: krakenTip } = await call('bone.create', {
  documentId,
  parentId: krakenBase,
  name: 'kraken_tip',
  y: -CELL * 0.35,
  length: 40,
});
const krakenSize = sized('kraken', CELL);
const meshInit = regionToMeshInit({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  width: krakenSize.width,
  height: krakenSize.height,
  color: WHITE,
});
await call('mesh.generateFromRegion', {
  documentId,
  slotId: krakenSlot,
  name: 'kraken',
  ...meshInit,
});
const filled = autoGridFillGeometry(
  {
    uvs: meshInit.uvs,
    triangles: meshInit.triangles,
    hullLength: meshInit.hullLength,
    vertices: meshInit.vertices,
  },
  CELL / 4,
);
await call('mesh.autoGridFill', {
  documentId,
  slotId: krakenSlot,
  name: 'kraken',
  uvs: filled.uvs,
  triangles: filled.triangles,
  hullLength: meshInit.hullLength,
  vertices: filled.vertices,
});
await call('mesh.bindToBones', {
  documentId,
  slotId: krakenSlot,
  name: 'kraken',
  boneIds: [krakenBase, krakenTip],
  weightMode: 'rigidNearest',
});
await call('mesh.autoWeight', { documentId, slotId: krakenSlot, name: 'kraken' });

// ---- 5. the mega-win banner (color-keyed pop, alpha 0 at setup) -----------------------------------
const bannerSlot = await staticSlot('banner_mega', root, 'mega_win', 300, 0, -40, 0);

// The bonus-intro banners: kraken_awakens (top) and free_pins (center). Each rides its OWN bone (at the
// banner center, attachment at (0,0)) so the intro can scale-pop it around its center; both start alpha 0
// at setup, exactly like banner_mega, so they are invisible until the bonus_intro animation reveals them.
const { boneId: bannerBoneAwakens } = await call('bone.create', {
  documentId,
  parentId: root,
  name: 'banner_bone_awakens',
  x: 0,
  y: -320,
  length: 5,
});
const bannerAwakensSlot = await staticSlot(
  'banner_awakens',
  bannerBoneAwakens,
  'kraken_awakens',
  240,
  0,
  0,
  0,
);
const { boneId: bannerBoneFreepins } = await call('bone.create', {
  documentId,
  parentId: root,
  name: 'banner_bone_freepins',
  x: 0,
  y: 70,
  length: 5,
});
const bannerFreepinsSlot = await staticSlot(
  'banner_freepins',
  bannerBoneFreepins,
  'free_pins',
  300,
  0,
  0,
  0,
);

// ---- 6. animations -------------------------------------------------------------------------------
// 'idle': a gentle 2s loop. Instead of a uniform scale breath (v2 read as the whole board pumping in
// lockstep), every cell gets a small y-bob (2.5px), a rotation sway (0.8deg), and a subtle scale (1.015),
// each on a sine whose PHASE is derived from the cell index so the board shimmers organically like light
// through water. The sine closes the 2s loop exactly (sin(w*0 + p) == sin(w*2 + p)); bezier-smoothed.
const { animationId: idle } = await call('anim.create', { documentId, name: 'idle', duration: 2 });
const IDLE_SAMPLES = [0, 0.5, 1, 1.5, 2] as const;
const w = Math.PI; // 2*PI / period(2s): one full cycle across the loop
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const b = cellBones[r]![c]!;
    const phase = (r * 5 + c) * 0.7;
    for (const t of IDLE_SAMPLES) {
      const last = t === 2;
      // translate/rotate are OFFSETS from setup (the solve adds them), so bob/sway are pure deltas.
      const dy = 2.5 * Math.sin(w * t + phase);
      const sway = 0.8 * Math.sin(w * t + phase + 0.6);
      const scl = 1 + 0.015 * Math.sin(w * t + phase + 1.2);
      await boneKey(idle, 'translate', b, t, { x: 0, y: dy }, last ? 'linear' : EASE_IN_OUT);
      await boneKey(idle, 'rotate', b, t, { angle: sway }, last ? 'linear' : EASE_IN_OUT);
      await boneKey(idle, 'scale', b, t, { x: scl, y: scl }, last ? 'linear' : EASE_IN_OUT);
    }
  }
}
for (const [t, angle] of [
  [0, 0],
  [0.5, 5],
  [1.5, -5],
  [2, 0],
] as const) {
  await boneKey(idle, 'rotate', krakenTip, t, { angle }, t === 2 ? 'linear' : EASE_IN_OUT);
}

// 'win_celebration': 2s. Every cell reacts with its OWN character (gems spin-pop, chests heavy-bounce,
// trident/serpent swing, the wild heartbeats gold, scatters/bonus two-stage flash), the banner reveals
// with snap, and the kraken hero waves its tentacles via an amplified deform timeline with an overshooting
// tip. The whole board celebrates so the motion still reads above and below the MEGA WIN banner.
const { animationId: win } = await call('anim.create', {
  documentId,
  name: 'win_celebration',
  duration: 2,
});
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    if (r === 0 && c === 2) continue; // the kraken hero cell is animated on its own (deform + tip) below
    const b = cellBones[r]![c]!;
    const s = cellSlots[r]![c]!;
    const symbol = LAYOUT[r]![c]!;
    if (symbol === 'wild') {
      await heartbeat(win, b, s);
    } else if (symbol === 'scatter' || symbol === 'bonus') {
      await flash(win, b, s);
    } else if (CHEST_SYMBOLS.has(symbol)) {
      await heavyBounce(win, b);
    } else if (SWING_SYMBOLS.has(symbol)) {
      await swing(win, b);
    } else if (GEM_SYMBOLS.has(symbol)) {
      await spinPop(win, b);
    } else {
      await spinPop(win, b);
    }
  }
}
// The MEGA WIN banner reveals with an ease-out snap (alpha overshoot clamps at 1, so it reads as a punch-in)
// and holds, then fades out at the end.
await colorKey(win, bannerSlot, 0, { ...WHITE, a: 0 }, EASE_OUT);
await colorKey(win, bannerSlot, 0.3, WHITE, EASE_IN_OUT);
await colorKey(win, bannerSlot, 1.8, WHITE, EASE_IN);
await colorKey(win, bannerSlot, 2, { ...WHITE, a: 0 });

// Deform wave: sinusoidal world-space offsets across the kraken mesh (bigger toward the bottom, where the
// tentacles live). Amplitudes are ~1.6x the v2 wave so the tentacles read as a real thrash. offsets are
// [dx, dy] per logical vertex.
const vertexCount = filled.uvs.length / 2;
function waveOffsets(amp: number, phase: number): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const vx = filled.vertices[i * 2]!;
    const vy = filled.vertices[i * 2 + 1]!;
    const tentacleWeight = Math.max(0, (vy + krakenSize.height / 2) / krakenSize.height); // 0 top -> 1 bottom
    offsets.push(
      Math.sin(vy * 0.09 + phase) * amp * tentacleWeight,
      Math.cos(vx * 0.07 + phase) * amp * 0.35 * tentacleWeight,
    );
  }
  return offsets;
}
for (const [t, amp, phase] of [
  [0, 0, 0],
  [0.5, 15, 1.2],
  [1.0, 7, 2.6],
  [1.5, 15, 4.0],
  [2, 0, 0],
] as const) {
  await call('deform.setKeyframe', {
    documentId,
    animationId: win,
    skin: 'default',
    slotId: krakenSlot,
    name: 'kraken',
    time: t,
    offsets: waveOffsets(amp, phase),
  });
}
// A gentle pulse on the hero base so the kraken swells with the win without fighting the deform wave.
await boneKey(win, 'scale', krakenBase, 0, { x: 1, y: 1 }, EASE_OUT);
await boneKey(win, 'scale', krakenBase, 0.4, { x: 1.12, y: 1.12 }, EASE_IN_OUT);
await boneKey(win, 'scale', krakenBase, 1.2, { x: 1.05, y: 1.05 }, EASE_IN_OUT);
await boneKey(win, 'scale', krakenBase, 2, { x: 1, y: 1 });
// The tip lashes with an ease-out-back overshoot on the first beat, then swings through and settles.
await boneKey(win, 'rotate', krakenTip, 0, { angle: 0 }, EASE_OUT_BACK);
await boneKey(win, 'rotate', krakenTip, 0.4, { angle: 16 }, EASE_IN_OUT);
await boneKey(win, 'rotate', krakenTip, 1.0, { angle: -8 }, EASE_IN_OUT);
await boneKey(win, 'rotate', krakenTip, 1.5, { angle: 12 }, EASE_IN_OUT);
await boneKey(win, 'rotate', krakenTip, 2, { angle: 0 });

// ---- 6b. spin-loop animations (authored over MCP, played live by the player on AnimationState tracks) --
// The crafted trigger cells: two scatters (reel 1 and reel 3) and the bonus (reel 5). The glow/land/land
// animations key EXACTLY these cells (the outcome is fixed for the demo), so the player can layer them on
// dedicated tracks without touching the document.
const SCATTER_CELLS = [
  { r: 0, c: 0 },
  { r: 1, c: 2 },
] as const;
const TRIGGER_CELLS = [
  { r: 0, c: 0 },
  { r: 1, c: 2 },
  { r: 1, c: 4 },
] as const;

// 'reel_stop_bounce' (0.35s): a downward y overshoot (+14) that rebounds and settles to 0. Authored over
// EVERY cell so one animation serves all five reels; the player plays it on an ADDITIVE track (the delta
// is sample-minus-setup, so keying translate at the cell's own base + delta yields a pure offset), and
// restarts it at each staggered reel stop. Columns still spinning are covered by the player strips, so
// the whole-board additive bounce only ever reads on the reel that just landed.
const { animationId: reelStopBounce } = await call('anim.create', {
  documentId,
  name: 'reel_stop_bounce',
  duration: 0.35,
});
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const b = cellBones[r]![c]!;
    // translate values are OFFSETS from setup, so the bounce is a pure y delta (x held at 0). Played on
    // an additive track the contribution is exactly this delta. Ease-in the drop (gathers speed into the
    // impact), ease-out-back the rebound so the reel visibly overshoots up past rest before it settles.
    for (const [t, dy, curve] of [
      [0, 0, EASE_IN],
      [0.12, 16, EASE_OUT_BACK],
      [0.24, -6, EASE_IN_OUT],
      [0.35, 0, 'linear'],
    ] as const) {
      await boneKey(reelStopBounce, 'translate', b, t, { x: 0, y: dy }, curve);
    }
  }
}

// 'anticipation_glow' (1s loop): the two landed scatter cells pulse toward gold and breathe 1 <-> 1.12.
// Played by the player on a REPLACE track (higher than idle) once two scatters are armed, and cleared when
// the third trigger lands. Only the scatter cells are keyed, so every other cell keeps its idle breathing.
const { animationId: anticipationGlow } = await call('anim.create', {
  documentId,
  name: 'anticipation_glow',
  duration: 1,
});
for (const { r, c } of SCATTER_CELLS) {
  const b = cellBones[r]![c]!;
  const s = cellSlots[r]![c]!;
  for (const [t, scale] of [
    [0, 1],
    [0.5, 1.12],
    [1, 1],
  ] as const) {
    await call('kf.set', {
      documentId,
      animationId: anticipationGlow,
      channel: 'scale',
      boneId: b,
      time: t,
      value: { x: scale, y: scale },
    });
  }
  for (const [t, color] of [
    [0, WHITE],
    [0.5, { r: 1, g: 0.85, b: 0.35, a: 1 }],
    [1, WHITE],
  ] as const) {
    await call('kf.set', {
      documentId,
      animationId: anticipationGlow,
      channel: 'color',
      slotId: s,
      time: t,
      value: { color },
    });
  }
}

// 'scatter_land' (0.5s): the three trigger cells pop 1 -> 1.35 -> 1 with a bright near-white flash. Played
// on track 0 (crossfaded from idle) the instant the third trigger lands, just before the bonus intro.
const { animationId: scatterLand } = await call('anim.create', {
  documentId,
  name: 'scatter_land',
  duration: 0.5,
});
for (const { r, c } of TRIGGER_CELLS) {
  const b = cellBones[r]![c]!;
  const s = cellSlots[r]![c]!;
  // Ease-out-back pop so the trigger snaps past 1.35 and settles, then a brighter TWO-stage flash.
  await boneKey(scatterLand, 'scale', b, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(scatterLand, 'scale', b, 0.2, { x: 1.35, y: 1.35 }, EASE_IN_OUT);
  await boneKey(scatterLand, 'scale', b, 0.5, { x: 1, y: 1 });
  await colorKey(scatterLand, s, 0, WHITE, EASE_OUT);
  await colorKey(scatterLand, s, 0.12, { r: 1, g: 0.99, b: 0.85, a: 1 }, EASE_IN);
  await colorKey(scatterLand, s, 0.24, { r: 1, g: 0.92, b: 0.7, a: 1 }, EASE_OUT);
  await colorKey(scatterLand, s, 0.34, { r: 1, g: 1, b: 0.96, a: 1 }, EASE_IN); // 2nd, brighter
  await colorKey(scatterLand, s, 0.5, WHITE);
}

// 'bonus_intro' (2.5s): the kraken_awakens banner scale-pops in at t=0.3, then the free_pins banner rises
// in at t=1.2. Both banners fade alpha 0 -> 1 in step with a bone scale-pop around their own centers. The
// player crossfades to this after scatter_land and settles back to idle when it finishes.
const { animationId: bonusIntro } = await call('anim.create', {
  documentId,
  name: 'bonus_intro',
  duration: 2.5,
});
for (const [t, alpha] of [
  [0, 0],
  [0.3, 1],
  [2.5, 1],
] as const) {
  await call('kf.set', {
    documentId,
    animationId: bonusIntro,
    channel: 'color',
    slotId: bannerAwakensSlot,
    time: t,
    value: { color: { ...WHITE, a: alpha } },
  });
}
for (const [t, scale] of [
  [0, 0.6],
  [0.3, 1.15],
  [0.5, 1],
] as const) {
  await call('kf.set', {
    documentId,
    animationId: bonusIntro,
    channel: 'scale',
    boneId: bannerBoneAwakens,
    time: t,
    value: { x: scale, y: scale },
  });
}
for (const [t, alpha] of [
  [0, 0],
  [1.2, 1],
  [2.5, 1],
] as const) {
  await call('kf.set', {
    documentId,
    animationId: bonusIntro,
    channel: 'color',
    slotId: bannerFreepinsSlot,
    time: t,
    value: { color: { ...WHITE, a: alpha } },
  });
}
for (const [t, scale] of [
  [0, 0.6],
  [1.2, 0.6],
  [1.45, 1.12],
  [1.65, 1],
] as const) {
  await call('kf.set', {
    documentId,
    animationId: bonusIntro,
    channel: 'scale',
    boneId: bannerBoneFreepins,
    time: t,
    value: { x: scale, y: scale },
  });
}

// ---- 7. effects: dedicated FX atlas + layered mega-win bundle -------------------------------------
// Pack the procedurally-generated FX art (glow/spark/bubble/mote in source-fx/) into a SEPARATE effects
// atlas via the same headless atlas.pack tool the editor runs (import -> trim -> maxrects -> emit). NOTE:
// atlas.pack installs its packed ref as the document (skeleton) atlas as a side effect, so we immediately
// re-install the real skeleton atlas and keep the packed FX ref only for the effects library. This shows
// the whole headless pack loop AND gives the VFX real art instead of scaled-down symbols.
mkdirSync(join(here, 'atlas-fx'), { recursive: true });
const { atlas: fxAtlas } = await call('atlas.pack', {
  documentId,
  sourceDir: 'source-fx',
  outputDir: 'atlas-fx',
});
await call('atlas.set', { documentId, atlas: atlasRef }); // restore the skeleton atlas
await call('effect.setAtlas', { documentId, atlas: fxAtlas });

type EffectsRange = { min: number; max: number };
type EmitterBody = {
  type: 'emitter';
  name: string;
  maxParticles: number;
  spawn:
    | { mode: 'rate'; particlesPerSecond: number }
    | { mode: 'burst'; count: number; atTime: number };
  shape:
    | { kind: 'point' }
    | { kind: 'circle'; radius: number; edgeOnly: boolean }
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
    | { kind: 'rect'; width: number; height: number };
  lifetime: EffectsRange;
  startSpeed: EffectsRange;
  emissionAngle: EffectsRange;
  startRotation: EffectsRange;
  angularVelocity: EffectsRange;
  startScale: EffectsRange;
  gravity: { x: number; y: number };
  acceleration: { x: number; y: number };
  drag: number;
  texture: { kind: 'static'; region: string };
  trail: null;
};
type Rgb = { r: number; g: number; b: number };
type LifeStopDef = { t: number; value: number | Rgb; curve?: Curve };

// Add a fully-configured emitter layer: create the default layer, replace its body wholesale, and drive
// each life curve (the default 2 anchors are edited in place; interior stops are inserted).
async function addEmitterLayer(
  effectId: string,
  blendMode: 'normal' | 'additive',
  body: EmitterBody,
  curves: {
    scaleOverLife?: readonly LifeStopDef[];
    colorOverLife?: readonly LifeStopDef[];
    alphaOverLife?: readonly LifeStopDef[];
  },
): Promise<void> {
  const { layerId } = await call('effect.layer.add', {
    documentId,
    effectId,
    kind: 'emitter',
    blendMode,
    region: body.texture.region,
  });
  await call('effect.layer.setField', { documentId, effectId, layerId, field: 'body', body });
  for (const field of ['scaleOverLife', 'colorOverLife', 'alphaOverLife'] as const) {
    const stops = curves[field];
    if (stops === undefined) continue;
    await editLifeCurve(effectId, layerId, field, stops);
  }
}

// Edit a life curve to an ordered stop list (first t=0, last t=1). The freshly-added layer ships exactly
// two anchor stops; we set those endpoints in place and insert any interior stops (t strictly inside 0..1).
async function editLifeCurve(
  effectId: string,
  layerId: string,
  field: 'scaleOverLife' | 'colorOverLife' | 'alphaOverLife',
  stops: readonly LifeStopDef[],
): Promise<void> {
  const detail = await call('effect.get', { documentId, effectId });
  const layer = detail.effect.layers.find((l: { id: string }) => l.id === layerId);
  const curve = layer.curves.find((cu: { field: string }) => cu.field === field);
  const [s0, s1] = curve.stops as ReadonlyArray<{ id: string }>;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  await call('effect.lifeStop.setValue', {
    documentId,
    effectId,
    layerId,
    stopId: s0!.id,
    value: first.value,
  });
  await call('effect.lifeStop.setValue', {
    documentId,
    effectId,
    layerId,
    stopId: s1!.id,
    value: last.value,
  });
  if (first.curve !== undefined) {
    await call('effect.lifeStop.setCurve', {
      documentId,
      effectId,
      layerId,
      stopId: s0!.id,
      curve: first.curve,
    });
  }
  for (const interior of stops.slice(1, -1)) {
    await call('effect.lifeStop.add', {
      documentId,
      effectId,
      layerId,
      field,
      t: interior.t,
      value: interior.value,
      curve: interior.curve ?? 'linear',
    });
  }
}

const GOLD: Rgb = { r: 1, g: 0.8, b: 0.3 };
const AMBER: Rgb = { r: 1, g: 0.55, b: 0.2 };
const WHITE_RGB: Rgb = { r: 1, g: 1, b: 1 };
// A rising-bubble alpha curve: fade IN, hold, fade OUT (so bubbles never pop on or off).
const BUBBLE_ALPHA: readonly LifeStopDef[] = [
  { t: 0, value: 0, curve: EASE_OUT },
  { t: 0.15, value: 0.82 },
  { t: 0.75, value: 0.82 },
  { t: 1, value: 0 },
];

// 'winBurst': four layered passes, tuned by LOOKING at composed renders (never blows to white: the glow is
// tinted gold-amber not pure white, particles fly apart fast, sparks/motes stay small).
const { effectId: winBurst } = await call('effect.create', { documentId, name: 'winBurst' });
// Layer 1 (behind): rising translucent bubbles (normal blend) drifting up out of the burst.
await addEmitterLayer(
  winBurst,
  'normal',
  {
    type: 'emitter',
    name: 'bubbles',
    maxParticles: 70,
    spawn: { mode: 'rate', particlesPerSecond: 30 },
    shape: { kind: 'circle', radius: 72, edgeOnly: false },
    lifetime: { min: 2.0, max: 3.0 },
    startSpeed: { min: 40, max: 120 },
    emissionAngle: { min: 240, max: 300 }, // up-ish (270 = straight up in y-down), x jitter via spread
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: -20, max: 20 },
    startScale: { min: 0.35, max: 0.85 },
    gravity: { x: 0, y: -150 }, // negative y = upward drift
    acceleration: { x: 0, y: 0 },
    drag: 0.4,
    texture: { kind: 'static', region: 'bubble' },
    trail: null,
  },
  { alphaOverLife: BUBBLE_ALPHA },
);
// Layer 2: an additive gold glow ring bursting outward and fading (the flash/shockwave).
await addEmitterLayer(
  winBurst,
  'additive',
  {
    type: 'emitter',
    name: 'glow',
    maxParticles: 40,
    spawn: { mode: 'burst', count: 14, atTime: 0 },
    shape: { kind: 'circle', radius: 8, edgeOnly: false },
    lifetime: { min: 0.6, max: 0.8 },
    startSpeed: { min: 200, max: 480 },
    emissionAngle: { min: 0, max: 360 },
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: 0, max: 0 },
    startScale: { min: 0.9, max: 1.3 },
    gravity: { x: 0, y: 40 },
    acceleration: { x: 0, y: 0 },
    drag: 1.6,
    texture: { kind: 'static', region: 'glow' },
    trail: null,
  },
  {
    scaleOverLife: [
      { t: 0, value: 0.4, curve: EASE_OUT },
      { t: 1, value: 1.6 },
    ],
    colorOverLife: [
      { t: 0, value: GOLD },
      { t: 1, value: AMBER },
    ],
    alphaOverLife: [
      { t: 0, value: 0.7, curve: EASE_OUT },
      { t: 1, value: 0 },
    ],
  },
);
// Layer 3: additive gold sparkles spinning outward, arcing down under gravity, shrinking to nothing.
await addEmitterLayer(
  winBurst,
  'additive',
  {
    type: 'emitter',
    name: 'sparkles',
    maxParticles: 80,
    spawn: { mode: 'burst', count: 34, atTime: 0 },
    shape: { kind: 'circle', radius: 6, edgeOnly: false },
    lifetime: { min: 0.9, max: 1.4 },
    startSpeed: { min: 260, max: 680 },
    emissionAngle: { min: 0, max: 360 },
    startRotation: { min: 0, max: 360 },
    angularVelocity: { min: -220, max: 220 },
    startScale: { min: 0.22, max: 0.5 },
    gravity: { x: 0, y: 240 },
    acceleration: { x: 0, y: 0 },
    drag: 0.6,
    texture: { kind: 'static', region: 'spark' },
    trail: null,
  },
  {
    scaleOverLife: [
      { t: 0, value: 1, curve: EASE_IN },
      { t: 1, value: 0 },
    ],
    colorOverLife: [
      { t: 0, value: WHITE_RGB },
      { t: 1, value: GOLD },
    ],
    alphaOverLife: [
      { t: 0, value: 1 },
      { t: 0.72, value: 1 },
      { t: 1, value: 0 },
    ],
  },
);
// Layer 4 (top): faint additive gold dust motes that twinkle in and drift up.
await addEmitterLayer(
  winBurst,
  'additive',
  {
    type: 'emitter',
    name: 'motes',
    maxParticles: 50,
    spawn: { mode: 'burst', count: 22, atTime: 0 },
    shape: { kind: 'circle', radius: 60, edgeOnly: false },
    lifetime: { min: 0.8, max: 1.6 },
    startSpeed: { min: 20, max: 120 },
    emissionAngle: { min: 0, max: 360 },
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: 0, max: 0 },
    startScale: { min: 0.4, max: 1.0 },
    gravity: { x: 0, y: -40 },
    acceleration: { x: 0, y: 0 },
    drag: 0.8,
    texture: { kind: 'static', region: 'mote' },
    trail: null,
  },
  {
    colorOverLife: [
      { t: 0, value: WHITE_RGB },
      { t: 1, value: GOLD },
    ],
    alphaOverLife: [
      { t: 0, value: 0, curve: EASE_OUT },
      { t: 0.2, value: 0.6 },
      { t: 0.6, value: 0.5 },
      { t: 1, value: 0 },
    ],
  },
);

// 'bubbleCurtain': a wide, slow bubble field spawned along a LINE across the grid width, rising over the
// whole board so the celebration reads as more than a point burst.
const { effectId: bubbleCurtain } = await call('effect.create', {
  documentId,
  name: 'bubbleCurtain',
});
await addEmitterLayer(
  bubbleCurtain,
  'normal',
  {
    type: 'emitter',
    name: 'curtain',
    maxParticles: 120,
    spawn: { mode: 'rate', particlesPerSecond: 58 },
    shape: { kind: 'line', x1: -470, y1: 40, x2: 470, y2: 40 },
    lifetime: { min: 2.2, max: 3.4 },
    startSpeed: { min: 30, max: 90 },
    emissionAngle: { min: 250, max: 290 },
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: -15, max: 15 },
    startScale: { min: 0.4, max: 0.85 },
    gravity: { x: 0, y: -130 },
    acceleration: { x: 0, y: 0 },
    drag: 0.3,
    texture: { kind: 'static', region: 'bubble' },
    trail: null,
  },
  { alphaOverLife: BUBBLE_ALPHA },
);

// The mega-celebration bundle: a winBurst at grid center, a second seed-varied winBurst a beat later, and
// the wide bubbleCurtain underneath, all anchored to gridCenter.
await call('bundle.create', { documentId, name: 'megaCelebration' });
await call('bundle.item.add', {
  documentId,
  name: 'megaCelebration',
  item: { effect: bubbleCurtain, startOffset: 0, anchorRole: 'gridCenter', seedSalt: 5 },
});
await call('bundle.item.add', {
  documentId,
  name: 'megaCelebration',
  item: { effect: winBurst, startOffset: 0, anchorRole: 'gridCenter', seedSalt: 11 },
});
await call('bundle.item.add', {
  documentId,
  name: 'megaCelebration',
  item: { effect: winBurst, startOffset: 0.25, anchorRole: 'gridCenter', seedSalt: 27 },
});

// ---- 8. slot composition -------------------------------------------------------------------------
// The authored animation names the symbol library (and the flow validator) may reference.
const ANIMATION_NAMES = [
  'idle',
  'win_celebration',
  'reel_stop_bounce',
  'anticipation_glow',
  'scatter_land',
  'bonus_intro',
];
for (const symbol of SYMBOLS) {
  await call('slot.symbol.map', {
    documentId,
    symbolId: symbol,
    animSet: {
      skeletonRef: 'krakens-hoard',
      idle: 'idle',
      land: 'reel_stop_bounce',
      win: 'win_celebration',
      anticipation: 'anticipation_glow',
    },
    skeletonAnimationNames: ANIMATION_NAMES,
  });
}
await call('slot.winseq.create', { documentId, name: 'megaWinSequence' });

// The 5x3 reel grid: real stop stagger (280ms per reel, left to right) and a real anticipation config,
// armed once two scatter symbols have landed in stopped columns, anticipating at most the two remaining
// reels. The board itself is never authored here (Law 1): the counts come from SpinResult at runtime.
await call('slot.grid.set', {
  documentId,
  grid: {
    topology: 'reelStrip',
    cols: 5,
    rows: 3,
    cellWidth: 170,
    cellHeight: 170,
    cellGap: 20,
    reelStopStaggerMs: 280,
    gravity: 'column-down',
    anticipation: {
      triggerSymbols: ['scatter'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
    },
  },
});

// The feature flow: base -> freeSpins when the trigger feature reports three trigger symbols (the two
// scatters plus the bonus). The match names a feature TYPE and a data FIELD + constant only (authoring
// data, never an outcome the presentation derives, Law 1); the runtime walks it against SpinResult.
await call('slot.flow.createState', { documentId, name: 'freeSpins' });
await call('slot.flow.addTransition', {
  documentId,
  transition: {
    from: 'base',
    on: { type: 'scatterTrigger', dataEquals: { field: 'count', equals: 3 } },
    to: 'freeSpins',
  },
});

// ---- 9. save + render ----------------------------------------------------------------------------
await call('document.save', { documentId, path: 'krakens-hoard.rig.json' });

// The effects library is a SEPARATE document from the skeleton rig (document.save writes only the
// skeleton). Export it to its own JSON so the standalone player can construct an EffectSystem and display
// the megaCelebration particles live, exactly as the composed render frame solves them headlessly.
const effectsDocument = exportEffects(deps.sessions.get(documentId).document.effects);
writeFileSync(
  join(here, 'krakens-hoard.effects.json'),
  `${JSON.stringify(effectsDocument, null, 2)}\n`,
);

mkdirSync(join(here, 'renders'), { recursive: true });

const SCENE = { x: -820, y: -700, w: 1640, h: 1400 };
async function render(file: string, opts: Record<string, unknown>): Promise<void> {
  const result = await call('render_frame', {
    documentId,
    width: 1230,
    height: 1050,
    fit: SCENE,
    ...opts,
  });
  writeFileSync(join(here, 'renders', file), Buffer.from(result.pngBase64, 'base64'));
  console.log(`rendered ${file} (${result.bytes} bytes, placeholders=${result.placeholders})`);
}
await render('01-setup.png', {});
await render('02-idle-mid.png', { animation: 'idle', time: 1.0 });
await render('03-win-peak.png', { animation: 'win_celebration', time: 0.5 });
await render('04-win-wave.png', { animation: 'win_celebration', time: 1.5 });

// The two showcase frames use render_frame's effect-overlay param: the megaCelebration bundle (layered
// glow ring + gold sparkles + rising bubbles + wide bubble curtain) composited ON TOP of the skeleton at
// the grid center. Frame 05 is the big-win moment (the win animation near its scale peak, the burst solved
// to 0.5s so the ring has expanded and the sparks are arcing); frame 06 is the bonus intro at t=1.6 (both
// banners in) with the celebration solved to 1.1s (bubbles risen, second burst fading).
const GRID_CENTER = { x: 0, y: ROWS[1]! };
await render('05-composed-bigwin.png', {
  animation: 'win_celebration',
  time: 0.5,
  effect: { bundle: 'megaCelebration', seed: 1, time: 0.5, anchors: { gridCenter: GRID_CENTER } },
});
await render('06-bonus-intro.png', {
  animation: 'bonus_intro',
  time: 1.6,
  effect: { bundle: 'megaCelebration', seed: 7, time: 1.1, anchors: { gridCenter: GRID_CENTER } },
});

const validation = await call('document.validate', { documentId });
console.log('validate:', JSON.stringify(validation));
console.log('DONE: krakens-hoard authored end to end over the MCP tool surface.');
