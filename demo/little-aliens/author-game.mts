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

// LITTLE ALIENS: the full-game authoring demonstration. Every document mutation below goes through the
// LITERAL MCP tool handlers (TOOLS by name, Zod-validated input, Law 2 commands on the live History),
// exactly what an external LLM speaks over stdio; this script is that client minus the JSON-RPC framing.
// The headline is TWO per-part rigged mascots perched atop the reel frame: a GREEN SLIME whose body is a
// grid-filled WEIGHTED MESH bound to a bone chain (squash-and-stretch), and a BLUE ALIEN assembled from
// separate part slots (head, eyes, two-arm piece, two-leg piece, two-antenna piece). Everything else --
// the 5x3 board, the per-symbol win characters, the spin-loop animations, the layered alienBurst VFX, the
// slot grid / flow -- mirrors the proven Kraken pass.

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

// Cubic-bezier easing presets (a kf.set `curve` is the keyframe's OUTGOING segment easing; cx in [0,1],
// cy may exceed 1 for overshoot or go negative for anticipation, so one segment can punch past its end
// value and settle).
type Bezier = { readonly type: 'bezier'; cx1: number; cy1: number; cx2: number; cy2: number };
const EASE_OUT: Bezier = { type: 'bezier', cx1: 0.22, cy1: 1, cx2: 0.36, cy2: 1 };
const EASE_IN: Bezier = { type: 'bezier', cx1: 0.55, cy1: 0, cx2: 0.78, cy2: 0 };
const EASE_IN_OUT: Bezier = { type: 'bezier', cx1: 0.65, cy1: 0, cx2: 0.35, cy2: 1 };
const EASE_OUT_BACK: Bezier = { type: 'bezier', cx1: 0.34, cy1: 1.56, cx2: 0.64, cy2: 1 };

type Curve = 'linear' | 'stepped' | Bezier;
type Vec2 = { x: number; y: number };
type Rgba = { r: number; g: number; b: number; a: number };

// ---- scene geometry (world units, y-down; centered on the frame center at the origin) ----------------
// Reel-frame trimmed native aspect (1252 x 1995) and its transparent window fractions (measured from the
// packed page): the window is centered, spanning x 0.089..0.909 and y 0.102..0.901 of the frame.
const FRAME_H = 1180;
const FRAME_W = FRAME_H * (1252 / 1995);
const WINDOW_W = (0.909 - 0.089) * FRAME_W;
const WINDOW_H = (0.901 - 0.102) * FRAME_H;

// The 5x3 grid: 5 square cells fit the window width; 3 rows are centered vertically on the tall window.
const CELL = 118;
const COL_PITCH = 120;
const ROW_PITCH = 178;
const COLS = [-2, -1, 0, 1, 2].map((i) => i * COL_PITCH);
const ROWS = [-1, 0, 1].map((i) => i * ROW_PITCH);
const GRID_CENTER = { x: 0, y: 0 };

// The two mascots perch atop the frame's upper corners (green left, blue right).
const GREEN_ROOT = { x: -232, y: -628 };
const BLUE_ROOT = { x: 232, y: -628 };

const SCENE = { x: -500, y: -900, w: 1000, h: 1660 };
// A landscape rect on the two mascots (they jump up during their win), widened so neither the green horns
// nor the blue antenna clip at the top of the leap.
const MASCOT_FIT = { x: -500, y: -1015, w: 1000, h: 745 };

// ---- 1. document + atlas -------------------------------------------------------------------------
const { documentId } = (await call('document.new', { name: 'little-aliens' })) as {
  documentId: string;
};
const atlasRef = JSON.parse(readFileSync(join(here, 'atlas', 'atlas-ref.json'), 'utf8'));
// Page files are project-relative for the render tool; the atlas dir holds them.
atlasRef.pages = atlasRef.pages.map((p: { file: string; [key: string]: unknown }) => ({
  ...p,
  file: join('atlas', p.file),
}));
await call('atlas.set', { documentId, atlas: atlasRef });

const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) {
  for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
}
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

// ---- 2. scene skeleton (bg / reel-window panel / frame) ------------------------------------------
const { boneId: root } = (await call('bone.create', { documentId, name: 'root', length: 10 })) as {
  boneId: string;
};

async function regionSlot(
  name: string,
  bone: string,
  region: string,
  x: number,
  y: number,
  size: { width: number; height: number },
  alpha = 1,
  blendMode?: 'normal' | 'additive' | 'multiply' | 'screen',
): Promise<string> {
  const { slotId } = (await call('slot.create', {
    documentId,
    name,
    boneId: bone,
    color: { ...WHITE, a: alpha },
    attachment: region,
  })) as { slotId: string };
  await call('attach.region.add', {
    documentId,
    slotId,
    name: region,
    path: region,
    x,
    y,
    ...size,
  });
  if (blendMode !== undefined) await call('slot.blend', { documentId, slotId, blendMode });
  return slotId;
}

// bg covers the portrait scene (sized by width; height overshoots and crops top/bottom). panel fills the
// frame window as a recessed dark backing. frame is the border with the transparent window.
await regionSlot('bg', root, 'bg', 0, 0, { width: 1020, height: 1020 / (1024 / 1835) });
await regionSlot('panel', root, 'panel', 0, 0, { width: WINDOW_W, height: WINDOW_H });
await regionSlot('frame', root, 'reelframe', 0, 0, sized('reelframe', FRAME_H));
// The frame art carries a light readout panel at the top center; cover its bright interior with the dark
// window panel so it reads as a clean display (a player overlays win text here, like the bottom WIN bar).
await regionSlot('top_display', root, 'panel', 0, -528, { width: 202, height: 90 });

// ---- 3. the 5x3 reel grid ------------------------------------------------------------------------
// The symbol vocabulary (region-backed; the player's scrolling strips look these up by name, so a symbol
// id IS its atlas region). High = 4 distinct aliens, mid = crystal/potion/raygun, low = royals, wild =
// yellow tri-eye. crystal doubles as the scatter role and raygun as the bonus role at the grid layer.
const SYMBOLS = [
  'alien-green-slime',
  'alien-blue-horned',
  'alien-orange-sun',
  'alien-pink-blob',
  'crystal',
  'potion',
  'raygun',
  'royal-a',
  'royal-k',
  'royal-q',
  'royal-j',
  'royal-10',
  'alien-yellow-trieye',
];

