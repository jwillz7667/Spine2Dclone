import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// PIP rig + animation authoring (small sky-blue scout pigeon). Every mutation goes through the
// literal MCP tool handlers (Law 2: commands on the live History), the same surface an external
// AI speaks over stdio. The rig faces LEFT. World units are pixels, y-down, root at the ground
// under the body center. Pip stands ~150 px tall. Placement numbers were art-directed by running
// this script and inspecting renders/pip-*.png against source/refs/pip.png.
//
// Usage: tsx author-pip.mts

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
const atlasRef = JSON.parse(readFileSync(join(root, 'atlas', 'pip', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ regions: Array<{ name: string; w: number; h: number }> }>;
};
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

const { documentId } = (await call('document.new', { name: 'pip' })) as { documentId: string };
// atlas-ref page files are relative to atlas/pip/; the FileStore root is demo/gunner, so prefix.
const atlasForSet = JSON.parse(readFileSync(join(root, 'atlas', 'pip', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ file: string }>;
};
for (const page of atlasForSet.pages) {
  if (!page.file.startsWith('atlas/')) page.file = `atlas/pip/${page.file}`;
}
await call('atlas.set', { documentId, atlas: atlasForSet });

// ---- bones ---------------------------------------------------------------------------------------
// Pip stands ~150 px tall. Ground = y 0 at the root. Facing LEFT (negative x is forward).
const bone = async (name: string, parentId: string | null, x: number, y: number, length = 20): Promise<string> => {
  const res = (await call('bone.create', {
    documentId,
    name,
    ...(parentId !== null ? { parentId } : {}),
    x,
    y,
    length,
  })) as { boneId: string };
  return res.boneId;
};

// JOINT CONTRACT (bird): every limb bone sits at the piece's visual root, buried 8-12 px INSIDE
// the body silhouette, and the attachment offset places the piece's root pixel AT the pivot so
// rotation pins the socket. Body region spans world x [-40.5, 44.5] y [-95.5, -0.5]; its rear
// outline (alpha-measured) is x~21 at wing height y=-80 and x~41 at tail height y=-57.
const rootBone = await bone('root', null, 0, 0, 8);
const body = await bone('body', rootBone, 0, -75, 60);
const head = await bone('head', body, -5, -10, 50); // pivot at the body top-front (neck)
const beakTop = await bone('beak-top', head, -9, -19, 12); // hinge at the beak rear edge
const beakBottom = await bone('beak-bottom', head, -9, -12, 10); // rotating this opens the beak
const tail = await bone('tail', body, 32, 18, 20); // tail base, ~9 px inside the rump outline
const wingNear = await bone('wing-near', body, 12, -5, 30); // shoulder on the upper back, ~9 px inside
const wingFar = await bone('wing-far', body, 10, -9, 25); // far shoulder, hidden behind body/head

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

// back-to-front: far wing, tail, body, head stack, near wing on top of the body.
// Offsets place each piece's alpha-measured root pixel at its bone pivot (see JOINT CONTRACT):
// wing-far root lobe is at fraction (0.05, 0.60) of a 46x46 rect, tail root nub at (0.03, 0.60)
// of a 33.6x34 rect, so root = pivot and the socket cannot open mid-swing.
await regionSlot({ slot: 'wing-far', boneId: wingFar, region: 'wing-far', x: 21, y: -4.5, targetH: 46 });
await regionSlot({ slot: 'tail', boneId: tail, region: 'tail', x: 16, y: -3.5, targetH: 34 });
await regionSlot({ slot: 'body', boneId: body, region: 'body', x: 2, y: 27, targetH: 95 });
await regionSlot({ slot: 'head', boneId: head, region: 'head', x: -2, y: -28, targetH: 72 });
await regionSlot({ slot: 'beak-top', boneId: beakTop, region: 'beak-top', x: -9.6, y: -1, targetH: 16 });
await regionSlot({ slot: 'beak-bottom', boneId: beakBottom, region: 'beak-bottom', x: -7, y: 0.2, targetH: 8.5 });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -3.9, y: -33.9, targetH: 22.5 });
// folded wing lies along the flank; its whole left half overlaps the body (root buried ~20 px)
await regionSlot({ slot: 'wing-near', boneId: wingNear, region: 'wing-near', x: 15, y: 14, targetH: 40 });

