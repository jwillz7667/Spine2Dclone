import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// LUNA rig + animation authoring (sleek black cat, amber goggles, calm inventor). Every mutation goes
// through the literal MCP tool handlers (Law 2: commands on the live History), the same surface an
// external AI speaks over stdio. The rig faces LEFT. World units are pixels, y-down, root at the
// ground under the torso center. Placement numbers were art-directed by running this script and
// inspecting renders/luna-*.png against source-sheets/luna-ref.png.
//
// BODY (gen-luna-body.mts pieces; all face LEFT in the raw art, so nothing is mirrored):
// - torso is a HORIZONTAL side-view mass (1183x701): white chest patch at the left, haunch bulge
//   at the right. No rotation (the old vertical mannequin cut needed -90; this piece does not).
// - the four legs hang straight with the paws at the bottom, toes pointing LEFT; the front pieces
//   have an un-outlined open cut at the top that must stay buried inside the torso silhouette.
// - tail is cut with the thick base at the BOTTOM-LEFT, arcing up and to the right; the tail bone
//   pins the alpha-measured base centroid (piece (132, 721) of 688x799).
//
// HEAD (gen-luna-heads.mts): the mouth states are FULL REPLACEMENT HEADS with the ears and the
// aviator goggles BAKED IN (the old separate ear/goggle pieces and the fringed gray mouth plates
// are gone). Each variant is nose/cheek-registered by that script against the canonical anchor
// (head-local nose (-29.1, -45.2), cheek row 151.3 display px), so the skull does not move a pixel
// when the head slot swaps attachments. HEAD_DX/DY below re-seat that shared anchor on the new
// body (the same delta on every variant keeps the registration intact).
//
// Leg pivots are alpha-measured into the torso art through its display transform: front pivots sit
// above the rising chest underline (bottom edge world -91 at x -40, -108 at x -72) with the open
// cut edges 22-25 px inside; back pivots sit at the drawn thigh-cap centers so hip rotation never
// opens the hip. Torso rotations across the animation set stay within 6 deg (walk 1.5, run 5,
// crank 5, tie-knot 4, point 3), under the burial depth, so no leg counter-rotation keys are needed.
//
// Usage: tsx author-luna.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const deps: ToolDeps = { sessions: new SessionRegistry(), files: createNodeFileStore(root) };
const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = byName.get(name);
  if (tool === undefined) throw new Error(`no such tool: ${name}`);
  try {
    return (await tool.handler(deps, input)) as Record<string, unknown>;
  } catch (error) {
    console.error(`TOOL FAILED ${name}: ${(error as Error).message}`);
    throw error;
  }
}

type Bezier = { readonly type: 'bezier'; cx1: number; cy1: number; cx2: number; cy2: number };
const EASE_OUT: Bezier = { type: 'bezier', cx1: 0.22, cy1: 1, cx2: 0.36, cy2: 1 };
const EASE_IN: Bezier = { type: 'bezier', cx1: 0.55, cy1: 0, cx2: 0.78, cy2: 0 };
const EASE_IN_OUT: Bezier = { type: 'bezier', cx1: 0.65, cy1: 0, cx2: 0.35, cy2: 1 };
const EASE_OUT_BACK: Bezier = { type: 'bezier', cx1: 0.34, cy1: 1.56, cx2: 0.64, cy2: 1 };
type Curve = 'linear' | 'stepped' | Bezier;