// The CRAFTED landing board (Law 1 note: this is the DEMO's fixed board, authored as the setup pose so the
// player reveals it with zero document mutation; a real game gets the board from SpinResult). Trigger
// symbols read left to right for the anticipation beat: scatter (crystal) on reel 1 (r0c0), scatter on
// reel 3 (r1c2) arms the 2-scatter anticipation, the bonus (raygun) on reel 5 (r1c4) is the third trigger.
const LAYOUT: string[][] = [
  ['crystal', 'alien-green-slime', 'royal-j', 'alien-blue-horned', 'crystal'],
  ['potion', 'alien-yellow-trieye', 'crystal', 'royal-10', 'raygun'],
  ['royal-a', 'alien-pink-blob', 'royal-q', 'alien-orange-sun', 'royal-k'],
];

const cellBones: string[][] = [];
const cellSlots: string[][] = [];
for (let r = 0; r < 3; r += 1) {
  cellBones.push([]);
  cellSlots.push([]);
  for (let c = 0; c < 5; c += 1) {
    const symbol = LAYOUT[r]![c]!;
    const { boneId } = (await call('bone.create', {
      documentId,
      parentId: root,
      name: `cell_${r}_${c}`,
      x: COLS[c],
      y: ROWS[r],
      length: 5,
    })) as { boneId: string };
    const { slotId } = (await call('slot.create', {
      documentId,
      name: `sym_${r}_${c}`,
      boneId,
      color: { ...WHITE },
      attachment: symbol,
    })) as { slotId: string };
    // Every cell carries all symbol attachments; the setup active attachment is the crafted symbol, so any
    // tool can re-symbol any cell (kf.attachment.set) even though the player never needs it.
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

// ---- 4. the two per-part rigged mascots ----------------------------------------------------------
// Bone / attachment offsets are LOCAL to each mascot root; they were derived by rendering and looking at
// the composed pieces against the assembled reference art (source-layers/green.png, blue.png).
async function makeBone(
  name: string,
  parent: string,
  x: number,
  y: number,
  length = 10,
): Promise<string> {
  const { boneId } = (await call('bone.create', {
    documentId,
    parentId: parent,
    name,
    x,
    y,
    length,
  })) as { boneId: string };
  return boneId;
}

// GREEN SLIME: root -> body (weighted mesh) with a tip bone for the squash chain; horns ride the tip (so
// they lag), feet hang off the root, eyes ride the tip. The pieces are OVERLAPPING partial-body chunks, not
// isolated parts, so they assemble in REGISTRATION against the green.png reference: green-noface is the ONE
// full-body silhouette (its corner fangs + grumpy mouth match the reference, which green-frown lacks), and
// green-horns is a horns-fused-to-a-head-dome chunk. The horns slot is drawn BEHIND the body (see draw
// order) and its dome is sunk into the head so the body occludes the dome and only the horns read as
// growing from the crown -- no second stacked body. The reference shows blue eyes that no green piece
// provides, so the shared blue eyeball piece is registered onto the face where the reference places them
// (upper third). See the report for the eye deviation.
const GREEN_BODY_H = 280;
const greenRoot = await makeBone('green_root', root, GREEN_ROOT.x, GREEN_ROOT.y);
const greenBody = await makeBone('green_body', greenRoot, 0, 0);
const greenTip = await makeBone('green_tip', greenBody, 0, -GREEN_BODY_H * 0.4, 40);
const greenHornsBone = await makeBone('green_horns', greenTip, 0, -GREEN_BODY_H * 0.085);
const greenFeetBone = await makeBone('green_feet', greenRoot, 0, GREEN_BODY_H * 0.46);
const greenEyesBone = await makeBone('green_eyes', greenTip, 0, GREEN_BODY_H * 0.235);

// Draw order (back to front): horns, feet, body, eyes. Horns are behind the body so the fused head-dome of
// the green-horns chunk is occluded and only the horn tips clear the crown; the height is set so the horn
// span sits just inside the body width (matching the reference) and the dome matches the body head width.
await regionSlot(
  'green_horns_slot',
  greenHornsBone,
  'green-horns',
  0,
  0,
  sized('green-horns', 210),
);
await regionSlot('green_feet_slot', greenFeetBone, 'green-feet', 0, 0, sized('green-feet', 70));
// Body slot: create with the region, then convert it to a grid-filled weighted mesh bound to [body, tip].
const greenBodySize = sized('green-noface', GREEN_BODY_H);
const { slotId: greenBodySlot } = (await call('slot.create', {
  documentId,
  name: 'green_body_slot',
  boneId: greenBody,
  color: { ...WHITE },
  attachment: 'green-noface',
})) as { slotId: string };
await call('attach.region.add', {
  documentId,
  slotId: greenBodySlot,
  name: 'green-noface',
  path: 'green-noface',
  x: 0,
  y: 0,
  ...greenBodySize,
});
const greenMeshInit = regionToMeshInit({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  width: greenBodySize.width,
  height: greenBodySize.height,
  color: WHITE,
});
await call('mesh.generateFromRegion', {
  documentId,
  slotId: greenBodySlot,
  name: 'green-noface',
  ...greenMeshInit,
});
const greenFilled = autoGridFillGeometry(
  {
    uvs: greenMeshInit.uvs,
    triangles: greenMeshInit.triangles,
    hullLength: greenMeshInit.hullLength,
    vertices: greenMeshInit.vertices,
  },
  GREEN_BODY_H / 5,
);
await call('mesh.autoGridFill', {
  documentId,
  slotId: greenBodySlot,
  name: 'green-noface',
  uvs: greenFilled.uvs,
  triangles: greenFilled.triangles,
  hullLength: greenMeshInit.hullLength,
  vertices: greenFilled.vertices,
});
await call('mesh.bindToBones', {
  documentId,
  slotId: greenBodySlot,
  name: 'green-noface',
  boneIds: [greenBody, greenTip],
  weightMode: 'rigidNearest',
});
await call('mesh.autoWeight', { documentId, slotId: greenBodySlot, name: 'green-noface' });
await regionSlot('green_eyes_slot', greenEyesBone, 'blue-eyes', 0, 0, sized('blue-eyes', 84));

// BLUE ALIEN: root -> head (body); eyes / antenna / arms / legs are separate slots on their own child
// bones. Each cut part PNG already contains BOTH mirrored pieces (two eyes / two arms / two legs / two
// antennae) at the correct spacing, so one attachment per part places both pieces. blue-noface is the
// head + neck; the asset set has no blue mouth layer (see the report).
const BLUE_HEAD_H = 300;
const blueRoot = await makeBone('blue_root', root, BLUE_ROOT.x, BLUE_ROOT.y);
const blueHead = await makeBone('blue_head', blueRoot, 0, 0);
const blueEyesBone = await makeBone('blue_eyes', blueHead, 0, -BLUE_HEAD_H * 0.16);
const blueAntennaBone = await makeBone('blue_antenna', blueHead, 0, -BLUE_HEAD_H * 0.44);
const blueArmsBone = await makeBone('blue_arms', blueHead, 0, BLUE_HEAD_H * 0.2);
const blueLegsBone = await makeBone('blue_legs', blueHead, 0, BLUE_HEAD_H * 0.5);

// Draw order (back to front): antenna, arms, legs, head, eyes.
await regionSlot(
  'blue_antenna_slot',
  blueAntennaBone,
  'blue-antenna',
  0,
  0,
  sized('blue-antenna', 96),
);
await regionSlot('blue_arms_slot', blueArmsBone, 'blue-arms', 0, 0, sized('blue-arms', 132));
await regionSlot('blue_legs_slot', blueLegsBone, 'blue-legs', 0, 0, sized('blue-legs', 110));
await regionSlot(
  'blue_head_slot',
  blueHead,
  'blue-noface',
  0,
  0,
  sized('blue-noface', BLUE_HEAD_H),
);
// The eyes slot carries BOTH eye attachments (blue-eyes + blue-eyes-alt) so the idle can swap the glance.
const blueEyesSlot = await regionSlot(
  'blue_eyes_slot',
  blueEyesBone,
  'blue-eyes',
  0,
  0,
  sized('blue-eyes', 84),
);
await call('attach.region.add', {
  documentId,
  slotId: blueEyesSlot,
  name: 'blue-eyes-alt',
  path: 'blue-eyes-alt',
  x: 0,
  y: 0,
  ...sized('blue-eyes-alt', 84),
});

// ---- 5. the bonus green-flash overlay (full-window, additive, alpha 0 at setup) ------------------
const flashSlot = await regionSlot(
  'bonus_flash',
  root,
  'flash',
  0,
  0,
  { width: WINDOW_W * 1.25, height: WINDOW_H * 1.05 },
  0,
  'additive',
);

// ---- 6. animation keying helpers -----------------------------------------------------------------
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

async function attachmentKey(
  animationId: string,
  slotId: string,
  time: number,
  attachment: string | null,
): Promise<void> {
  await call('kf.attachment.set', { documentId, animationId, slotId, time, name: attachment });
}

const gold = (a = 1): Rgba => ({ r: 1, g: 0.85, b: 0.35, a });

// ---- 6a. per-symbol win-character vocabulary -----------------------------------------------------
// spinPop: an alien/gem snaps up past its target (ease-out-back), squashes wide/short, settles, spinning
// a full turn on the way. Applied to the alien-class cells so the whole board reacts.
async function spinPop(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(animationId, 'scale', boneId, 0.28, { x: 1.26, y: 1.26 }, EASE_OUT);
  await boneKey(animationId, 'scale', boneId, 0.44, { x: 1.14, y: 0.9 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.62, { x: 0.96, y: 1.06 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.9, { x: 1, y: 1 });
  await boneKey(animationId, 'rotate', boneId, 0, { angle: 0 }, EASE_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.5, { angle: 360 });
}

// crystalShatter: a crisp shatter-sparkle -- a fast ease-out-back scale pop with a bright two-stage flash.
async function crystalShatter(
  animationId: string,
  boneId: string,
  targetSlot: string,
): Promise<void> {
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(animationId, 'scale', boneId, 0.16, { x: 1.32, y: 1.32 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.36, { x: 0.94, y: 1.08 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.6, { x: 1, y: 1 });
  await colorKey(animationId, targetSlot, 0, WHITE, EASE_OUT);
  await colorKey(animationId, targetSlot, 0.1, { r: 0.8, g: 1, b: 1, a: 1 }, EASE_IN);
  await colorKey(animationId, targetSlot, 0.24, { r: 1, g: 1, b: 1, a: 1 }, EASE_OUT);
  await colorKey(animationId, targetSlot, 0.5, WHITE);
}

// potionBubble: a bubbling shake -- rotation jitter (+-) with a small vertical bob, like it is fizzing.
async function potionBubble(animationId: string, boneId: string): Promise<void> {
  const jitters: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [0.1, 9],
    [0.22, -8],
    [0.34, 6],
    [0.46, -5],
    [0.6, 3],
    [0.8, 0],
  ];
  for (const [t, angle] of jitters) {
    await boneKey(animationId, 'rotate', boneId, t, { angle }, EASE_IN_OUT);
  }
  for (const [t, sy] of [
    [0, 1],
    [0.2, 1.1],
    [0.4, 0.96],
    [0.6, 1.04],
    [0.8, 1],
  ] as const) {
    await boneKey(animationId, 'scale', boneId, t, { x: 2 - sy, y: sy }, EASE_IN_OUT);
  }
}

// raygunRecoil: a recoil kick -- snap up-and-back with a rotation, then settle forward.
async function raygunRecoil(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'translate', boneId, 0, { x: 0, y: 0 }, EASE_OUT_BACK);
  await boneKey(animationId, 'translate', boneId, 0.12, { x: -10, y: -14 }, EASE_IN_OUT);
  await boneKey(animationId, 'translate', boneId, 0.34, { x: 4, y: 5 }, EASE_OUT);
  await boneKey(animationId, 'translate', boneId, 0.6, { x: 0, y: 0 });
  await boneKey(animationId, 'rotate', boneId, 0, { angle: 0 }, EASE_OUT_BACK);
  await boneKey(animationId, 'rotate', boneId, 0.12, { angle: -18 }, EASE_IN_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.4, { angle: 6 }, EASE_OUT);
  await boneKey(animationId, 'rotate', boneId, 0.7, { angle: 0 });
}

// royalPop: a simple, snappy scale pop and settle.
async function royalPop(animationId: string, boneId: string): Promise<void> {
  await boneKey(animationId, 'scale', boneId, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(animationId, 'scale', boneId, 0.2, { x: 1.22, y: 1.22 }, EASE_IN_OUT);
  await boneKey(animationId, 'scale', boneId, 0.5, { x: 1, y: 1 });
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

const HIGH_ALIENS = new Set([
  'alien-green-slime',
  'alien-blue-horned',
  'alien-orange-sun',
  'alien-pink-blob',
]);
const ROYALS = new Set(['royal-a', 'royal-k', 'royal-q', 'royal-j', 'royal-10']);

// ---- 6b. mascot idle / win choreography (keyed into the shared idle / win animations) -------------
// GREEN idle: a slow squash-and-stretch breath on the body chain plus a gentle bob; horns and eyes lag on
// the tip. GREEN win: a big anticipation squash then a stretch jump with horn lag and feet dangle. The
// body MESH also carries a deform wobble (bottom-weighted, so the slime base jiggles).
const greenVertexCount = greenFilled.uvs.length / 2;
function greenWave(amp: number, phase: number): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < greenVertexCount; i += 1) {
    const vx = greenFilled.vertices[i * 2]!;
    const vy = greenFilled.vertices[i * 2 + 1]!;
    const bottomWeight = Math.max(0, (vy + greenBodySize.height / 2) / greenBodySize.height);
    offsets.push(
      Math.sin(vx * 0.05 + phase) * amp * bottomWeight,
      Math.cos(vy * 0.06 + phase) * amp * 0.4 * bottomWeight,
    );
  }
  return offsets;
}

async function greenIdle(animationId: string): Promise<void> {
  // Body squash breath (x/y counter-scale conserves area) + a small vertical bob on the root.
  for (const [t, sx, sy] of [
    [0, 1, 1],
    [1, 1.05, 0.95],
    [2, 0.96, 1.05],
    [3, 1, 1],
  ] as const) {
    await boneKey(animationId, 'scale', greenBody, t, { x: sx, y: sy }, EASE_IN_OUT);
  }
  for (const [t, dy] of [
    [0, 0],
    [1, 6],
    [2, -3],
    [3, 0],
  ] as const) {
    await boneKey(animationId, 'translate', greenRoot, t, { x: 0, y: dy }, EASE_IN_OUT);
  }
  // Horn / eye lag on the tip (a soft sway trailing the body breath).
  for (const [t, angle] of [
    [0, 0],
    [1, -4],
    [2, 5],
    [3, 0],
  ] as const) {
    await boneKey(animationId, 'rotate', greenTip, t, { angle }, EASE_IN_OUT);
  }
  for (const [t, amp, phase] of [
    [0, 0, 0],
    [1, 4, 1.1],
    [2, 3, 2.4],
    [3, 0, 0],
  ] as const) {
    await call('deform.setKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId: greenBodySlot,
      name: 'green-noface',
      time: t,
      offsets: greenWave(amp, phase),
    });
  }
}

async function greenWin(animationId: string, duration: number): Promise<void> {
  // Anticipation squash (gather) -> stretch jump -> land squash -> settle, over the full duration.
  const bodyBeats: ReadonlyArray<readonly [number, number, number, Curve]> = [
    [0, 1, 1, EASE_IN],
    [0.25, 1.22, 0.74, EASE_OUT], // deep anticipation squash
    [0.5, 0.78, 1.28, EASE_IN_OUT], // stretch up into the jump
    [0.85, 1.18, 0.84, EASE_OUT], // landing squash
    [1.2, 0.95, 1.05, EASE_IN_OUT],
    [duration, 1, 1, 'linear'],
  ];
  for (const [t, sx, sy, curve] of bodyBeats) {
    await boneKey(animationId, 'scale', greenBody, t, { x: sx, y: sy }, curve);
  }
  const jump: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_IN],
    [0.25, 26, EASE_OUT], // crouch down before the jump
    [0.5, -70, EASE_IN], // launch up (negative y = up)
    [0.85, 8, EASE_OUT], // land
    [1.2, 0, 'linear'],
    [duration, 0, 'linear'],
  ];
  for (const [t, dy, curve] of jump) {
    await boneKey(animationId, 'translate', greenRoot, t, { x: 0, y: dy }, curve);
  }
  // Horn / eye lag on the tip: whips back on the launch (ease-out-back overshoot) then settles.
  const tipLag: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_IN],
    [0.25, 10, EASE_OUT],
    [0.5, -16, EASE_OUT_BACK],
    [0.85, 12, EASE_IN_OUT],
    [1.3, -5, EASE_IN_OUT],
    [duration, 0, 'linear'],
  ];
  for (const [t, angle, curve] of tipLag) {
    await boneKey(animationId, 'rotate', greenTip, t, { angle }, curve);
  }
  // Feet dangle: swing as the slime leaves the ground and settle on landing.
  const feetDangle: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_IN_OUT],
    [0.4, -14, EASE_OUT],
    [0.6, 16, EASE_IN_OUT],
    [0.9, -8, EASE_OUT],
    [1.3, 3, EASE_IN_OUT],
    [duration, 0, 'linear'],
  ];
  for (const [t, angle, curve] of feetDangle) {
    await boneKey(animationId, 'rotate', greenFeetBone, t, { angle }, curve);
  }
  // A bigger deform thrash on the body mesh through the jump.
  for (const [t, amp, phase] of [
    [0, 0, 0],
    [0.25, 10, 0.8],
    [0.5, 16, 2.0],
    [0.85, 12, 3.2],
    [1.2, 5, 4.0],
    [duration, 0, 0],
  ] as const) {
    await call('deform.setKeyframe', {
      documentId,
      animationId,
      skin: 'default',
      slotId: greenBodySlot,
      name: 'green-noface',
      time: t,
      offsets: greenWave(amp, phase),
    });
  }
}

