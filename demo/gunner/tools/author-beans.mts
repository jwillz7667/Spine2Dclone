import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// BEANS rig + animation authoring: a tiny cream chihuahua, nervous comic relief. Every mutation goes
// through the literal MCP tool handlers (Law 2: commands on the live History), the same surface an
// external AI speaks over stdio. The rig faces LEFT. World units are pixels, y-down, root at the
// ground under the stance center. Beans is ~190 px tall INCLUDING the giant ears; the head is more
// than half of him. Placement numbers were art-directed against source/refs/beans.png by running this
// script and inspecting renders/beans-*.png.
//
// Usage: tsx author-beans.mts

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
type Curve = 'linear' | 'stepped' | Bezier;

// ---- atlas ---------------------------------------------------------------------------------------
const atlasRef = JSON.parse(readFileSync(join(root, 'atlas', 'beans', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ regions: Array<{ name: string; w: number; h: number }> }>;
};
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

const { documentId } = (await call('document.new', { name: 'beans' })) as { documentId: string };
// atlas-ref page files are relative to atlas/beans/; the FileStore root is demo/gunner, so prefix.
const atlasForSet = JSON.parse(readFileSync(join(root, 'atlas', 'beans', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ file: string }>;
};
for (const page of atlasForSet.pages) {
  if (!page.file.startsWith('atlas/')) page.file = `atlas/beans/${page.file}`;
}
await call('atlas.set', { documentId, atlas: atlasForSet });

// ---- bones ---------------------------------------------------------------------------------------
// Beans stands ~190 px tall to the ear tips. Ground = y 0 at the root. Facing LEFT (negative x is
// forward). The torso is tiny (bone at the belly center), the head bone pivots at the neck, each
// giant ear pivots at its base on the skull, legs pivot at hips/shoulders inside the torso.
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
const torso = await bone('torso', rootBone, 0, -52, 50);
const head = await bone('head', torso, -22, -28, 55);
const earNear = await bone('ear-near', head, -20, -44, 40);
const earFar = await bone('ear-far', head, 35, -40, 38);
const tail = await bone('tail', torso, 30, -7, 20);
const legFrontNear = await bone('leg-front-near', torso, -22, 5, 40);
const legFrontFar = await bone('leg-front-far', torso, -13, 5, 40);
const legBackNear = await bone('leg-back-near', torso, 22, 2, 42);
const legBackFar = await bone('leg-back-far', torso, 14, 4, 40);

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

// far side first, then tail + torso, near legs, then the head stack. All layers were cut facing left,
// so no mirroring is needed. There is NO leg-back-far region: that slot REUSES leg-back-near and is
// tinted darker via slot.color so it reads as the far side.
await regionSlot({ slot: 'leg-front-far', boneId: legFrontFar, region: 'leg-front-far', x: 0, y: 21, targetH: 51 });
await regionSlot({ slot: 'leg-back-far', boneId: legBackFar, region: 'leg-back-near', x: 1, y: 21, targetH: 54 });
await call('slot.color', {
  documentId,
  slotId: slotIds.get('leg-back-far'),
  color: { r: 0.72, g: 0.72, b: 0.72, a: 1 },
});
await regionSlot({ slot: 'tail', boneId: tail, region: 'tail', x: 6, y: -17, targetH: 40 });
await regionSlot({ slot: 'torso', boneId: torso, region: 'torso', x: 2, y: 1, targetH: 56 });
await regionSlot({ slot: 'leg-front-near', boneId: legFrontNear, region: 'leg-front-near', x: 0, y: 21, targetH: 51 });
await regionSlot({ slot: 'leg-back-near', boneId: legBackNear, region: 'leg-back-near', x: 1, y: 23, targetH: 55 });
await regionSlot({ slot: 'ear-far', boneId: earFar, region: 'ear-far', x: 11, y: -29, targetH: 62 });
await regionSlot({ slot: 'head', boneId: head, region: 'head', x: -5, y: -35, targetH: 81 });
await regionSlot({ slot: 'ear-near', boneId: earNear, region: 'ear-near', x: -14, y: -30, targetH: 66 });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -12, y: -28, targetH: 28 });
await regionSlot({ slot: 'mouth', boneId: head, region: 'mouth-closed', x: -19, y: -10, targetH: 27 });

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
await addVariant('eyes', 'eyes-closed', 27, -12, -28);
await addVariant('eyes', 'eyes-worried', 28, -12, -28);
await addVariant('mouth', 'mouth-small', 29, -19, -9);
await addVariant('mouth', 'mouth-bark-huge', 45, -19, -1);

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