// ---- atlas ---------------------------------------------------------------------------------------
const atlasRef = JSON.parse(readFileSync(join(root, 'atlas', 'luna', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ regions: Array<{ name: string; w: number; h: number }> }>;
};
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

const { documentId } = (await call('document.new', { name: 'luna' })) as { documentId: string };
// atlas-ref page files are relative to atlas/luna/; the FileStore root is demo/gunner, so prefix.
const atlasForSet = JSON.parse(readFileSync(join(root, 'atlas', 'luna', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ file: string }>;
};
for (const page of atlasForSet.pages) {
  if (!page.file.startsWith('atlas/')) page.file = `atlas/luna/${page.file}`;
}
await call('atlas.set', { documentId, atlas: atlasForSet });

// ---- bones ---------------------------------------------------------------------------------------
// Luna stands ~300 px tall at the skull, ~350 at the ear tips. Ground = y 0 at the root. Facing LEFT.
const bone = async (
  name: string,
  parentId: string | null,
  x: number,
  y: number,
  length = 40,
  rotation = 0,
): Promise<string> => {
  const res = (await call('bone.create', {
    documentId,
    name,
    ...(parentId !== null ? { parentId } : {}),
    x,
    y,
    length,
    rotation,
  })) as { boneId: string };
  return res.boneId;
};

const rootBone = await bone('root', null, 0, 0, 10);
const torso = await bone('torso', rootBone, 0, -140, 100);
const head = await bone('head', torso, -72, -40, 60);
// no ear bones and no goggles slot: ears and goggles are BAKED into the generated head variants
// (user direction, same as Gunner: separate pieces never sat right on the skull)
const tail = await bone('tail', torso, 88, -28, 80);
// Legs are TORSO children so the shoulder/hip sockets can never separate from the body. Each
// pivot is pinned inside the new torso silhouette (world spans x -97.6..101.6, y -207..-89;
// the chest underline rises toward the front: bottom edge world -91 at x -40, -108 at x -72):
// - leg-front-near at world (-40,-104): 13 px above the local underline, open cut edge 21.6 px
//   above the pivot (it raises to 60 deg in point and cranks a full circle, matching the old rig's
//   tuck keys).
// - leg-front-far at world (-72,-110): the shaft emerges below the rising chest underline like the
//   reference; only the un-outlined top cut (25 px above the pivot, world -135) must stay buried,
//   and the torso covers y -195..-108 at that column.
// - leg-back-near at world (62,-139): the pivot sits at the CENTER of the drawn thigh cap
//   (alpha-measured piece centroid (216, 220) of 432x903), so rotation never opens the hip.
//   Setup lean +4 keeps the hock flush with the rump outline like the reference.
// - leg-back-far at world (50,-139) with setup lean +18 so the shin strides forward while the
//   thigh bulk hides behind the belly and the near thigh. Its walk/run keys subtract the lean so
//   world gait angles stay as designed (rotate keys add to setup rotation).
const legFrontNear = await bone('leg-front-near', torso, -40, 36, 80);
const legFrontFar = await bone('leg-front-far', torso, -72, 30, 78);
const legBackNear = await bone('leg-back-near', torso, 62, 1, 82, 4);
const legBackFar = await bone('leg-back-far', torso, 50, 1, 80, 18);

// ---- slots + attachments (created back-to-front; creation order = draw order) ---------------------
interface SlotSpec {
  readonly slot: string;
  readonly boneId: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly targetH: number;
  readonly scaleX?: number;
  readonly rotation?: number;
}

const slotIds = new Map<string, string>();
async function regionSlot(spec: SlotSpec): Promise<string> {
  const { slotId } = (await call('slot.create', {
    documentId,
    name: spec.slot,
    boneId: spec.boneId,
  })) as { slotId: string };
  await call('attach.region.add', {
    documentId,
    slotId,
    name: spec.region,
    path: spec.region,
    x: spec.x,
    y: spec.y,
    ...(spec.rotation !== undefined ? { rotation: spec.rotation } : {}),
    ...(spec.scaleX !== undefined ? { scaleX: spec.scaleX } : {}),
    ...sized(spec.region, spec.targetH),
  });
  await call('slot.activeAttachment', { documentId, slotId, attachment: spec.region });
  slotIds.set(spec.slot, slotId);
  return slotId;
}

// The four gen-luna-heads.mts registration outputs (nose-pinned to head-local (-29.1, -45.2)),
// plus one shared composition delta that seats the new symmetric front face on the new body (the
// old anchor came from the off-center muzzle plate; applying the SAME delta to every variant
// preserves the cross-variant registration, so the skull stays pixel-still on mouth swaps).
const HEAD_DX = 28;
const HEAD_DY = -10;
const HEAD_VARIANTS: ReadonlyArray<{ region: string; x: number; y: number; targetH: number }> = [
  { region: 'head', x: -29.1, y: -81.7, targetH: 170.7 },
  { region: 'head-talk', x: -28.9, y: -81.8, targetH: 170.3 },
  { region: 'head-smile', x: -29.1, y: -80.7, targetH: 166.6 },
  { region: 'head-oo', x: -30.4, y: -81.1, targetH: 169.8 },
];
const headAt = (i: number): { x: number; y: number; targetH: number } => ({
  x: HEAD_VARIANTS[i]!.x + HEAD_DX,
  y: HEAD_VARIANTS[i]!.y + HEAD_DY,
  targetH: HEAD_VARIANTS[i]!.targetH,
});

// back-to-front: far legs, tail, NEAR LEGS, then torso (leg tops and thigh caps hide under the
// torso silhouette), then the head stack. Front-leg attachments pin the pivot at piece (140, 150)
// (the shaft's top center, inside the open cut); back-leg attachments pin the pivot at the thigh
// cap centroid; every targetH lands the paw bottom on the ground (y 0) from its pivot height.
await regionSlot({ slot: 'leg-front-far', boneId: legFrontFar, region: 'leg-front-far', x: 2, y: 44, targetH: 134 });
await regionSlot({ slot: 'leg-back-far', boneId: legBackFar, region: 'leg-back-far', x: 6, y: 46.6, targetH: 182 });
await regionSlot({ slot: 'tail', boneId: tail, region: 'tail', x: 46.4, y: -70.4, targetH: 175 });
await regionSlot({ slot: 'leg-front-near', boneId: legFrontNear, region: 'leg-front-near', x: 2, y: 41.5, targetH: 126 });
await regionSlot({ slot: 'leg-back-near', boneId: legBackNear, region: 'leg-back-near', x: 0, y: 46.7, targetH: 182 });
await regionSlot({ slot: 'torso', boneId: torso, region: 'torso', x: 2, y: -8, targetH: 118 });
await regionSlot({ slot: 'head', boneId: head, region: 'head', ...headAt(0) });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -1, y: -80, targetH: 48 });

