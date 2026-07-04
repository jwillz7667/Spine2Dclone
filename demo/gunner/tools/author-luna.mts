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
// inspecting renders/luna-*.png against source/refs/luna.png.
//
// Sheet-piece orientation notes (verified against source-layers/luna/*.png):
// - torso is cut VERTICALLY (neck at top, hips at bottom): rotated -90 so the neck points left.
// - tail is cut VERTICALLY (thick base at top-left): rotated -90 so it arcs up and back to the right.
// - both back-leg pieces have toes pointing RIGHT: mirrored with scaleX -1 (toes forward-left).
// - ear-far leans left like ear-near but the reference far ear leans right: mirrored with scaleX -1.
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
// Luna stands ~300 px tall at the head top; slimmer than Gunner. Ground = y 0 at the root. Facing LEFT.
const bone = async (name: string, parentId: string | null, x: number, y: number, length = 40): Promise<string> => {
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

const rootBone = await bone('root', null, 0, 0, 10);
const torso = await bone('torso', rootBone, 0, -140, 100);
const head = await bone('head', torso, -72, -40, 60);
const earNear = await bone('ear-near', head, -40, -104, 30);
const earFar = await bone('ear-far', head, 42, -100, 30);
const tail = await bone('tail', torso, 95, -32, 80);
// Legs hang from the ROOT, not the torso: the torso can lean and bob while paws stay planted.
// Each pivot sits INSIDE the body silhouette at the joint (shoulder/hip), about 22 px above the
// leg piece's top edge, so mid-swing the proximal end never escapes the belly overlap.
const legFrontNear = await bone('leg-front-near', rootBone, -79, -147, 80);
const legFrontFar = await bone('leg-front-far', rootBone, -48, -147, 78);
const legBackNear = await bone('leg-back-near', rootBone, 77, -151, 82);
const legBackFar = await bone('leg-back-far', rootBone, 60, -154, 80);

// ---- slots + attachments (created back-to-front; creation order = draw order) ---------------------
interface SlotSpec {
  readonly slot: string;
  readonly boneId: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly targetH: number;
  readonly scaleX?: number; // -1 mirrors (back legs + far ear are drawn facing right; the rig faces left)
  readonly rotation?: number; // torso and tail sheet pieces are cut vertically; -90 lays them out
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

// back-to-front: far legs, tail, NEAR LEGS, then torso (all leg tops hide under the belly
// silhouette; attachment offset along the limb is targetH/2 - 22 so the pivot is buried), head stack
await regionSlot({ slot: 'leg-front-far', boneId: legFrontFar, region: 'leg-front-far', x: -2, y: 60, targetH: 165 });
await regionSlot({ slot: 'leg-back-far', boneId: legBackFar, region: 'leg-back-far', x: 8, y: 62, targetH: 168, scaleX: -1 });
await regionSlot({ slot: 'tail', boneId: tail, region: 'tail', x: 74, y: -29, targetH: 172, rotation: -90 });
await regionSlot({ slot: 'leg-front-near', boneId: legFrontNear, region: 'leg-front-near', x: -5, y: 62, targetH: 168 });
await regionSlot({ slot: 'leg-back-near', boneId: legBackNear, region: 'leg-back-near', x: 11, y: 64, targetH: 172, scaleX: -1 });
await regionSlot({ slot: 'torso', boneId: torso, region: 'torso', x: 0, y: -6, targetH: 200, rotation: -90 });
await regionSlot({ slot: 'ear-far', boneId: earFar, region: 'ear-far', x: 4, y: -25, targetH: 70, scaleX: -1 });
await regionSlot({ slot: 'head', boneId: head, region: 'head', x: -6, y: -60, targetH: 130 });
await regionSlot({ slot: 'ear-near', boneId: earNear, region: 'ear-near', x: -4, y: -29, targetH: 78 });
await regionSlot({ slot: 'goggles', boneId: head, region: 'goggles', x: -9, y: -113, targetH: 72 });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -8, y: -63, targetH: 48 });
// the mouth piece is a soft-edged dark patch carrying the pink nose + mouth marks; kept small and
// seated low-left on the muzzle so the soft edge blends into the blank black face
await regionSlot({ slot: 'mouth', boneId: head, region: 'mouth-closed', x: -29, y: -33, targetH: 62 });