// BLUE idle: a breathing body scale, an eye blink (a fast vertical squash of the eyes bone plus a glance
// swap to blue-eyes-alt), and antenna sway with overshoot lag. BLUE win: an arm wave and a jump with an
// ease-out-back settle, antenna bounce.
async function blueIdle(animationId: string): Promise<void> {
  for (const [t, s] of [
    [0, 1],
    [1.5, 1.04],
    [3, 1],
  ] as const) {
    await boneKey(animationId, 'scale', blueHead, t, { x: 1, y: s }, EASE_IN_OUT);
  }
  // Eye blink near the loop's midpoint: squash the eyes vertically and swap to the alt glance, then back.
  await boneKey(animationId, 'scale', blueEyesBone, 0, { x: 1, y: 1 }, EASE_IN);
  await boneKey(animationId, 'scale', blueEyesBone, 1.6, { x: 1, y: 1 }, EASE_IN);
  await boneKey(animationId, 'scale', blueEyesBone, 1.72, { x: 1, y: 0.12 }, EASE_OUT);
  await boneKey(animationId, 'scale', blueEyesBone, 1.84, { x: 1, y: 1 }, EASE_OUT);
  await boneKey(animationId, 'scale', blueEyesBone, 3, { x: 1, y: 1 }, 'linear');
  await attachmentKey(animationId, blueEyesSlot, 0, 'blue-eyes');
  await attachmentKey(animationId, blueEyesSlot, 2.3, 'blue-eyes-alt');
  await attachmentKey(animationId, blueEyesSlot, 2.8, 'blue-eyes');
  // Antenna sway with an overshoot lag (leads, overshoots, settles).
  for (const [t, angle, curve] of [
    [0, 0, EASE_IN_OUT],
    [1, 6, EASE_OUT_BACK],
    [2, -6, EASE_OUT_BACK],
    [3, 0, 'linear'],
  ] as const) {
    await boneKey(animationId, 'rotate', blueAntennaBone, t, { angle }, curve);
  }
  // Arms drift a touch so the alien is never fully static.
  for (const [t, angle] of [
    [0, 0],
    [1.5, 4],
    [3, 0],
  ] as const) {
    await boneKey(animationId, 'rotate', blueArmsBone, t, { angle }, EASE_IN_OUT);
  }
}