// extra attachment variants on the eye / head slots (player and animations swap them)
async function addVariant(slot: string, region: string, targetH: number, x: number, y: number): Promise<void> {
  await call('attach.region.add', {
    documentId,
    slotId: slotIds.get(slot),
    name: region,
    path: region,
    x,
    y,
    ...sized(region, targetH),
  });
}
// lid strips line up with the open eyes (same art as before, recentered on the new face: the
// blank eye band sits between the goggles and the muzzle, centered over the nose)
await addVariant('eyes', 'eyes-half', 44, -1, -81);
await addVariant('eyes', 'eyes-closed', 19, -1, -76);
for (let i = 1; i < HEAD_VARIANTS.length; i += 1) {
  const t = headAt(i);
  await addVariant('head', HEAD_VARIANTS[i]!.region, t.targetH, t.x, t.y);
}

// restore the default active attachments after variant adds
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('eyes'), attachment: 'eyes-open' });
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('head'), attachment: 'head' });

// ---- animation helpers -----------------------------------------------------------------------------
const boneIdByName: Record<string, string> = {
  root: rootBone, torso, head, tail,
  'leg-front-near': legFrontNear, 'leg-front-far': legFrontFar,
  'leg-back-near': legBackNear, 'leg-back-far': legBackFar,
};

type RotKey = readonly [time: number, angle: number, curve?: Curve];
type VecKey = readonly [time: number, x: number, y: number, curve?: Curve];
interface AnimSpec {
  readonly name: string;
  readonly duration: number;
  readonly rotate?: Record<string, readonly RotKey[]>;
  readonly translate?: Record<string, readonly VecKey[]>;
  readonly scale?: Record<string, readonly VecKey[]>;
  readonly attachments?: Record<string, ReadonlyArray<readonly [time: number, name: string | null]>>;
}