// extra attachment variants (animations and the player swap them)
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
// eyes-closed is deliberately stretched taller than its aspect: the fat crescents must blot out the
// white eye sockets that are baked into head.png, or a "closed" eye still shows white beneath the lid.
await call('attach.region.add', {
  documentId,
  slotId: slotIds.get('eyes'),
  name: 'eyes-closed',
  path: 'eyes-closed',
  x: -3,
  y: -33,
  width: 50,
  height: 24,
});
// spread root lobe is at fraction (0.06, 0.69) of the 64.3x60 rect; (28, -11.5) puts that lobe
// exactly on the shoulder pivot, so every flap phase keeps the root socketed on the back.
await addVariant('wing-near', 'wing-near-spread', 60, 28, -11.5);

// restore the default active attachments after variant adds
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('eyes'), attachment: 'eyes-open' });
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('wing-near'), attachment: 'wing-near' });

// ---- animation helpers -----------------------------------------------------------------------------
const boneIdByName: Record<string, string> = {
  root: rootBone, body, head, 'beak-top': beakTop, 'beak-bottom': beakBottom,
  tail, 'wing-near': wingNear, 'wing-far': wingFar,
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
// Rotation sign (verified against renders of THIS rig, hover vs fly wing keys): positive rotation is
// CLOCKWISE on screen. Facing left: positive on the body leans Pip BACK, negative pitches him forward;
// positive on a wing (which extends rearward, right of its pivot) lowers the tip, negative raises it;
// positive on beak-bottom (which extends forward, left of its hinge) CLOSES the beak, negative OPENS it.

// hover: airborne bob, spread wing flapping 4 times per second.
// Flap amplitude is capped at +-22 around the shoulder hinge (joint contract: hover +-20..25 max);
// bigger sweeps read as the wing tearing off the back.
await author({
  name: 'hover', duration: 1.0,
  translate: {
    body: [[0, 0, -83, EASE_IN_OUT], [0.5, 0, -67, EASE_IN_OUT], [1.0, 0, -83]],
  },
  rotate: {
    'wing-near': [[0, 22, EASE_IN_OUT], [0.125, -22, EASE_IN_OUT], [0.25, 22, EASE_IN_OUT],
                  [0.375, -22, EASE_IN_OUT], [0.5, 22, EASE_IN_OUT], [0.625, -22, EASE_IN_OUT],
                  [0.75, 22, EASE_IN_OUT], [0.875, -22, EASE_IN_OUT], [1.0, 22]],
    'wing-far': [[0, 16, EASE_IN_OUT], [0.125, -16, EASE_IN_OUT], [0.25, 16, EASE_IN_OUT],
                 [0.375, -16, EASE_IN_OUT], [0.5, 16, EASE_IN_OUT], [0.625, -16, EASE_IN_OUT],
                 [0.75, 16, EASE_IN_OUT], [0.875, -16, EASE_IN_OUT], [1.0, 16]],
    tail: [[0, -5, EASE_IN_OUT], [0.25, 4, EASE_IN_OUT], [0.5, -5, EASE_IN_OUT], [0.75, 4, EASE_IN_OUT], [1.0, -5]],
    head: [[0, 1, EASE_IN_OUT], [0.5, -2, EASE_IN_OUT], [1.0, 1]],
  },
  attachments: { 'wing-near': [[0, 'wing-near-spread']] },
});

// fly: hover pitched ~18 deg forward, bigger and faster flaps (capped at +-30 per joint contract)
await author({
  name: 'fly', duration: 0.6,
  rotate: {
    body: [[0, -18], [0.6, -18]],
    'wing-near': [[0, 30, EASE_IN_OUT], [0.1, -30, EASE_IN_OUT], [0.2, 30, EASE_IN_OUT],
                  [0.3, -30, EASE_IN_OUT], [0.4, 30, EASE_IN_OUT], [0.5, -30, EASE_IN_OUT], [0.6, 30]],
    'wing-far': [[0, 24, EASE_IN_OUT], [0.1, -24, EASE_IN_OUT], [0.2, 24, EASE_IN_OUT],
                 [0.3, -24, EASE_IN_OUT], [0.4, 24, EASE_IN_OUT], [0.5, -24, EASE_IN_OUT], [0.6, 24]],
    tail: [[0, -6, EASE_IN_OUT], [0.3, 0, EASE_IN_OUT], [0.6, -6]],
    head: [[0, 8], [0.6, 8]], // counter-pitch so Pip keeps looking where he flies
  },
  translate: {
    body: [[0, 0, -79, EASE_IN_OUT], [0.3, 0, -71, EASE_IN_OUT], [0.6, 0, -79]],
  },
  attachments: { 'wing-near': [[0, 'wing-near-spread']] },
});

// talk: fast-talking scout, beak opens 4 times per loop (0/18/3/15 pattern, twice)
await author({
  name: 'talk', duration: 1.0,
  rotate: {
    'beak-bottom': [[0, 0, EASE_OUT], [0.125, -18, EASE_IN_OUT], [0.25, -3, EASE_IN_OUT], [0.375, -15, EASE_IN_OUT],
                    [0.5, 0, EASE_OUT], [0.625, -18, EASE_IN_OUT], [0.75, -3, EASE_IN_OUT], [0.875, -15, EASE_IN_OUT], [1.0, 0]],
    head: [[0, 0, EASE_IN_OUT], [0.25, 3, EASE_IN_OUT], [0.5, 0, EASE_IN_OUT], [0.75, -3, EASE_IN_OUT], [1.0, 0]],
  },
  translate: {
    body: [[0, 0, -75, EASE_IN_OUT], [0.25, 0, -77, EASE_IN_OUT], [0.5, 0, -75, EASE_IN_OUT],
           [0.75, 0, -77, EASE_IN_OUT], [1.0, 0, -75]],
  },
  // grounded: the far wing folds behind the body, so hide its spread region
  attachments: { 'wing-far': [[0, null]] },
});

// walk: two little hops per loop, tail flicks
await author({
  name: 'walk', duration: 0.6,
  translate: {
    body: [[0, 0, -75, EASE_IN], [0.06, 0, -70, EASE_OUT], [0.15, 0, -84, EASE_IN], [0.3, 0, -75, EASE_IN],
           [0.36, 0, -70, EASE_OUT], [0.45, 0, -84, EASE_IN], [0.6, 0, -75]],
  },
  rotate: {
    tail: [[0, 0, EASE_OUT], [0.12, 12, EASE_IN_OUT], [0.3, 0, EASE_OUT], [0.42, 12, EASE_IN_OUT], [0.6, 0]],
    body: [[0, 0, EASE_IN_OUT], [0.15, -3, EASE_IN_OUT], [0.3, 0, EASE_IN_OUT], [0.45, -3, EASE_IN_OUT], [0.6, 0]],
  },
  // grounded: the far wing folds behind the body, so hide its spread region
  attachments: { 'wing-far': [[0, null]] },
});

// land: one-shot drop from 30 px up, squash at touch, wings spread then fold
await author({
  name: 'land', duration: 0.5,
  translate: {
    body: [[0, 0, -105, EASE_IN], [0.22, 0, -75, 'linear'], [0.3, 0, -66, EASE_OUT], [0.4, 0, -78, EASE_IN_OUT], [0.5, 0, -75]],
  },
  scale: {
    body: [[0, 1, 1, 'linear'], [0.22, 1, 1, EASE_OUT], [0.3, 1.12, 0.88, EASE_OUT_BACK], [0.4, 0.97, 1.04, EASE_IN_OUT], [0.5, 1, 1]],
  },
  rotate: {
    'wing-near': [[0, -26, EASE_IN_OUT], [0.1, 16, EASE_IN_OUT], [0.2, -12, EASE_OUT], [0.28, 0]],
    'wing-far': [[0, -20, EASE_IN_OUT], [0.1, 13, EASE_IN_OUT], [0.2, -10, EASE_OUT], [0.28, 0]],
    tail: [[0, -6, EASE_OUT], [0.3, 8, EASE_IN_OUT], [0.5, 0]],
  },
  // at the fold (0.28) the near wing swaps to its folded region and the far wing tucks away
  attachments: {
    'wing-near': [[0, 'wing-near-spread'], [0.28, 'wing-near']],
    'wing-far': [[0, 'wing-far'], [0.28, null]],
  },
});

// lift-strain: leaning back, rapid tiny flaps, whole body trembling on x
await author({
  name: 'lift-strain', duration: 1.0,
  rotate: {
    body: [[0, 12], [1.0, 12]],
    head: [[0, -6], [1.0, -6]], // counter so he keeps eyeing the load
    'wing-near': [[0, -22, 'linear'], [0.1, -2, 'linear'], [0.2, -22, 'linear'], [0.3, -2, 'linear'],
                  [0.4, -22, 'linear'], [0.5, -2, 'linear'], [0.6, -22, 'linear'], [0.7, -2, 'linear'],
                  [0.8, -22, 'linear'], [0.9, -2, 'linear'], [1.0, -22]],
    'wing-far': [[0, -16, 'linear'], [0.1, 0, 'linear'], [0.2, -16, 'linear'], [0.3, 0, 'linear'],
                 [0.4, -16, 'linear'], [0.5, 0, 'linear'], [0.6, -16, 'linear'], [0.7, 0, 'linear'],
                 [0.8, -16, 'linear'], [0.9, 0, 'linear'], [1.0, -16]],
    tail: [[0, 10], [1.0, 10]],
  },
  translate: {
    body: [[0, -3, -75, 'linear'], [0.1, 3, -75, 'linear'], [0.2, -3, -76, 'linear'], [0.3, 3, -74, 'linear'],
           [0.4, -3, -75, 'linear'], [0.5, 3, -76, 'linear'], [0.6, -3, -74, 'linear'], [0.7, 3, -75, 'linear'],
           [0.8, -3, -76, 'linear'], [0.9, 3, -75, 'linear'], [1.0, -3, -75]],
  },
  attachments: { 'wing-near': [[0, 'wing-near-spread']] },
});

// micro face animations for the player's face tracks (names are a contract; keep them exact)
await author({ name: 'mouth-closed', duration: 0.05, rotate: { 'beak-bottom': [[0, 0]] } });
await author({ name: 'mouth-small', duration: 0.05, rotate: { 'beak-bottom': [[0, -10]] } });
await author({ name: 'mouth-wide', duration: 0.05, rotate: { 'beak-bottom': [[0, -22]] } });
await author({ name: 'eyes-open', duration: 0.05, attachments: { eyes: [[0, 'eyes-open']] } });
await author({ name: 'eyes-closed', duration: 0.05, attachments: { eyes: [[0, 'eyes-closed']] } });
await author({
  name: 'blink', duration: 0.3,
  attachments: { eyes: [[0, 'eyes-open'], [0.1, 'eyes-closed'], [0.22, 'eyes-open']] },
});

// ---- save + QA renders -------------------------------------------------------------------------------
await call('document.save', { documentId, path: 'rigs/pip.rig.json' });
const validation = (await call('document.validate', { documentId })) as {
  ok: boolean;
  errors: ReadonlyArray<{ code: string; message: string }>;
};
if (!validation.ok) throw new Error(`document.validate failed: ${JSON.stringify(validation.errors)}`);
console.log('document.validate: ok');

mkdirSync(join(root, 'renders'), { recursive: true });
type Fit = 'content' | { x: number; y: number; w: number; h: number };
async function render(name: string, animation?: string, time?: number, fit: Fit = 'content'): Promise<void> {
  const res = (await call('render_frame', {
    documentId,
    ...(animation !== undefined ? { animation, time } : {}),
    width: 512,
    height: 512,
    fit,
    background: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  })) as { pngBase64: string };
  writeFileSync(join(root, 'renders', `${name}.png`), Buffer.from(res.pngBase64, 'base64'));
  console.log(`rendered renders/${name}.png`);
}
const FACE: Fit = { x: -48, y: -155, w: 80, h: 80 };
await render('pip-setup');
await render('pip-hover', 'hover', 0.25);
await render('pip-fly', 'fly', 0.3);
await render('pip-talk', 'talk', 0.25);
await render('pip-talk-wide', 'talk', 0.125);
await render('pip-walk', 'walk', 0.18);
await render('pip-land', 'land', 0.3);
await render('pip-strain', 'lift-strain', 0.35);
await render('pip-face-closed', 'mouth-closed', 0, FACE);
await render('pip-face-wide', 'mouth-wide', 0, FACE);
await render('pip-face-blink', 'blink', 0.15, FACE);
console.log('PIP authored.');