async function blueWin(animationId: string, duration: number): Promise<void> {
  // Jump with an ease-out-back settle.
  const jump: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_IN],
    [0.2, 20, EASE_OUT], // crouch
    [0.45, -64, EASE_OUT_BACK], // leap up
    [0.8, 6, EASE_OUT],
    [1.2, 0, 'linear'],
    [duration, 0, 'linear'],
  ];
  for (const [t, dy, curve] of jump) {
    await boneKey(animationId, 'translate', blueRoot, t, { x: 0, y: dy }, curve);
  }
  // Body stretch through the leap.
  for (const [t, sy, curve] of [
    [0, 1, EASE_IN],
    [0.2, 0.86, EASE_OUT],
    [0.45, 1.2, EASE_IN_OUT],
    [0.8, 0.92, EASE_OUT],
    [1.2, 1, 'linear'],
    [duration, 1, 'linear'],
  ] as const) {
    await boneKey(animationId, 'scale', blueHead, t, { x: 2 - sy, y: sy }, curve);
  }
  // Arm wave: a big overshoot swing that flutters and settles.
  const arms: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_OUT_BACK],
    [0.3, 26, EASE_IN_OUT],
    [0.6, -20, EASE_OUT_BACK],
    [0.9, 14, EASE_IN_OUT],
    [1.3, -6, EASE_IN_OUT],
    [duration, 0, 'linear'],
  ];
  for (const [t, angle, curve] of arms) {
    await boneKey(animationId, 'rotate', blueArmsBone, t, { angle }, curve);
  }
  // Antenna bounce on the leap.
  const antenna: ReadonlyArray<readonly [number, number, Curve]> = [
    [0, 0, EASE_IN],
    [0.45, -22, EASE_OUT_BACK],
    [0.8, 14, EASE_IN_OUT],
    [1.3, -5, EASE_IN_OUT],
    [duration, 0, 'linear'],
  ];
  for (const [t, angle, curve] of antenna) {
    await boneKey(animationId, 'rotate', blueAntennaBone, t, { angle }, curve);
  }
  // Legs kick out on the jump.
  for (const [t, angle, curve] of [
    [0, 0, EASE_IN],
    [0.45, 14, EASE_OUT],
    [0.8, -6, EASE_IN_OUT],
    [1.2, 0, 'linear'],
    [duration, 0, 'linear'],
  ] as const) {
    await boneKey(animationId, 'rotate', blueLegsBone, t, { angle }, curve);
  }
}

