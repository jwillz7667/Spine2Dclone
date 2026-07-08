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
// ground under the stance center. Beans is ~200 px tall to the ear tips INCLUDING the giant ears;
// the head is more than half of him. Placement numbers were art-directed against source/refs/beans.png
// by running this script and inspecting renders/beans-*.png, then corrected against alpha/color
// measurements of the cut pieces. The EARS and the MOUTH are baked into full replacement heads
// (gen-beans-heads.mts, the approved Gunner/Luna pattern): separately rigged ear pieces never sat
// right on the dome and pasted mouth plates read as stickers, so the head slot swaps whole
// nose-registered heads and only the EYES remain a separate overlay.
//
// Usage: tsx author-beans.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const deps: ToolDeps = { sessions: new SessionRegistry(), files: createNodeFileStore(root) };
const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function call(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
const atlasRef = JSON.parse(
  readFileSync(join(root, 'atlas', 'beans', 'atlas-ref.json'), 'utf8'),
) as {
  pages: Array<{ regions: Array<{ name: string; w: number; h: number }> }>;
};
const regionSize = new Map<string, { w: number; h: number }>();
for (const page of atlasRef.pages)
  for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
function sized(region: string, targetH: number): { width: number; height: number } {
  const s = regionSize.get(region);
  if (s === undefined)
    throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
  return { width: (s.w / s.h) * targetH, height: targetH };
}

const { documentId } = (await call('document.new', { name: 'beans' })) as { documentId: string };
// atlas-ref page files are relative to atlas/beans/; the FileStore root is demo/gunner, so prefix.
const atlasForSet = JSON.parse(
  readFileSync(join(root, 'atlas', 'beans', 'atlas-ref.json'), 'utf8'),
) as {
  pages: Array<{ file: string }>;
};
for (const page of atlasForSet.pages) {
  if (!page.file.startsWith('atlas/')) page.file = `atlas/beans/${page.file}`;
}
await call('atlas.set', { documentId, atlas: atlasForSet });

// ---- bones ---------------------------------------------------------------------------------------
// Beans stands ~190 px tall to the ear tips. Ground = y 0 at the root. Facing LEFT (negative x is
// forward). The torso is tiny (bone at the belly center), the head bone pivots at the neck (the
// giant ears ride the head piece itself, no ear bones), and the legs are TORSO children so the
// hip and shoulder sockets can never separate from the tiny body. Joint contract per the corrected
// Gunner architecture: counter-rotation keys keep the paws planted wherever the torso leans hard.
const bone = async (
  name: string,
  parentId: string | null,
  x: number,
  y: number,
  length = 40,
): Promise<string> => {
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
const tail = await bone('tail', torso, 30, -7, 20);
// Legs are TORSO children so the shoulder/hip sockets can never separate from the tiny body: any
// torso rotation carries the joints with it. Each pivot is pinned into the limb root the TORSO ART
// actually draws (alpha-measured on source-layers/beans/torso.png and cross-checked against the
// assembled source/refs/beans.png, then converted region-px -> torso-local through the torso
// attachment transform: 0.0964 rig px per region px, center offset 2,1): the forward shoulder in
// the chest-fur mass at world (-22,-42.5), the rear-of-pair shoulder under the mid-belly at
// (-4.5,-38), the near hip in the drawn haunch lobe at (31,-41), the far hip at the groin notch at
// (19,-38). Paws stay visually planted because every animation that rotates the torso beyond
// ~6 deg carries COUNTER-ROTATION keys on the legs (leg local = gait/brace angle minus torso
// angle, keyed at the torso's times with the torso's curves); smaller rotations drift the plant
// less than the pivot burial and need no counters. Positions below are torso-local (the torso
// bone sits at world 0,-52).
const legFrontNear = await bone('leg-front-near', torso, -22, 9.5, 40);
const legFrontFar = await bone('leg-front-far', torso, -4.5, 14, 40);
const legBackNear = await bone('leg-back-near', torso, 31, 11, 42);
const legBackFar = await bone('leg-back-far', torso, 19, 14, 40);

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

// far side first, then tail + torso, near legs, then the head stack. All LEG layers were cut facing
// left (front toes and hind toes point left, hocks bend rearward-right; verified per piece on the
// bottom-row alpha spans), so no piece needs mirroring. leg-back-far is the forward leg carved out
// of beans-parts piece-09 (gen-beans-farleg.mts), the artist's far hindquarters drawn in the same
// darker warm tan as leg-front-far, replacing the old gray-tinted near-leg reuse that read as a
// gray-green sliver between the hind legs. Its raw rump-side cut edge faces rearward-right, under
// the torso and the near haunch. Leg sizes match the drawn root masses (ref shin ~11.4 rig px ->
// front targetH 56/54; ref thigh top at world -46 -> back targetH 46; far leg 41.6 at piece-09's
// native scale). Offsets keep each pivot on the piece's drawn joint and the paw bottom exactly at
// ground: offsetY = |boneWorldY| - targetH/2.
await regionSlot({
  slot: 'leg-front-far',
  boneId: legFrontFar,
  region: 'leg-front-far',
  x: 1,
  y: 11,
  targetH: 54,
});
await regionSlot({
  slot: 'leg-back-far',
  boneId: legBackFar,
  region: 'leg-back-far',
  x: -1,
  y: 17.2,
  targetH: 41.6,
});
await regionSlot({ slot: 'tail', boneId: tail, region: 'tail', x: 6, y: -17, targetH: 40 });
await regionSlot({ slot: 'torso', boneId: torso, region: 'torso', x: 2, y: 1, targetH: 56 });
await regionSlot({
  slot: 'leg-front-near',
  boneId: legFrontNear,
  region: 'leg-front-near',
  x: 1.2,
  y: 14.5,
  targetH: 56,
});
await regionSlot({
  slot: 'leg-back-near',
  boneId: legBackNear,
  region: 'leg-back-near',
  x: 1.8,
  y: 18,
  targetH: 46,
});
// The head pieces carry the giant ears and the mouth state baked in; every variant is
// nose/cheek-registered by gen-beans-heads.mts against the original head's anchors (nose pinned
// at head-local (-19,-17.5)), so the skull and ears do not move a pixel when the attachment
// swaps. Transforms come verbatim from that script's output.
// one shared composition delta (+4,+9) on the head variants AND the eyes overlay seats the skull
// over the torso's drawn neck stump (nose registration alone left the collar rim exposed as a gap)
await regionSlot({ slot: 'head', boneId: head, region: 'head', x: -15, y: -42.9, targetH: 119.6 });
await regionSlot({ slot: 'eyes', boneId: head, region: 'eyes-open', x: -8, y: -19, targetH: 28 });

// extra attachment variants on the eye / mouth slots (player and animations swap them)
async function addVariant(
  slot: string,
  region: string,
  targetH: number,
  x: number,
  y: number,
): Promise<void> {
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
await addVariant('eyes', 'eyes-closed', 27, -8, -19);
await addVariant('eyes', 'eyes-worried', 28, -8, -19);
// full replacement heads (gen-beans-heads.mts output plus the shared +4,+9 composition delta):
// closed smile is the base 'head' region, the others swap in on the same slot with their own
// nose-registered transforms
await addVariant('head', 'head-talk', 122.6, -15, -41.4);
await addVariant('head', 'head-bark', 137.3, -14.9, -34);
await addVariant('head', 'head-worried', 119.4, -15, -42.9);

// restore the default active attachments after variant adds
await call('slot.activeAttachment', {
  documentId,
  slotId: slotIds.get('eyes'),
  attachment: 'eyes-open',
});
await call('slot.activeAttachment', {
  documentId,
  slotId: slotIds.get('head'),
  attachment: 'head',
});

// ---- animation helpers -----------------------------------------------------------------------------
const boneIdByName: Record<string, string> = {
  root: rootBone,
  torso,
  head,
  tail,
  'leg-front-near': legFrontNear,
  'leg-front-far': legFrontFar,
  'leg-back-near': legBackNear,
  'leg-back-far': legBackFar,
};

type RotKey = readonly [time: number, angle: number, curve?: Curve];
type VecKey = readonly [time: number, x: number, y: number, curve?: Curve];
interface AnimSpec {
  readonly name: string;
  readonly duration: number;
  readonly rotate?: Record<string, readonly RotKey[]>;
  readonly translate?: Record<string, readonly VecKey[]>;
  readonly scale?: Record<string, readonly VecKey[]>;
  readonly attachments?: Record<
    string,
    ReadonlyArray<readonly [time: number, name: string | null]>
  >;
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
        documentId,
        animationId,
        channel: 'rotate',
        boneId: boneIdByName[boneName],
        time,
        value: { angle },
        ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [boneName, keys] of Object.entries(spec.translate ?? {})) {
    for (const [time, x, y, curve] of keys) {
      await call('kf.set', {
        documentId,
        animationId,
        channel: 'translate',
        boneId: boneIdByName[boneName],
        time,
        value: { x, y },
        ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [boneName, keys] of Object.entries(spec.scale ?? {})) {
    for (const [time, x, y, curve] of keys) {
      await call('kf.set', {
        documentId,
        animationId,
        channel: 'scale',
        boneId: boneIdByName[boneName],
        time,
        value: { x, y },
        ...(curve !== undefined ? { curve } : {}),
      });
    }
  }
  for (const [slotName, keys] of Object.entries(spec.attachments ?? {})) {
    for (const [time, name] of keys) {
      await call('kf.attachment.set', {
        documentId,
        animationId,
        slotId: slotIds.get(slotName),
        time,
        name,
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
// negative snaps it down-forward. Legs hang down: positive swings the foot forward (toward the
// nose). The ears ride the head piece, so every head jitter/nod carries them for free.

// idle: a permanent tiny nervous shiver. Head +-1.5 at 8 Hz feel (keys every 0.1s, the baked
// ears tremble with it), body breathing y +-3. Translate keys are DELTAS from setup; paws planted.
await author({
  name: 'idle',
  duration: 1.6,
  rotate: {
    head: jitter(0, 1.6, 0.1, 1.5, 1),
  },
  translate: {
    torso: [
      [0, 0, 0, EASE_IN_OUT],
      [0.8, 0, -3, EASE_IN_OUT],
      [1.6, 0, 0],
    ],
  },
});

// walk: quick scamper. Legs +-20, body bounce 5 px twice per stride, a small head nod flops the
// baked ears. The torso never rotates here (bounce is pure translate), so no counter keys.
await author({
  name: 'walk',
  duration: 0.5,
  rotate: {
    'leg-front-near': [
      [0, 20, EASE_IN_OUT],
      [0.25, -20, EASE_IN_OUT],
      [0.5, 20],
    ],
    'leg-front-far': [
      [0, -20, EASE_IN_OUT],
      [0.25, 20, EASE_IN_OUT],
      [0.5, -20],
    ],
    'leg-back-near': [
      [0, -18, EASE_IN_OUT],
      [0.25, 18, EASE_IN_OUT],
      [0.5, -18],
    ],
    'leg-back-far': [
      [0, 18, EASE_IN_OUT],
      [0.25, -18, EASE_IN_OUT],
      [0.5, 18],
    ],
    head: [
      [0, 2, EASE_IN_OUT],
      [0.25, -2, EASE_IN_OUT],
      [0.5, 2],
    ],
  },
  translate: {
    torso: [
      [0, 0, 0, EASE_OUT],
      [0.125, 0, -5, EASE_IN],
      [0.25, 0, 0, EASE_OUT],
      [0.375, 0, -5, EASE_IN],
      [0.5, 0, 0],
    ],
  },
});

// run: frantic dash. World gait +-26 with the body pitched forward 8 to 10; the torso exceeds the
// 6 deg counter threshold, so every leg key is COUNTER-ROTATED (local = world gait minus torso at
// that time) at the torso's key times with matching curves, keeping the swing arcs plumb under
// the lean. The head bobs against the lean and the baked ears stream with it.
await author({
  name: 'run',
  duration: 0.4,
  rotate: {
    'leg-front-near': [
      [0, 34, EASE_IN_OUT],
      [0.2, -16, EASE_IN_OUT],
      [0.4, 34],
    ],
    'leg-front-far': [
      [0, -15, EASE_IN_OUT],
      [0.2, 33, EASE_IN_OUT],
      [0.4, -15],
    ],
    'leg-back-near': [
      [0, -16, EASE_IN_OUT],
      [0.2, 34, EASE_IN_OUT],
      [0.4, -16],
    ],
    'leg-back-far': [
      [0, 29, EASE_IN_OUT],
      [0.2, -11, EASE_IN_OUT],
      [0.4, 29],
    ],
    torso: [
      [0, -8, EASE_IN_OUT],
      [0.2, -10, EASE_IN_OUT],
      [0.4, -8],
    ],
    head: [
      [0, 4, EASE_IN_OUT],
      [0.2, 7, EASE_IN_OUT],
      [0.4, 4],
    ],
  },
  translate: {
    torso: [
      [0, 0, 2, EASE_OUT],
      [0.2, 0, -9, EASE_IN],
      [0.4, 0, 2],
    ],
  },
});

// talk: bouncy nervous head bobs +-3 (the baked ears bob along).
await author({
  name: 'talk',
  duration: 1.0,
  rotate: {
    head: [
      [0, 0, EASE_IN_OUT],
      [0.2, 3, EASE_IN_OUT],
      [0.45, -3, EASE_IN_OUT],
      [0.7, 2, EASE_IN_OUT],
      [1.0, 0],
    ],
  },
  translate: {
    torso: [
      [0, 0, 0, EASE_IN_OUT],
      [0.5, 0, -2, EASE_IN_OUT],
      [1.0, 0, 0],
    ],
  },
});

// freeze-shiver: INTENSE shiver. Torso x jitter +-4 every 0.08s (a DELTA; the whole dog rattles as
// one rigid block, legs included, which reads as a full-body tremble), head +-3 alternating (the
// giant baked ears rattle with it), legs locked stiff and splayed slightly (held single keys).
// The torso never ROTATES here and the head jitter is tiny, so no counter keys are needed. The
// face is the worried set: wavy-frown head variant plus worried eyes.
const shiverTorso: VecKey[] = [];
{
  let sign = 1;
  for (let t = 0; t <= 0.8 + 1e-9; t += 0.08) {
    shiverTorso.push([Number(t.toFixed(2)), 4 * sign, 0, 'linear']);
    sign = -sign;
  }
}
await author({
  name: 'freeze-shiver',
  duration: 0.8,
  rotate: {
    head: jitter(0, 0.8, 0.08, 3, -1),
    'leg-front-near': [[0, 10]],
    'leg-front-far': [[0, 7]],
    'leg-back-near': [[0, -10]],
    'leg-back-far': [[0, -7]],
  },
  translate: { torso: shiverTorso },
  attachments: { eyes: [[0, 'eyes-worried']], head: [[0, 'head-worried']] },
});

// mega-bark: the hero moment (one-shot).
// 0..0.6 huge inhale: torso+head swell (compound head scale ~1.25), body rears back 10, head to
// the talk variant. At 0.6 the bark fires: the head swaps to head-bark (huge open jaw baked in),
// snaps forward 15 deg nose-down, scale pops to ~1.05 with recoil, body pushed back x +12.
// 0.6..1.1 hold with a small tremble. 1.1..1.6 settle back to neutral; head closes at 1.3.
// Legs are torso children, so the rear-back (+10) and the blast recoil (-3/-4 tremble) both
// exceed or ride the counter threshold: every leg key sits at the torso's OWN key times with the
// torso's curves, value = world brace minus torso angle. World brace: gather under the rear-back
// at the inhale peak (front -3/-2, back 0 planted), splay at the blast (front +8/+6, back -8/-6),
// hold the splay through the tremble (countering each 1 deg torso tick), settle to front 6/5,
// back -6/-5, then zero.
await author({
  name: 'mega-bark',
  duration: 1.6,
  scale: {
    torso: [
      [0, 1, 1, EASE_IN_OUT],
      [0.6, 1.16, 1.16, EASE_OUT],
      [0.66, 1.03, 1.03, EASE_OUT],
      [0.78, 1.06, 1.06, 'linear'],
      [1.1, 1.05, 1.05, EASE_IN_OUT],
      [1.6, 1, 1],
    ],
    head: [
      [0, 1, 1, EASE_IN_OUT],
      [0.6, 1.08, 1.08, EASE_OUT],
      [0.66, 1.0, 1.0, 'linear'],
      [1.6, 1, 1],
    ],
  },
  rotate: {
    torso: [
      [0, 0, EASE_IN_OUT],
      [0.6, 10, EASE_OUT],
      [0.66, -3, EASE_OUT],
      [0.8, -4, 'linear'],
      [0.9, -3, 'linear'],
      [1.0, -4, 'linear'],
      [1.1, -3, EASE_IN_OUT],
      [1.6, 0],
    ],
    head: [
      [0, 0, EASE_IN_OUT],
      [0.6, 14, EASE_OUT],
      [0.66, -15, EASE_OUT],
      [0.8, -13, 'linear'],
      [0.9, -15, 'linear'],
      [1.0, -13, 'linear'],
      [1.1, -14, EASE_IN_OUT],
      [1.6, 0],
    ],
    'leg-front-near': [
      [0, 0, EASE_IN_OUT],
      [0.6, -13, EASE_OUT],
      [0.66, 11, EASE_OUT],
      [0.8, 12, 'linear'],
      [0.9, 11, 'linear'],
      [1.0, 12, 'linear'],
      [1.1, 9, EASE_IN_OUT],
      [1.6, 0],
    ],
    'leg-front-far': [
      [0, 0, EASE_IN_OUT],
      [0.6, -12, EASE_OUT],
      [0.66, 9, EASE_OUT],
      [0.8, 10, 'linear'],
      [0.9, 9, 'linear'],
      [1.0, 10, 'linear'],
      [1.1, 8, EASE_IN_OUT],
      [1.6, 0],
    ],
    'leg-back-near': [
      [0, 0, EASE_IN_OUT],
      [0.6, -10, EASE_OUT],
      [0.66, -5, EASE_OUT],
      [0.8, -4, 'linear'],
      [0.9, -5, 'linear'],
      [1.0, -4, 'linear'],
      [1.1, -3, EASE_IN_OUT],
      [1.6, 0],
    ],
    'leg-back-far': [
      [0, 0, EASE_IN_OUT],
      [0.6, -10, EASE_OUT],
      [0.66, -3, EASE_OUT],
      [0.8, -2, 'linear'],
      [0.9, -3, 'linear'],
      [1.0, -2, 'linear'],
      [1.1, -2, EASE_IN_OUT],
      [1.6, 0],
    ],
  },
  translate: {
    torso: [
      [0, 0, 0, EASE_IN_OUT],
      [0.6, 4, -4, EASE_OUT],
      [0.66, 12, 2, EASE_OUT],
      [0.8, 13, 2, 'linear'],
      [0.9, 12, 1, 'linear'],
      [1.0, 13, 2, 'linear'],
      [1.1, 12, 2, EASE_IN_OUT],
      [1.6, 0, 0],
    ],
  },
  attachments: {
    head: [
      [0, 'head'],
      [0.15, 'head-talk'],
      [0.6, 'head-bark'],
      [1.3, 'head'],
    ],
    eyes: [
      [0, 'eyes-open'],
      [0.55, 'eyes-closed'],
      [1.2, 'eyes-open'],
    ],
  },
});

// proud-strut: walk but chest up (torso held at a constant +8, past the 6 deg counter threshold),
// head high (the baked ears perk with the lifted head), slower bounce. Every leg gait key is
// world gait minus 8, so the stride arcs stay plumb (world +-20/18) under the lifted chest and
// the hips never tear open.
await author({
  name: 'proud-strut',
  duration: 0.7,
  rotate: {
    'leg-front-near': [
      [0, 12, EASE_IN_OUT],
      [0.35, -28, EASE_IN_OUT],
      [0.7, 12],
    ],
    'leg-front-far': [
      [0, -28, EASE_IN_OUT],
      [0.35, 12, EASE_IN_OUT],
      [0.7, -28],
    ],
    'leg-back-near': [
      [0, -26, EASE_IN_OUT],
      [0.35, 10, EASE_IN_OUT],
      [0.7, -26],
    ],
    'leg-back-far': [
      [0, 10, EASE_IN_OUT],
      [0.35, -26, EASE_IN_OUT],
      [0.7, 10],
    ],
    torso: [[0, 8]],
    head: [
      [0, 6, EASE_IN_OUT],
      [0.35, 4, EASE_IN_OUT],
      [0.7, 6],
    ],
  },
  translate: {
    torso: [
      [0, 0, -2, EASE_OUT],
      [0.175, 0, -6, EASE_IN],
      [0.35, 0, -2, EASE_OUT],
      [0.525, 0, -6, EASE_IN],
      [0.7, 0, -2],
    ],
  },
});

// micro state animations for the player's face tracks (one attachment key each). The lip-sync
// micros keep their historical names (the player's MOUTH_MAP references them) but now swap the
// whole head, whose mouth is drawn into the muzzle; mouth-wide uses the head-bark variant, his
// loud talking mouth.
const face = async (name: string, slot: string, region: string): Promise<void> => {
  await author({ name, duration: 0.05, attachments: { [slot]: [[0, region]] } });
};
await face('mouth-closed', 'head', 'head');
await face('mouth-small', 'head', 'head-talk');
await face('mouth-wide', 'head', 'head-bark');
await face('eyes-open', 'eyes', 'eyes-open');
await face('eyes-closed', 'eyes', 'eyes-closed');
await face('eyes-worried', 'eyes', 'eyes-worried');
await author({
  name: 'blink',
  duration: 0.3,
  attachments: {
    eyes: [
      [0, 'eyes-open'],
      [0.1, 'eyes-closed'],
      [0.22, 'eyes-open'],
    ],
  },
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