async function author(spec: AnimSpec): Promise<string> {
  const { animationId } = (await call('anim.create', {
    documentId,
    name: spec.name,
    duration: spec.duration,
  })) as { animationId: string };
  for (const [boneName, keys] of Object.entries(spec.rotate ?? {})) {
    for (const [time, angle, curve] of keys) {
      await call('kf.set', {
        documentId, animationId, channel: 'rotate', boneId: boneIdByName[boneName], time,
        value: { angle }, ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [boneName, keys] of Object.entries(spec.translate ?? {})) {
    for (const [time, x, y, curve] of keys) {
      await call('kf.set', {
        documentId, animationId, channel: 'translate', boneId: boneIdByName[boneName], time,
        value: { x, y }, ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [boneName, keys] of Object.entries(spec.scale ?? {})) {
    for (const [time, x, y, curve] of keys) {
      await call('kf.set', {
        documentId, animationId, channel: 'scale', boneId: boneIdByName[boneName], time,
        value: { x, y }, ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [slotName, keys] of Object.entries(spec.attachments ?? {})) {
    for (const [time, name] of keys) {
      await call('kf.attachment.set', {
        documentId, animationId, slotId: slotIds.get(slotName), time, name,
      });
    }
  }
  return animationId;
}

// ---- the animation set -------------------------------------------------------------------------------
// Rotation sign: positive = clockwise on screen (y-down). Facing left: for a hanging leg, positive
// swings the paw FORWARD (screen-left); positive torso rotation pitches the chest down toward the nose.

// Translate keys are DELTAS from the setup pose (engine semantic); never key absolute positions.
await author({
  name: 'idle', duration: 2.4,
  translate: { torso: [[0, 0, 0, EASE_IN_OUT], [1.2, 0, -4, EASE_IN_OUT], [2.4, 0, 0]] },
  rotate: {
    tail: [[0, 0, EASE_IN_OUT], [0.9, 14, EASE_IN_OUT], [1.7, -6, EASE_IN_OUT], [2.4, 0]],
    head: [[0, 0, EASE_IN_OUT], [1.2, 1.5, EASE_IN_OUT], [2.4, 0]],
  },
});

await author({
  name: 'walk', duration: 0.9,
  rotate: {
    // elegant gait: 2-3 deg calmer than Gunner's 18/16 walk swings. Back-leg keys subtract the
    // setup leans (+4 near, +18 far) so the WORLD swings stay -13..15 / 15..-13 as designed.
    'leg-front-near': [[0, 16, EASE_IN_OUT], [0.45, -14, EASE_IN_OUT], [0.9, 16]],
    'leg-front-far': [[0, -14, EASE_IN_OUT], [0.45, 16, EASE_IN_OUT], [0.9, -14]],
    'leg-back-near': [[0, -17, EASE_IN_OUT], [0.45, 11, EASE_IN_OUT], [0.9, -17]],
    'leg-back-far': [[0, -3, EASE_IN_OUT], [0.45, -31, EASE_IN_OUT], [0.9, -3]],
    torso: [[0, 1.5, EASE_IN_OUT], [0.45, -1.5, EASE_IN_OUT], [0.9, 1.5]],
    head: [[0, -1.5, EASE_IN_OUT], [0.45, 1.5, EASE_IN_OUT], [0.9, -1.5]],
    tail: [[0, 6, EASE_IN_OUT], [0.45, -6, EASE_IN_OUT], [0.9, 6]],
  },
  translate: {
    torso: [[0, 0, 0, EASE_OUT], [0.225, 0, -4, EASE_IN], [0.45, 0, 0, EASE_OUT], [0.675, 0, -4, EASE_IN], [0.9, 0, 0]],
  },
});

await author({
  name: 'run', duration: 0.55,
  rotate: {
    // calmer than the old +-30: 2-3 deg under Gunner's 28/25 run swings. Back-leg keys subtract
    // the setup leans (+4 near, +18 far); world swings stay -22..21 / -17..16.
    'leg-front-near': [[0, 25, EASE_IN_OUT], [0.275, -22, EASE_IN_OUT], [0.55, 25]],
    'leg-front-far': [[0, 20, EASE_IN_OUT], [0.3, -18, EASE_IN_OUT], [0.55, 20]],
    'leg-back-near': [[0, -26, EASE_IN_OUT], [0.275, 17, EASE_IN_OUT], [0.55, -26]],
    'leg-back-far': [[0, -35, EASE_IN_OUT], [0.3, -2, EASE_IN_OUT], [0.55, -35]],
    torso: [[0, 5, EASE_IN_OUT], [0.275, -2, EASE_IN_OUT], [0.55, 5]],
    head: [[0, -4, EASE_IN_OUT], [0.275, 1, EASE_IN_OUT], [0.55, -4]],
    // streams behind: lifted (-20 raises the tip on this rig) with a small wave
    tail: [[0, -20, EASE_IN_OUT], [0.275, -25, EASE_IN_OUT], [0.55, -20]],
  },
  translate: {
    torso: [[0, 0, 4, EASE_OUT], [0.275, 0, -10, EASE_IN], [0.55, 0, 4]],
  },
});

await author({
  name: 'talk', duration: 1.2,
  rotate: {
    head: [[0, 0, EASE_IN_OUT], [0.3, 2.5, EASE_IN_OUT], [0.6, -2, EASE_IN_OUT], [0.9, 1.5, EASE_IN_OUT], [1.2, 0]],
    tail: [[0, 0, EASE_IN_OUT], [0.6, -8, EASE_IN_OUT], [1.2, 0]],
  },
  translate: { torso: [[0, 0, 0, EASE_IN_OUT], [0.6, 0, -2, EASE_IN_OUT], [1.2, 0, 0]] },
});

await author({
  name: 'crank-gadget', duration: 0.8,
  rotate: {
    // full circular crank at the shoulder; 360 == 0 so the loop is seamless.
    // The 5 deg torso lean is under the 6 deg counter-rotation threshold: the three bracing
    // paws ride the body within the pivot burial depth and still read as planted.
    'leg-front-near': [[0, 0, 'linear'], [0.2, 90, 'linear'], [0.4, 180, 'linear'], [0.6, 270, 'linear'], [0.8, 360]],
    torso: [[0, 5]],
    head: [[0, 9]],
  },
  translate: {
    torso: [[0, -6, 3]],
    // shoulder lift synced to the crank: past 90 deg the piece's cut proximal edge would drop
    // below the belly outline; tucking the pivot up to 17 px keeps the cut inside the silhouette
    'leg-front-near': [[0, 0, 0, 'linear'], [0.2, 0, -10, 'linear'], [0.4, 0, -17, 'linear'],
                       [0.6, 0, -10, 'linear'], [0.8, 0, 0]],
  },
});

await author({
  name: 'tie-knot', duration: 1.0,
  rotate: {
    'leg-front-near': [[0, 0, EASE_OUT], [0.1, 30, 'linear'], [0.2, -30, 'linear'], [0.3, 30, 'linear'],
                       [0.4, -30, 'linear'], [0.5, 30, 'linear'], [0.6, -30, EASE_OUT], [0.78, 0]],
    'leg-front-far': [[0, 0, EASE_OUT], [0.1, -30, 'linear'], [0.2, 30, 'linear'], [0.3, -30, 'linear'],
                      [0.4, 30, 'linear'], [0.5, -30, 'linear'], [0.6, 30, EASE_OUT], [0.78, 0]],
    torso: [[0, 0, EASE_OUT], [0.1, 4, EASE_IN_OUT], [0.6, 4, EASE_IN_OUT], [0.85, 0]],
    head: [[0, 5, EASE_IN_OUT], [0.6, 5, EASE_IN_OUT], [0.75, 0, EASE_IN_OUT], [0.88, 8, EASE_IN_OUT], [1.0, 0]],
  },
});

await author({
  name: 'point', duration: 0.8,
  rotate: {
    // raises the near paw forward and HOLDS (one-shot, no return key). 60 deg, not 80: with the
    // pivot burial the proximal edge stays inside the narrow chest at full raise.
    'leg-front-near': [[0, 0, EASE_OUT_BACK], [0.35, 60], [0.8, 60]],
    head: [[0, 0, EASE_OUT], [0.3, -5], [0.8, -5]],
    torso: [[0, 0, EASE_OUT], [0.35, -3], [0.8, -3]],
  },
  translate: {
    torso: [[0, 0, 0, EASE_OUT], [0.35, 4, -1], [0.8, 4, -1]],
    // small shoulder lift with the raise: keeps the rotated cut edge's rear corner above the
    // waist outline at the 60 deg hold (and through the ease-out-back overshoot)
    'leg-front-near': [[0, 0, 0, EASE_OUT], [0.35, 0, -6], [0.8, 0, -6]],
  },
});

// micro state animations for the player's face tracks (one attachment key each).
// Lip-sync micros keep their historical names (the player's MOUTH_MAP references them) but now
// swap the whole head, whose mouth is drawn into the muzzle (same pattern as author-gunner.mts).
const face = async (name: string, slot: string, region: string): Promise<void> => {
  await author({ name, duration: 0.05, attachments: { [slot]: [[0, region]] } });
};
await face('mouth-closed', 'head', 'head');
await face('mouth-small', 'head', 'head-talk');
await face('mouth-smile', 'head', 'head-smile');
await face('mouth-oo', 'head', 'head-oo');
await face('eyes-open', 'eyes', 'eyes-open');
await face('eyes-half', 'eyes', 'eyes-half');
await face('eyes-closed', 'eyes', 'eyes-closed');
await author({
  name: 'blink', duration: 0.3,
  attachments: { eyes: [[0, 'eyes-open'], [0.1, 'eyes-closed'], [0.22, 'eyes-open']] },
});

// ---- save + QA renders -------------------------------------------------------------------------------
await call('document.save', { documentId, path: 'rigs/luna.rig.json' });
const { ok } = (await call('document.validate', { documentId })) as { ok: boolean };
console.log(`document.validate: ${ok}`);

mkdirSync(join(root, 'renders'), { recursive: true });
type Fit = 'content' | { x: number; y: number; w: number; h: number };
async function render(name: string, animation?: string, time?: number, fit?: Fit): Promise<void> {
  const res = (await call('render_frame', {
    documentId,
    ...(animation !== undefined ? { animation, time } : {}),
    width: 512,
    height: 512,
    fit: fit ?? 'content',
    background: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  })) as { pngBase64: string };
  writeFileSync(join(root, 'renders', `${name}.png`), Buffer.from(res.pngBase64, 'base64'));
  console.log(`rendered renders/${name}.png`);
}
await render('luna-setup');
await render('luna-idle', 'idle', 1.2);
await render('luna-walk', 'walk', 0.22);
await render('luna-run', 'run', 0.14);
await render('luna-point', 'point', 0.7);
await render('luna-crank', 'crank-gadget', 0.4);
await render('luna-tie', 'tie-knot', 0.3);
await render('luna-blink', 'blink', 0.15);
await render('luna-smile', 'mouth-smile', 0.02);
// head-variant registration probes: swap the head slot's active attachment in-memory (AFTER the
// save, so the rig file keeps 'head') and photograph the same fixed head rect; the skull, ears
// and goggles must be pixel-still across all four while only the mouth changes.
const HEAD_RECT: Fit = { x: -175, y: -390, w: 230, h: 250 };
for (const v of ['head', 'head-talk', 'head-smile', 'head-oo'] as const) {
  await call('slot.activeAttachment', { documentId, slotId: slotIds.get('head'), attachment: v });
  await render(`luna-head-${v}`, undefined, undefined, HEAD_RECT);
}
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('head'), attachment: 'head' });
console.log('LUNA authored.');