// ---- 7. animations -------------------------------------------------------------------------------
// 'idle' (3s loop): the board shimmers organically (per-cell phase-offset y-bob, sway, subtle scale) and
// both mascots idle in the SAME animation so the player's single idle track drives everything.
const { animationId: idle } = (await call('anim.create', {
  documentId,
  name: 'idle',
  duration: 3,
})) as { animationId: string };
const IDLE_SAMPLES = [0, 0.75, 1.5, 2.25, 3] as const;
const wIdle = (2 * Math.PI) / 3; // one full cycle across the 3s loop
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const b = cellBones[r]![c]!;
    const phase = (r * 5 + c) * 0.7;
    for (const t of IDLE_SAMPLES) {
      const last = t === 3;
      const dy = 2.5 * Math.sin(wIdle * t + phase);
      const sway = 0.8 * Math.sin(wIdle * t + phase + 0.6);
      const scl = 1 + 0.015 * Math.sin(wIdle * t + phase + 1.2);
      await boneKey(idle, 'translate', b, t, { x: 0, y: dy }, last ? 'linear' : EASE_IN_OUT);
      await boneKey(idle, 'rotate', b, t, { angle: sway }, last ? 'linear' : EASE_IN_OUT);
      await boneKey(idle, 'scale', b, t, { x: scl, y: scl }, last ? 'linear' : EASE_IN_OUT);
    }
  }
}
await greenIdle(idle);
await blueIdle(idle);