// extra attachment variants on the eye / mouth slots (player and animations swap them)
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
// variant heights match the eyes-open WIDTH (~141 px) so the lid strips line up with the open eyes
await addVariant('eyes', 'eyes-half', 44, -8, -64);
await addVariant('eyes', 'eyes-closed', 19, -8, -59);
await addVariant('mouth', 'mouth-small', 63, -29, -33);
await addVariant('mouth', 'mouth-smile', 64, -29, -33);

// restore the default active attachments after variant adds
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('eyes'), attachment: 'eyes-open' });
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('mouth'), attachment: 'mouth-closed' });

// ---- animation helpers -----------------------------------------------------------------------------
const boneIdByName: Record<string, string> = {
  root: rootBone, torso, head, 'ear-near': earNear, 'ear-far': earFar, tail,
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
    'ear-near': [[0, 0], [1.7, 0, EASE_OUT], [1.8, -12, EASE_OUT], [1.95, 0]],
  },
});

await author({
  name: 'walk', duration: 0.9,
  rotate: {
    // elegant gait: 2-3 deg calmer than Gunner's 18/16 walk swings
    'leg-front-near': [[0, 16, EASE_IN_OUT], [0.45, -14, EASE_IN_OUT], [0.9, 16]],
    'leg-front-far': [[0, -14, EASE_IN_OUT], [0.45, 16, EASE_IN_OUT], [0.9, -14]],
    'leg-back-near': [[0, -13, EASE_IN_OUT], [0.45, 15, EASE_IN_OUT], [0.9, -13]],
    'leg-back-far': [[0, 15, EASE_IN_OUT], [0.45, -13, EASE_IN_OUT], [0.9, 15]],
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
    // calmer than the old +-30: 2-3 deg under Gunner's 28/25 run swings
    'leg-front-near': [[0, 25, EASE_IN_OUT], [0.275, -22, EASE_IN_OUT], [0.55, 25]],
    'leg-front-far': [[0, 20, EASE_IN_OUT], [0.3, -18, EASE_IN_OUT], [0.55, 20]],
    'leg-back-near': [[0, -22, EASE_IN_OUT], [0.275, 21, EASE_IN_OUT], [0.55, -22]],
    'leg-back-far': [[0, -17, EASE_IN_OUT], [0.3, 16, EASE_IN_OUT], [0.55, -17]],
    torso: [[0, 5, EASE_IN_OUT], [0.275, -2, EASE_IN_OUT], [0.55, 5]],
    head: [[0, -4, EASE_IN_OUT], [0.275, 1, EASE_IN_OUT], [0.55, -4]],
    // streams behind: lifted (-20 raises the tip on this rig) with a small wave
    tail: [[0, -20, EASE_IN_OUT], [0.275, -25, EASE_IN_OUT], [0.55, -20]],
    'ear-near': [[0, 8]], 'ear-far': [[0, 7]],
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
    // Legs are root children: the torso lean stays on the torso and the other three paws
    // remain planted at setup, bracing the crank.
    'leg-front-near': [[0, 0, 'linear'], [0.2, 90, 'linear'], [0.4, 180, 'linear'], [0.6, 270, 'linear'], [0.8, 360]],
    torso: [[0, 5]],
    head: [[0, 9]],
  },
  translate: { torso: [[0, -6, 3]] },
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
    // raises the near paw forward to horizontal and HOLDS (one-shot, no return key)
    'leg-front-near': [[0, 0, EASE_OUT_BACK], [0.35, 80], [0.8, 80]],
    head: [[0, 0, EASE_OUT], [0.3, -5], [0.8, -5]],
    torso: [[0, 0, EASE_OUT], [0.35, -3], [0.8, -3]],
  },
  translate: { torso: [[0, 0, 0, EASE_OUT], [0.35, 4, -1], [0.8, 4, -1]] },
});

// micro state animations for the player's face tracks (one attachment key each)
const face = async (name: string, slot: string, region: string): Promise<void> => {
  await author({ name, duration: 0.05, attachments: { [slot]: [[0, region]] } });
};
await face('mouth-closed', 'mouth', 'mouth-closed');
await face('mouth-small', 'mouth', 'mouth-small');
await face('mouth-smile', 'mouth', 'mouth-smile');
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
async function render(name: string, animation?: string, time?: number): Promise<void> {
  const res = (await call('render_frame', {
    documentId,
    ...(animation !== undefined ? { animation, time } : {}),
    width: 512,
    height: 512,
    fit: 'content',
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
console.log('LUNA authored.');
