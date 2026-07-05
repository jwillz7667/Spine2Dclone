import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// GUNNER rig + animation authoring. Every mutation goes through the literal MCP tool handlers
// (Law 2: commands on the live History), the same surface an external AI speaks over stdio.
// The rig faces LEFT. World units are pixels, y-down, root at the ground under the torso center.
// Placement numbers were art-directed by running this script and inspecting renders/gunner-*.png.
//
// Usage: tsx author-gunner.mts

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
const atlasRef = JSON.parse(readFileSync(join(root, 'atlas', 'gunner', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ regions: Array<{ name: string; w: number; h: number }> }>;
};
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages) for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}
function sizedW(region: string, targetW: number): number {
  const s = regionSize.get(region);
  if (s === undefined) throw new Error(`unknown region ${region}`);
  return (s.h / s.w) * targetW;
}

const { documentId } = (await call('document.new', { name: 'gunner' })) as { documentId: string };
// atlas-ref page files are relative to atlas/gunner/; the FileStore root is demo/gunner, so prefix.
const atlasForSet = JSON.parse(readFileSync(join(root, 'atlas', 'gunner', 'atlas-ref.json'), 'utf8')) as {
  pages: Array<{ file: string }>;
};
for (const page of atlasForSet.pages) {
  if (!page.file.startsWith('atlas/')) page.file = `atlas/gunner/${page.file}`;
}
await call('atlas.set', { documentId, atlas: atlasForSet });

// ---- bones ---------------------------------------------------------------------------------------
// Gunner stands ~420 px tall. Ground = y 0 at the root. Facing LEFT (negative x is forward).
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
const torso = await bone('torso', rootBone, 0, -175, 120);
const head = await bone('head', torso, -105, -55, 90);
// ears root at the skull crown (head.png crown top center is head-local (-23, -144) after the
// head mirror); near ear slightly forward of far, bases buried ~10px into the dome
const earNear = await bone('ear-near', head, -40, -132, 30);
const earFar = await bone('ear-far', head, -2, -128, 30);
// Legs are TORSO children so the shoulder/hip sockets can never separate from the body, with
// pivots buried ~22 px inside the silhouette at the joints. Feet stay visually planted because
// every animation that rotates the torso beyond ~6 deg carries COUNTER-ROTATION keys on the legs
// (leg world angle = gait angle, independent of the body lean). Rotations of 6 deg or less drift
// the sockets less than the pivot burial depth and need no counters.
const legFrontNear = await bone('leg-front-near', torso, -27, 70, 90);
const legFrontFar = await bone('leg-front-far', torso, -108, 66, 85);
const legBackNear = await bone('leg-back-near', torso, 100, 45, 95);
const legBackFar = await bone('leg-back-far', torso, 78, 48, 90);

// ---- slots + attachments (created back-to-front; creation order = draw order) ---------------------
interface SlotSpec {
  readonly slot: string;
  readonly boneId: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly targetH: number;
  readonly scaleX?: number; // -1 mirrors (the torso sheet piece faces right; the rig faces left)
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

// far side first, then near legs, torso, head stack.
// EVERY body piece on the sheet is drawn facing RIGHT (toes right, nose right); the rig faces
// LEFT, so torso, head and all four legs carry scaleX -1. The face landmarks below are measured
// on the MIRRORED head: nose centroid (-76, -8), blaze (-53, -69), drawn lip line spanning
// x -51..+57 centered (+3, +60), crown top (-23, -144).
await regionSlot({ slot: 'leg-front-far', boneId: legFrontFar, region: 'leg-front-far', x: 0, y: 46, targetH: 127, scaleX: -1 });
await regionSlot({ slot: 'leg-back-far', boneId: legBackFar, region: 'leg-back-far', x: 0, y: 50, targetH: 140, scaleX: -1 });
await regionSlot({ slot: 'leg-front-near', boneId: legFrontNear, region: 'leg-front-near', x: 0, y: 42, targetH: 125, scaleX: -1 });
await regionSlot({ slot: 'leg-back-near', boneId: legBackNear, region: 'leg-back-near', x: 0, y: 55, targetH: 150, scaleX: -1 });
await regionSlot({ slot: 'torso', boneId: torso, region: 'torso', x: 10, y: -15, targetH: 240, scaleX: -1 });
await regionSlot({ slot: 'ear-far', boneId: earFar, region: 'ear-far', x: 5, y: -32, targetH: 85 });
await regionSlot({ slot: 'head', boneId: head, region: 'head', x: -25, y: -20, targetH: 250, scaleX: -1 });
await regionSlot({ slot: 'ear-near', boneId: earNear, region: 'ear-near', x: 0, y: -38, targetH: 95 });
await regionSlot({ slot: 'brows', boneId: head, region: 'brows', x: -50, y: -88, targetH: sizedW('brows', 120) });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -50, y: -57, targetH: 75 });
// mouth-closed retraces the head's own drawn smile (same anchor, mirrored so the cheek curl
// lands rearward); open variants share the anchor and are sized to fully cover the drawn stroke
await regionSlot({ slot: 'mouth', boneId: head, region: 'mouth-closed', x: 3, y: 59, targetH: sizedW('mouth-closed', 112), scaleX: -1 });