// 'win_celebration' (2s): every cell reacts with its OWN character, and both mascots celebrate.
const WIN_DURATION = 2;
const { animationId: win } = (await call('anim.create', {
  documentId,
  name: 'win_celebration',
  duration: WIN_DURATION,
})) as { animationId: string };
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const b = cellBones[r]![c]!;
    const s = cellSlots[r]![c]!;
    const symbol = LAYOUT[r]![c]!;
    if (symbol === 'alien-yellow-trieye') {
      await heartbeat(win, b, s);
    } else if (symbol === 'crystal') {
      await crystalShatter(win, b, s);
    } else if (symbol === 'potion') {
      await potionBubble(win, b);
    } else if (symbol === 'raygun') {
      await raygunRecoil(win, b);
    } else if (ROYALS.has(symbol)) {
      await royalPop(win, b);
    } else if (HIGH_ALIENS.has(symbol)) {
      await spinPop(win, b);
    } else {
      await spinPop(win, b);
    }
  }
}
await greenWin(win, WIN_DURATION);
await blueWin(win, WIN_DURATION);

// 'reel_stop_bounce' (0.35s): a downward y overshoot that rebounds and settles, authored over EVERY cell.
// The player plays it on an ADDITIVE track and restarts it at each staggered reel stop.
const { animationId: reelStopBounce } = (await call('anim.create', {
  documentId,
  name: 'reel_stop_bounce',
  duration: 0.35,
})) as { animationId: string };
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const b = cellBones[r]![c]!;
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

// 'anticipation_glow' (1s loop): the two landed scatter (crystal) cells pulse toward cyan-gold and breathe.
const SCATTER_CELLS = [
  { r: 0, c: 0 },
  { r: 1, c: 2 },
] as const;
const TRIGGER_CELLS = [
  { r: 0, c: 0 },
  { r: 1, c: 2 },
  { r: 1, c: 4 },
] as const;
const { animationId: anticipationGlow } = (await call('anim.create', {
  documentId,
  name: 'anticipation_glow',
  duration: 1,
})) as { animationId: string };
for (const { r, c } of SCATTER_CELLS) {
  const b = cellBones[r]![c]!;
  const s = cellSlots[r]![c]!;
  for (const [t, scale] of [
    [0, 1],
    [0.5, 1.14],
    [1, 1],
  ] as const) {
    await boneKey(anticipationGlow, 'scale', b, t, { x: scale, y: scale }, EASE_IN_OUT);
  }
  for (const [t, color] of [
    [0, WHITE],
    [0.5, { r: 0.7, g: 1, b: 0.85, a: 1 }],
    [1, WHITE],
  ] as const) {
    await colorKey(anticipationGlow, s, t, color, EASE_IN_OUT);
  }
}

// 'scatter_land' (0.5s): the three trigger cells pop 1 -> 1.35 -> 1 with a bright two-stage flash.
const { animationId: scatterLand } = (await call('anim.create', {
  documentId,
  name: 'scatter_land',
  duration: 0.5,
})) as { animationId: string };
for (const { r, c } of TRIGGER_CELLS) {
  const b = cellBones[r]![c]!;
  const s = cellSlots[r]![c]!;
  await boneKey(scatterLand, 'scale', b, 0, { x: 1, y: 1 }, EASE_OUT_BACK);
  await boneKey(scatterLand, 'scale', b, 0.2, { x: 1.35, y: 1.35 }, EASE_IN_OUT);
  await boneKey(scatterLand, 'scale', b, 0.5, { x: 1, y: 1 });
  await colorKey(scatterLand, s, 0, WHITE, EASE_OUT);
  await colorKey(scatterLand, s, 0.12, { r: 0.8, g: 1, b: 0.9, a: 1 }, EASE_IN);
  await colorKey(scatterLand, s, 0.24, { r: 0.9, g: 1, b: 0.75, a: 1 }, EASE_OUT);
  await colorKey(scatterLand, s, 0.34, { r: 1, g: 1, b: 0.9, a: 1 }, EASE_IN);
  await colorKey(scatterLand, s, 0.5, WHITE);
}

// 'bonus_intro' (2.5s): NO banner art -- a full-board green energy flash pulses in and out while BOTH
// mascots play their win choreography simultaneously (the player also overlays an HTML 'FREE SPINS!'
// header). The particle energy pulse is composited on top by the player / render step.
const BONUS_DURATION = 2.5;
const { animationId: bonusIntro } = (await call('anim.create', {
  documentId,
  name: 'bonus_intro',
  duration: BONUS_DURATION,
})) as { animationId: string };
// Two green additive flash pulses.
for (const [t, a, curve] of [
  [0, 0, EASE_OUT],
  [0.2, 0.85, EASE_IN],
  [0.65, 0, EASE_OUT],
  [1.05, 0.55, EASE_IN],
  [1.55, 0, 'linear'],
  [BONUS_DURATION, 0, 'linear'],
] as const) {
  await colorKey(bonusIntro, flashSlot, t, { r: 0.45, g: 1, b: 0.55, a }, curve);
}
await greenWin(bonusIntro, BONUS_DURATION);
await blueWin(bonusIntro, BONUS_DURATION);

// ---- 8. effects: dedicated FX atlas + layered alienBurst bundle -----------------------------------
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
  const { layerId } = (await call('effect.layer.add', {
    documentId,
    effectId,
    kind: 'emitter',
    blendMode,
    region: body.texture.region,
  })) as { layerId: string };
  await call('effect.layer.setField', { documentId, effectId, layerId, field: 'body', body });
  for (const field of ['scaleOverLife', 'colorOverLife', 'alphaOverLife'] as const) {
    const stops = curves[field];
    if (stops === undefined) continue;
    await editLifeCurve(effectId, layerId, field, stops);
  }
}