// Helper: alternating jitter keys [t0..t1] every `step`, flipping between +amp and -amp (linear).
function jitter(t0: number, t1: number, step: number, amp: number, startSign = 1): RotKey[] {
  const keys: RotKey[] = [];
  let sign = startSign;
  for (let t = t0; t <= t1 + 1e-9; t += step) {
    keys.push([Number(t.toFixed(2)), amp * sign, 'linear']);
    sign = -sign;
  }
  return keys;
}

// ---- the animation set -------------------------------------------------------------------------------
// Rotation sign (verified against single-bone probe renders): positive = clockwise on screen.
// Torso: positive rears the chest UP; negative pitches forward. Head: positive lifts the nose;
// negative snaps it down-forward. Legs hang down: positive swings the foot forward (toward the nose).
// Ears: near ear rises/sweeps back with POSITIVE, far ear rises with NEGATIVE (droops back with +).

// idle: a permanent tiny nervous shiver. Head +-1.5 at 8 Hz feel (keys every 0.1s), ears
// counter-tremble +-2, body breathing y +-3.
await author({
  name: 'idle', duration: 1.6,
  rotate: {
    head: jitter(0, 1.6, 0.1, 1.5, 1),
    'ear-near': jitter(0, 1.6, 0.1, 2, -1),
    'ear-far': jitter(0, 1.6, 0.1, 2, -1),
  },
  translate: {
    torso: [[0, 0, -52, EASE_IN_OUT], [0.8, 0, -55, EASE_IN_OUT], [1.6, 0, -52]],
  },
});

// walk: quick scamper. Legs +-28 fast, body bounce +-5 (two per stride), ears flop trailing by 0.05s.
await author({
  name: 'walk', duration: 0.5,
  rotate: {
    'leg-front-near': [[0, 28, EASE_IN_OUT], [0.25, -28, EASE_IN_OUT], [0.5, 28]],
    'leg-front-far': [[0, -28, EASE_IN_OUT], [0.25, 28, EASE_IN_OUT], [0.5, -28]],
    'leg-back-near': [[0, -24, EASE_IN_OUT], [0.25, 24, EASE_IN_OUT], [0.5, -24]],
    'leg-back-far': [[0, 24, EASE_IN_OUT], [0.25, -24, EASE_IN_OUT], [0.5, 24]],
    head: [[0, 1, EASE_IN_OUT], [0.25, -1, EASE_IN_OUT], [0.5, 1]],
    'ear-near': [[0, 2, EASE_IN_OUT], [0.05, 6, EASE_IN_OUT], [0.3, -6, EASE_IN_OUT], [0.5, 2]],
    'ear-far': [[0, 2, EASE_IN_OUT], [0.05, 5, EASE_IN_OUT], [0.3, -5, EASE_IN_OUT], [0.5, 2]],
  },
  translate: {
    torso: [[0, 0, -52, EASE_OUT], [0.125, 0, -57, EASE_IN], [0.25, 0, -52, EASE_OUT],
            [0.375, 0, -57, EASE_IN], [0.5, 0, -52]],
  },
});

// run: frantic dash. Legs +-38, ears streaming back 12 deg with flutter, body pitched forward 8.
await author({
  name: 'run', duration: 0.4,
  rotate: {
    'leg-front-near': [[0, 38, EASE_IN_OUT], [0.2, -38, EASE_IN_OUT], [0.4, 38]],
    'leg-front-far': [[0, -34, EASE_IN_OUT], [0.2, 34, EASE_IN_OUT], [0.4, -34]],
    'leg-back-near': [[0, -38, EASE_IN_OUT], [0.2, 38, EASE_IN_OUT], [0.4, -38]],
    'leg-back-far': [[0, 34, EASE_IN_OUT], [0.2, -34, EASE_IN_OUT], [0.4, 34]],
    torso: [[0, -8, EASE_IN_OUT], [0.2, -10, EASE_IN_OUT], [0.4, -8]],
    head: [[0, 4, EASE_IN_OUT], [0.2, 7, EASE_IN_OUT], [0.4, 4]],
    'ear-near': [[0, 16, EASE_IN_OUT], [0.1, 21, EASE_IN_OUT], [0.2, 16, EASE_IN_OUT], [0.3, 11, EASE_IN_OUT], [0.4, 16]],
    'ear-far': [[0, 14, EASE_IN_OUT], [0.1, 9, EASE_IN_OUT], [0.2, 14, EASE_IN_OUT], [0.3, 19, EASE_IN_OUT], [0.4, 14]],
  },
  translate: {
    torso: [[0, 0, -50, EASE_OUT], [0.2, 0, -61, EASE_IN], [0.4, 0, -50]],
  },
});