// extra attachment variants on the eye / mouth / brow slots (player and animations swap them)
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
await addVariant('eyes', 'eyes-half', 75, -50, -57);
await addVariant('eyes', 'eyes-closed', 72, -50, -57);
await addVariant('eyes', 'eyes-happy', 72, -50, -57);
await addVariant('eyes', 'eyes-worried', 88, -50, -55);
await addVariant('mouth', 'mouth-small', sizedW('mouth-small', 124), 3, 62);
await addVariant('mouth', 'mouth-wide', sizedW('mouth-wide', 140), 3, 66);
await addVariant('mouth', 'mouth-oo', sizedW('mouth-oo', 64), 3, 66);
await addVariant('mouth', 'mouth-grit', sizedW('mouth-grit', 140), 3, 60);

// restore the default active attachments after variant adds
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('eyes'), attachment: 'eyes-open' });
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('mouth'), attachment: 'mouth-closed' });
await call('slot.activeAttachment', { documentId, slotId: slotIds.get('brows'), attachment: 'brows' });

// ---- animation helpers -----------------------------------------------------------------------------
const boneIdByName: Record<string, string> = {
  root: rootBone, torso, head, 'ear-near': earNear, 'ear-far': earFar,
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
// Rotation sign: positive = clockwise on screen (y-down). Facing left: positive torso rotation pitches
// the chest DOWN toward the nose; negative lifts the chest. Verified against renders.

await author({
  name: 'idle', duration: 2.0,
  translate: { torso: [[0, 0, -175, EASE_IN_OUT], [1.0, 0, -181, EASE_IN_OUT], [2.0, 0, -175]] },
  rotate: {
    head: [[0, 0, EASE_IN_OUT], [1.1, 2.5, EASE_IN_OUT], [2.0, 0]],
    'ear-near': [[0, 0], [1.2, 0, EASE_OUT], [1.45, -7, EASE_OUT], [1.7, 0], [2.0, 0]],
  },
});

await author({
  name: 'walk', duration: 0.8,
  rotate: {
    'leg-front-near': [[0, 18, EASE_IN_OUT], [0.4, -16, EASE_IN_OUT], [0.8, 18]],
    'leg-front-far': [[0, -16, EASE_IN_OUT], [0.4, 18, EASE_IN_OUT], [0.8, -16]],
    'leg-back-near': [[0, -15, EASE_IN_OUT], [0.4, 17, EASE_IN_OUT], [0.8, -15]],
    'leg-back-far': [[0, 17, EASE_IN_OUT], [0.4, -15, EASE_IN_OUT], [0.8, 17]],
    torso: [[0, 1.5, EASE_IN_OUT], [0.4, -1.5, EASE_IN_OUT], [0.8, 1.5]],
    head: [[0, -1.5, EASE_IN_OUT], [0.4, 1.5, EASE_IN_OUT], [0.8, -1.5]],
  },
  translate: {
    torso: [[0, 0, -175, EASE_OUT], [0.2, 0, -180, EASE_IN], [0.4, 0, -175, EASE_OUT], [0.6, 0, -180, EASE_IN], [0.8, 0, -175]],
  },
});

await author({
  name: 'run', duration: 0.5,
  rotate: {
    'leg-front-near': [[0, 21, EASE_IN_OUT], [0.25, -22, EASE_IN_OUT], [0.5, 21]],
    'leg-front-far': [[0, 16, EASE_IN_OUT], [0.28, -17, EASE_IN_OUT], [0.5, 16]],
    'leg-back-near': [[0, -32, EASE_IN_OUT], [0.25, 27, EASE_IN_OUT], [0.5, -32]],
    'leg-back-far': [[0, -27, EASE_IN_OUT], [0.28, 22, EASE_IN_OUT], [0.5, -27]],
    torso: [[0, 7, EASE_IN_OUT], [0.25, -3, EASE_IN_OUT], [0.5, 7]],
    head: [[0, -5, EASE_IN_OUT], [0.25, 2, EASE_IN_OUT], [0.5, -5]],
    'ear-near': [[0, 14], [0.5, 14]],
    'ear-far': [[0, 12], [0.5, 12]],
  },
  translate: {
    torso: [[0, 0, -168, EASE_OUT], [0.25, 0, -190, EASE_IN], [0.5, 0, -168]],
  },
});

await author({
  name: 'talk', duration: 1.2,
  rotate: {
    head: [[0, 0, EASE_IN_OUT], [0.3, 2, EASE_IN_OUT], [0.6, -1.5, EASE_IN_OUT], [0.9, 1, EASE_IN_OUT], [1.2, 0]],
  },
  translate: { torso: [[0, 0, -175, EASE_IN_OUT], [0.6, 0, -178, EASE_IN_OUT], [1.2, 0, -175]] },
});

await author({
  name: 'tug-strain', duration: 1.0,
  rotate: {
    torso: [[0, -16, EASE_IN_OUT], [0.25, -19, EASE_IN_OUT], [0.5, -15, EASE_IN_OUT], [0.75, -19, EASE_IN_OUT], [1.0, -16]],
    head: [[0, -10, EASE_IN_OUT], [0.5, -13, EASE_IN_OUT], [1.0, -10]],
    'leg-front-near': [[0, 54, EASE_IN_OUT], [0.25, 57, EASE_IN_OUT], [0.5, 53, EASE_IN_OUT], [0.75, 57, EASE_IN_OUT], [1.0, 54]],
    'leg-front-far': [[0, 46, EASE_IN_OUT], [0.25, 49, EASE_IN_OUT], [0.5, 45, EASE_IN_OUT], [0.75, 49, EASE_IN_OUT], [1.0, 46]],
    'leg-back-near': [[0, -18, EASE_IN_OUT], [0.25, -15, EASE_IN_OUT], [0.5, -19, EASE_IN_OUT], [0.75, -15, EASE_IN_OUT], [1.0, -18]],
    'leg-back-far': [[0, -12, EASE_IN_OUT], [0.25, -9, EASE_IN_OUT], [0.5, -13, EASE_IN_OUT], [0.75, -9, EASE_IN_OUT], [1.0, -12]],
  },
  translate: {
    torso: [[0, 6, -160, 'linear'], [0.12, 9, -160, 'linear'], [0.25, 5, -161, 'linear'], [0.37, 9, -159, 'linear'],
            [0.5, 6, -160, 'linear'], [0.62, 9, -161, 'linear'], [0.75, 5, -160, 'linear'], [0.87, 8, -159, 'linear'], [1.0, 6, -160]],
  },
  attachments: { mouth: [[0, 'mouth-grit']], eyes: [[0, 'eyes-half']] },
});

await author({
  name: 'dig-in', duration: 1.0,
  rotate: {
    'leg-front-near': [[0, 0, EASE_OUT], [0.15, 45, EASE_OUT_BACK], [0.3, 38]],
    'leg-front-far': [[0.2, 0, EASE_OUT], [0.35, 36, EASE_OUT_BACK], [0.5, 30]],
    'leg-back-near': [[0.4, 0, EASE_OUT], [0.55, -40, EASE_OUT_BACK], [0.7, -34]],
    'leg-back-far': [[0.6, 0, EASE_OUT], [0.75, -34, EASE_OUT_BACK], [0.9, -28]],
    torso: [[0, 0, EASE_IN], [0.7, -6, EASE_OUT], [1.0, -7]],
  },
  translate: { torso: [[0, 0, -175, EASE_IN], [0.7, 5, -163, EASE_OUT], [1.0, 6, -160]] },
  attachments: { mouth: [[0, 'mouth-grit']] },
});

await author({
  name: 'hero-pose', duration: 1.5,
  rotate: {
    torso: [[0, 0, EASE_OUT_BACK], [0.4, -11, EASE_IN_OUT], [1.5, -11]],
    'leg-front-near': [[0, 0, EASE_OUT_BACK], [0.4, 11, EASE_IN_OUT], [1.5, 11]],
    'leg-front-far': [[0, 0, EASE_OUT_BACK], [0.4, 11, EASE_IN_OUT], [1.5, 11]],
    'leg-back-near': [[0, 0, EASE_OUT_BACK], [0.4, 11, EASE_IN_OUT], [1.5, 11]],
    'leg-back-far': [[0, 0, EASE_OUT_BACK], [0.4, 11, EASE_IN_OUT], [1.5, 11]],
    head: [[0, 0, EASE_OUT_BACK], [0.45, -9, EASE_IN_OUT], [1.5, -9]],
    'ear-near': [[0, 0, EASE_OUT], [0.5, -8], [1.5, -8]],
    'ear-far': [[0, 0, EASE_OUT], [0.5, -7], [1.5, -7]],
  },
  translate: { torso: [[0, 0, -175, EASE_OUT_BACK], [0.4, 0, -186, EASE_IN_OUT], [1.5, 0, -186]] },
  attachments: { mouth: [[0, 'mouth-closed']], eyes: [[0, 'eyes-open']] },
});

await author({
  name: 'wink', duration: 0.6,
  rotate: { head: [[0, 0, EASE_OUT], [0.15, 4, EASE_IN_OUT], [0.45, 0]] },
  attachments: {
    eyes: [[0, 'eyes-open'], [0.12, 'eyes-half'], [0.18, 'eyes-closed'], [0.38, 'eyes-half'], [0.44, 'eyes-open']],
    mouth: [[0, 'mouth-closed']],
  },
});

await author({
  name: 'head-shake', duration: 0.7,
  rotate: {
    head: [[0, 0, EASE_IN_OUT], [0.12, 13, EASE_IN_OUT], [0.26, -11, EASE_IN_OUT], [0.4, 8, EASE_IN_OUT],
           [0.54, -4, EASE_IN_OUT], [0.7, 0]],
  },
});

await author({
  name: 'yank-grab', duration: 0.8,
  rotate: {
    torso: [[0, 0, EASE_IN], [0.15, 5, EASE_OUT], [0.35, -9, EASE_IN_OUT], [0.6, -3, EASE_IN_OUT], [0.8, 0]],
    head: [[0, 0, EASE_IN], [0.15, 5, EASE_OUT], [0.35, -8, EASE_IN_OUT], [0.8, 0]],
    'leg-front-near': [[0, 0, EASE_IN], [0.15, -5, EASE_OUT], [0.35, 9, EASE_IN_OUT], [0.6, 3, EASE_IN_OUT], [0.8, 0]],
    'leg-front-far': [[0, 0, EASE_IN], [0.15, -5, EASE_OUT], [0.35, 9, EASE_IN_OUT], [0.6, 3, EASE_IN_OUT], [0.8, 0]],
    'leg-back-near': [[0, 0, EASE_IN], [0.15, -5, EASE_OUT], [0.35, 9, EASE_IN_OUT], [0.6, 3, EASE_IN_OUT], [0.8, 0]],
    'leg-back-far': [[0, 0, EASE_IN], [0.15, -5, EASE_OUT], [0.35, 9, EASE_IN_OUT], [0.6, 3, EASE_IN_OUT], [0.8, 0]],
  },
  translate: {
    torso: [[0, 0, -175, EASE_IN], [0.15, 10, -170, EASE_OUT], [0.35, -32, -178, EASE_IN_OUT], [0.6, -4, -175, EASE_IN_OUT], [0.8, 0, -175]],
  },
  attachments: { mouth: [[0, 'mouth-small'], [0.15, 'mouth-wide'], [0.45, 'mouth-grit'], [0.7, 'mouth-closed']] },
});

// micro state animations for the player's face tracks (one attachment key each)
const face = async (name: string, slot: string, region: string): Promise<void> => {
  await author({ name, duration: 0.05, attachments: { [slot]: [[0, region]] } });
};
await face('mouth-closed', 'mouth', 'mouth-closed');
await face('mouth-small', 'mouth', 'mouth-small');
await face('mouth-wide', 'mouth', 'mouth-wide');
await face('mouth-oo', 'mouth', 'mouth-oo');
await face('mouth-grit', 'mouth', 'mouth-grit');
await face('eyes-open', 'eyes', 'eyes-open');
await face('eyes-half', 'eyes', 'eyes-half');
await face('eyes-happy', 'eyes', 'eyes-happy');
await author({
  name: 'eyes-worried', duration: 0.05,
  attachments: { eyes: [[0, 'eyes-worried']], brows: [[0, null]] },
});
await author({
  name: 'blink', duration: 0.3,
  attachments: { eyes: [[0, 'eyes-open'], [0.08, 'eyes-half'], [0.12, 'eyes-closed'], [0.2, 'eyes-half'], [0.26, 'eyes-open']] },
});

// ---- save + QA renders -------------------------------------------------------------------------------
await call('document.save', { documentId, path: 'rigs/gunner.rig.json' });
const { valid } = (await call('document.validate', { documentId })) as { valid: boolean };
console.log(`document.validate: ${valid}`);

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
await render('gunner-setup');
await render('gunner-idle', 'idle', 1.0);
await render('gunner-walk', 'walk', 0.2);
await render('gunner-run', 'run', 0.25);
await render('gunner-tug', 'tug-strain', 0.5);
await render('gunner-hero', 'hero-pose', 1.2);
await render('gunner-yank', 'yank-grab', 0.35);
console.log('GUNNER authored.');