async function editLifeCurve(
  effectId: string,
  layerId: string,
  field: 'scaleOverLife' | 'colorOverLife' | 'alphaOverLife',
  stops: readonly LifeStopDef[],
): Promise<void> {
  const detail = (await call('effect.get', { documentId, effectId })) as {
    effect: {
      layers: Array<{ id: string; curves: Array<{ field: string; stops: Array<{ id: string }> }> }>;
    };
  };
  const layer = detail.effect.layers.find((l) => l.id === layerId)!;
  const curve = layer.curves.find((cu) => cu.field === field)!;
  const [s0, s1] = curve.stops;
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

// Alien palette (kept off pure white so additive layers do not blow out).
const GREEN_RGB: Rgb = { r: 0.4, g: 0.9, b: 0.34 };
const LIME_RGB: Rgb = { r: 0.7, g: 1, b: 0.4 };
const CYAN_RGB: Rgb = { r: 0.34, g: 0.92, b: 0.85 };
const GOO_RGB: Rgb = { r: 0.45, g: 0.85, b: 0.3 };
const GOO_DARK: Rgb = { r: 0.3, g: 0.62, b: 0.22 };

// 'alienBurst': four layered passes (glow flash, arcing goo droplets, star sparks, expanding energy rings),
// tuned by looking at composed renders so it never blows to white.
const { effectId: alienBurst } = (await call('effect.create', {
  documentId,
  name: 'alienBurst',
})) as { effectId: string };
// Layer 1: an additive green glow flash bursting outward and fading (the shockwave core).
await addEmitterLayer(
  alienBurst,
  'additive',
  {
    type: 'emitter',
    name: 'glow',
    maxParticles: 40,
    spawn: { mode: 'burst', count: 12, atTime: 0 },
    shape: { kind: 'circle', radius: 8, edgeOnly: false },
    lifetime: { min: 0.5, max: 0.75 },
    startSpeed: { min: 180, max: 440 },
    emissionAngle: { min: 0, max: 360 },
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: 0, max: 0 },
    startScale: { min: 0.8, max: 1.2 },
    gravity: { x: 0, y: 30 },
    acceleration: { x: 0, y: 0 },
    drag: 1.6,
    texture: { kind: 'static', region: 'glow' },
    trail: null,
  },
  {
    scaleOverLife: [
      { t: 0, value: 0.4, curve: EASE_OUT },
      { t: 1, value: 1.5 },
    ],
    colorOverLife: [
      { t: 0, value: LIME_RGB },
      { t: 1, value: GREEN_RGB },
    ],
    alphaOverLife: [
      { t: 0, value: 0.65, curve: EASE_OUT },
      { t: 1, value: 0 },
    ],
  },
);
// Layer 2 (normal blend): green goo droplets launched outward-up, arcing DOWN under gravity, shrinking.
await addEmitterLayer(
  alienBurst,
  'normal',
  {
    type: 'emitter',
    name: 'goo',
    maxParticles: 70,
    spawn: { mode: 'burst', count: 26, atTime: 0 },
    shape: { kind: 'circle', radius: 20, edgeOnly: false },
    lifetime: { min: 0.9, max: 1.5 },
    startSpeed: { min: 220, max: 520 },
    emissionAngle: { min: 200, max: 340 }, // up-and-out (270 = straight up in y-down)
    startRotation: { min: -30, max: 30 },
    angularVelocity: { min: -90, max: 90 },
    startScale: { min: 0.35, max: 0.8 },
    gravity: { x: 0, y: 620 }, // heavy pull down so droplets arc
    acceleration: { x: 0, y: 0 },
    drag: 0.2,
    texture: { kind: 'static', region: 'goo' },
    trail: null,
  },
  {
    scaleOverLife: [
      { t: 0, value: 1, curve: EASE_OUT },
      { t: 0.7, value: 0.9 },
      { t: 1, value: 0.2 },
    ],
    colorOverLife: [
      { t: 0, value: GOO_RGB },
      { t: 1, value: GOO_DARK },
    ],
    alphaOverLife: [
      { t: 0, value: 0, curve: EASE_OUT },
      { t: 0.12, value: 1 },
      { t: 0.75, value: 1 },
      { t: 1, value: 0 },
    ],
  },
);
// Layer 3 (additive): cyan-white star sparks spinning outward, arcing down, shrinking to nothing.
await addEmitterLayer(
  alienBurst,
  'additive',
  {
    type: 'emitter',
    name: 'sparks',
    maxParticles: 80,
    spawn: { mode: 'burst', count: 32, atTime: 0 },
    shape: { kind: 'circle', radius: 6, edgeOnly: false },
    lifetime: { min: 0.8, max: 1.3 },
    startSpeed: { min: 260, max: 660 },
    emissionAngle: { min: 0, max: 360 },
    startRotation: { min: 0, max: 360 },
    angularVelocity: { min: -240, max: 240 },
    startScale: { min: 0.2, max: 0.46 },
    gravity: { x: 0, y: 220 },
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
      { t: 0, value: { r: 0.85, g: 1, b: 0.95 } },
      { t: 1, value: CYAN_RGB },
    ],
    alphaOverLife: [
      { t: 0, value: 1 },
      { t: 0.72, value: 1 },
      { t: 1, value: 0 },
    ],
  },
);
// Layer 4 (additive): a few expanding energy-pulse rings (shockwaves).
await addEmitterLayer(
  alienBurst,
  'additive',
  {
    type: 'emitter',
    name: 'rings',
    maxParticles: 8,
    spawn: { mode: 'burst', count: 3, atTime: 0 },
    shape: { kind: 'point' },
    lifetime: { min: 0.6, max: 0.85 },
    startSpeed: { min: 0, max: 0 },
    emissionAngle: { min: 0, max: 0 },
    startRotation: { min: 0, max: 0 },
    angularVelocity: { min: 0, max: 0 },
    startScale: { min: 0.6, max: 0.9 },
    gravity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    drag: 0,
    texture: { kind: 'static', region: 'ring' },
    trail: null,
  },
  {
    scaleOverLife: [
      { t: 0, value: 0.6, curve: EASE_OUT },
      { t: 1, value: 4.4 },
    ],
    colorOverLife: [
      { t: 0, value: CYAN_RGB },
      { t: 1, value: GREEN_RGB },
    ],
    alphaOverLife: [
      { t: 0, value: 0.7, curve: EASE_OUT },
      { t: 1, value: 0 },
    ],
  },
);