// talk: bouncy nervous head bobs +-3, ears twitch.
await author({
  name: 'talk', duration: 1.0,
  rotate: {
    head: [[0, 0, EASE_IN_OUT], [0.2, 3, EASE_IN_OUT], [0.45, -3, EASE_IN_OUT], [0.7, 2, EASE_IN_OUT], [1.0, 0]],
    'ear-near': [[0, 0, EASE_OUT], [0.2, -5, EASE_OUT], [0.35, 0, EASE_OUT], [0.7, -3, EASE_OUT], [0.85, 0, 'linear'], [1.0, 0]],
    'ear-far': [[0, 0, EASE_OUT], [0.45, 4, EASE_OUT], [0.6, 0, EASE_OUT], [1.0, 0]],
  },
  translate: {
    torso: [[0, 0, -52, EASE_IN_OUT], [0.5, 0, -54, EASE_IN_OUT], [1.0, 0, -52]],
  },
});

// freeze-shiver: INTENSE shiver. Torso x jitter +-4 every 0.08s, head +-3 alternating, ears rattle
// +-8, legs locked stiff and splayed slightly (held single keys).
const shiverTorso: VecKey[] = [];
{
  let sign = 1;
  for (let t = 0; t <= 0.8 + 1e-9; t += 0.08) {
    shiverTorso.push([Number(t.toFixed(2)), 4 * sign, -52, 'linear']);
    sign = -sign;
  }
}
await author({
  name: 'freeze-shiver', duration: 0.8,
  rotate: {
    head: jitter(0, 0.8, 0.08, 3, -1),
    'ear-near': jitter(0, 0.8, 0.08, 8, 1),
    'ear-far': jitter(0, 0.8, 0.08, 8, -1),
    'leg-front-near': [[0, 10]],
    'leg-front-far': [[0, 7]],
    'leg-back-near': [[0, -10]],
    'leg-back-far': [[0, -7]],
  },
  translate: { torso: shiverTorso },
  attachments: { eyes: [[0, 'eyes-worried']] },
});

// mega-bark: the hero moment (one-shot).
// 0..0.6 huge inhale: torso+head swell (compound head scale ~1.25), body rears back 10, ears rise,
// mouth to mouth-small. At 0.6 the bark fires: mouth swaps to mouth-bark-huge, head snaps forward
// 15 deg nose-down, scale pops to ~1.05 with recoil, body pushed back x +12. 0.6..1.1 hold with a
// small tremble. 1.1..1.6 settle back to neutral; mouth to mouth-closed at 1.3.
await author({
  name: 'mega-bark', duration: 1.6,
  scale: {
    torso: [[0, 1, 1, EASE_IN_OUT], [0.6, 1.16, 1.16, EASE_OUT], [0.66, 1.03, 1.03, EASE_OUT],
            [0.78, 1.06, 1.06, 'linear'], [1.1, 1.05, 1.05, EASE_IN_OUT], [1.6, 1, 1]],
    head: [[0, 1, 1, EASE_IN_OUT], [0.6, 1.08, 1.08, EASE_OUT], [0.66, 1.0, 1.0, 'linear'], [1.6, 1, 1]],
  },
  rotate: {
    torso: [[0, 0, EASE_IN_OUT], [0.6, 10, EASE_OUT], [0.66, -3, EASE_OUT], [0.8, -4, 'linear'],
            [0.9, -3, 'linear'], [1.0, -4, 'linear'], [1.1, -3, EASE_IN_OUT], [1.6, 0]],
    head: [[0, 0, EASE_IN_OUT], [0.6, 14, EASE_OUT], [0.66, -15, EASE_OUT], [0.8, -13, 'linear'],
           [0.9, -15, 'linear'], [1.0, -13, 'linear'], [1.1, -14, EASE_IN_OUT], [1.6, 0]],
    'ear-near': [[0, 0, EASE_IN_OUT], [0.6, 8, EASE_OUT], [0.66, 16, EASE_OUT], [1.1, 10, EASE_IN_OUT], [1.6, 0]],
    'ear-far': [[0, 0, EASE_IN_OUT], [0.6, -8, EASE_OUT], [0.66, -16, EASE_OUT], [1.1, -10, EASE_IN_OUT], [1.6, 0]],
    'leg-front-near': [[0, 0, EASE_IN_OUT], [0.55, -4, EASE_OUT], [0.66, 10, EASE_OUT], [1.1, 8, EASE_IN_OUT], [1.6, 0]],
    'leg-front-far': [[0, 0, EASE_IN_OUT], [0.55, -3, EASE_OUT], [0.66, 7, EASE_OUT], [1.1, 6, EASE_IN_OUT], [1.6, 0]],
    'leg-back-near': [[0, 0, EASE_IN_OUT], [0.66, -8, EASE_OUT], [1.1, -6, EASE_IN_OUT], [1.6, 0]],
    'leg-back-far': [[0, 0, EASE_IN_OUT], [0.66, -6, EASE_OUT], [1.1, -5, EASE_IN_OUT], [1.6, 0]],
  },
  translate: {
    torso: [[0, 0, -52, EASE_IN_OUT], [0.6, 4, -56, EASE_OUT], [0.66, 12, -50, EASE_OUT],
            [0.8, 13, -50, 'linear'], [0.9, 12, -51, 'linear'], [1.0, 13, -50, 'linear'],
            [1.1, 12, -50, EASE_IN_OUT], [1.6, 0, -52]],
  },
  attachments: {
    mouth: [[0, 'mouth-closed'], [0.15, 'mouth-small'], [0.6, 'mouth-bark-huge'], [1.3, 'mouth-closed']],
    eyes: [[0, 'eyes-open'], [0.55, 'eyes-closed'], [1.2, 'eyes-open']],
  },
});

// proud-strut: walk but chest up (torso -8), head high, ears perked, slower bounce.
await author({
  name: 'proud-strut', duration: 0.7,
  rotate: {
    'leg-front-near': [[0, 20, EASE_IN_OUT], [0.35, -20, EASE_IN_OUT], [0.7, 20]],
    'leg-front-far': [[0, -20, EASE_IN_OUT], [0.35, 20, EASE_IN_OUT], [0.7, -20]],
    'leg-back-near': [[0, -18, EASE_IN_OUT], [0.35, 18, EASE_IN_OUT], [0.7, -18]],
    'leg-back-far': [[0, 18, EASE_IN_OUT], [0.35, -18, EASE_IN_OUT], [0.7, 18]],
    torso: [[0, 8]],
    head: [[0, 6, EASE_IN_OUT], [0.35, 4, EASE_IN_OUT], [0.7, 6]],
    'ear-near': [[0, 6]],
    'ear-far': [[0, -6]],
  },
  translate: {
    torso: [[0, 0, -54, EASE_OUT], [0.175, 0, -58, EASE_IN], [0.35, 0, -54, EASE_OUT],
            [0.525, 0, -58, EASE_IN], [0.7, 0, -54]],
  },
});

// micro state animations for the player's face tracks (one attachment key each).
// mouth-wide uses the mouth-bark-huge region: it is his loud talking mouth.
const face = async (name: string, slot: string, region: string): Promise<void> => {
  await author({ name, duration: 0.05, attachments: { [slot]: [[0, region]] } });
};
await face('mouth-closed', 'mouth', 'mouth-closed');
await face('mouth-small', 'mouth', 'mouth-small');
await face('mouth-wide', 'mouth', 'mouth-bark-huge');
await face('eyes-open', 'eyes', 'eyes-open');
await face('eyes-closed', 'eyes', 'eyes-closed');
await face('eyes-worried', 'eyes', 'eyes-worried');
await author({
  name: 'blink', duration: 0.3,
  attachments: { eyes: [[0, 'eyes-open'], [0.1, 'eyes-closed'], [0.22, 'eyes-open']] },
});

// ---- save + QA renders -------------------------------------------------------------------------------
await call('document.save', { documentId, path: 'rigs/beans.rig.json' });
const validation = (await call('document.validate', { documentId })) as {
  ok: boolean;
  errors: ReadonlyArray<{ code: string; message: string }>;
};
console.log(`document.validate ok: ${validation.ok}`);
if (!validation.ok) {
  for (const e of validation.errors) console.error(`  ${e.code}: ${e.message}`);
  process.exitCode = 1;
}

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
await render('beans-setup');
await render('beans-shiver', 'freeze-shiver', 0.4);
await render('beans-bark', 'mega-bark', 0.75);
await render('beans-run', 'run', 0.2);
await render('beans-idle', 'idle', 0.8);
await render('beans-walk', 'walk', 0.125);
await render('beans-strut', 'proud-strut', 0.35);
await render('beans-bark-inhale', 'mega-bark', 0.55);
console.log('BEANS authored.');