// 'gooFountain': a wide rain of goo droplets launched up along a line across the grid width, arcing back
// down over the whole board (the alien-themed "curtain").
const { effectId: gooFountain } = (await call('effect.create', {
  documentId,
  name: 'gooFountain',
})) as { effectId: string };
await addEmitterLayer(
  gooFountain,
  'normal',
  {
    type: 'emitter',
    name: 'rain',
    maxParticles: 90,
    spawn: { mode: 'rate', particlesPerSecond: 46 },
    shape: { kind: 'line', x1: -300, y1: 40, x2: 300, y2: 40 },
    lifetime: { min: 1.4, max: 2.2 },
    startSpeed: { min: 260, max: 460 },
    emissionAngle: { min: 250, max: 290 },
    startRotation: { min: -20, max: 20 },
    angularVelocity: { min: -70, max: 70 },
    startScale: { min: 0.3, max: 0.7 },
    gravity: { x: 0, y: 520 },
    acceleration: { x: 0, y: 0 },
    drag: 0.15,
    texture: { kind: 'static', region: 'goo' },
    trail: null,
  },
  {
    colorOverLife: [
      { t: 0, value: GOO_RGB },
      { t: 1, value: GOO_DARK },
    ],
    alphaOverLife: [
      { t: 0, value: 0, curve: EASE_OUT },
      { t: 0.12, value: 1 },
      { t: 0.8, value: 1 },
      { t: 1, value: 0 },
    ],
  },
);

// The alien mega-celebration bundle: a gooFountain over the board, an alienBurst at grid center, and a
// second seed-varied alienBurst a beat later.
await call('bundle.create', { documentId, name: 'alienCelebration' });
await call('bundle.item.add', {
  documentId,
  name: 'alienCelebration',
  item: { effect: gooFountain, startOffset: 0, anchorRole: 'gridCenter', seedSalt: 3 },
});
await call('bundle.item.add', {
  documentId,
  name: 'alienCelebration',
  item: { effect: alienBurst, startOffset: 0, anchorRole: 'gridCenter', seedSalt: 13 },
});
await call('bundle.item.add', {
  documentId,
  name: 'alienCelebration',
  item: { effect: alienBurst, startOffset: 0.28, anchorRole: 'gridCenter', seedSalt: 29 },
});

// ---- 9. slot composition -------------------------------------------------------------------------
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
      skeletonRef: 'little-aliens',
      idle: 'idle',
      land: 'reel_stop_bounce',
      win: 'win_celebration',
      anticipation: 'anticipation_glow',
    },
    skeletonAnimationNames: ANIMATION_NAMES,
  });
}
await call('slot.winseq.create', { documentId, name: 'alienWinSequence' });

// The 5x3 reel grid: 280ms stop stagger (left to right) and an anticipation config armed once two scatter
// (crystal) symbols have landed, anticipating at most the two remaining reels. The board itself is never
// authored here (Law 1): counts come from SpinResult at runtime.
await call('slot.grid.set', {
  documentId,
  grid: {
    topology: 'reelStrip',
    cols: 5,
    rows: 3,
    cellWidth: CELL,
    cellHeight: CELL,
    cellGap: COL_PITCH - CELL,
    reelStopStaggerMs: 280,
    gravity: 'column-down',
    anticipation: {
      triggerSymbols: ['crystal'],
      thresholdCount: 2,
      maxAnticipatingCols: 2,
    },
  },
});

// The feature flow: base -> freeSpins when the trigger feature reports three trigger symbols (the two
// scatters plus the bonus). Authoring data only (Law 1); the runtime walks it against SpinResult.
await call('slot.flow.createState', { documentId, name: 'freeSpins' });
await call('slot.flow.addTransition', {
  documentId,
  transition: {
    from: 'base',
    on: { type: 'scatterTrigger', dataEquals: { field: 'count', equals: 3 } },
    to: 'freeSpins',
  },
});

// ---- 10. save + render ---------------------------------------------------------------------------
await call('document.save', { documentId, path: 'little-aliens.rig.json' });

const effectsDocument = exportEffects(deps.sessions.get(documentId).document.effects);
writeFileSync(
  join(here, 'little-aliens.effects.json'),
  `${JSON.stringify(effectsDocument, null, 2)}\n`,
);

mkdirSync(join(here, 'renders'), { recursive: true });
async function render(file: string, opts: Record<string, unknown>): Promise<void> {
  const result = (await call('render_frame', {
    documentId,
    width: 900,
    height: 1494,
    fit: SCENE,
    ...opts,
  })) as { pngBase64: string; bytes: number; placeholders: number };
  writeFileSync(join(here, 'renders', file), Buffer.from(result.pngBase64, 'base64'));
  console.log(`rendered ${file} (${result.bytes} bytes, placeholders=${result.placeholders})`);
}
await render('01-setup.png', {});
await render('02-idle.png', { animation: 'idle', time: 1.5 });
await render('03-win-peak.png', { animation: 'win_celebration', time: 0.5 });
await render('04-mascot-win.png', {
  animation: 'win_celebration',
  time: 0.5,
  fit: MASCOT_FIT,
  width: 1120,
  height: 754,
});
await render('05-composed-bigwin.png', {
  animation: 'win_celebration',
  time: 0.5,
  effect: { bundle: 'alienCelebration', seed: 1, time: 0.5, anchors: { gridCenter: GRID_CENTER } },
});
await render('06-bonus-intro.png', {
  animation: 'bonus_intro',
  time: 0.22,
  effect: { bundle: 'alienCelebration', seed: 7, time: 0.6, anchors: { gridCenter: GRID_CENTER } },
});

const validation = await call('document.validate', { documentId });
console.log('validate:', JSON.stringify(validation));
console.log('DONE: little-aliens authored end to end over the MCP tool surface.');
