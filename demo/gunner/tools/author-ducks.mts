import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../../../packages/atlas-pack/src/index';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// MAMA DUCK + DUCKLING rig and animation authoring. Every mutation goes through the literal MCP
// tool handlers (Law 2: commands on the live History), the same surface an external AI speaks
// over stdio. Two documents are authored sequentially: mama (faces RIGHT natively; the player
// mirrors her when needed) and the duckling (faces LEFT; the player spawns three tinted
// instances of this one rig). World units are pixels, y-down, root at the ground under the body.
// Rotation sign: positive = clockwise on screen (y-down). Facing RIGHT (mama): positive
// bill-bottom rotation drops the jaw tip (opens). Facing LEFT (duckling): the jaw tip is on the
// negative-x side, so NEGATIVE rotation opens the mouth; DUCK_OPEN carries that sign.
// Timeline semantics (runtime-core sample.ts): translate keys are DELTAS added to the setup
// position, rotate keys are degrees added to the setup rotation (all setup rotations here are 0),
// scale keys are multipliers on the setup scale. Never key a bone's setup position as a translate
// value; key 0 for "at setup".
// Placement numbers were measured off source/refs/*.png and the source-layers pieces (the layer
// pieces map 1:1 onto the refs), then art-directed by inspecting renders/mama-*.png and
// renders/duckling-*.png.
//
// Usage: tsx author-ducks.mts

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
const EASE_OUT_BACK: Bezier = { type: 'bezier', cx1: 0.34, cy1: 1.56, cx2: 0.64, cy2: 1 };
type Curve = 'linear' | 'stepped' | Bezier;

// ---- shared atlas + rig helpers, parameterized per document -------------------------------------
interface AtlasJson {
  pages: Array<{
    file: string;
    width: number;
    height: number;
    regions: Array<{
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      rotated: boolean;
      offsetX: number;
      offsetY: number;
      originalW: number;
      originalH: number;
    }>;
  }>;
}

function loadAtlas(character: string): AtlasJson {
  const atlas = JSON.parse(
    readFileSync(join(root, 'atlas', character, 'atlas-ref.json'), 'utf8'),
  ) as AtlasJson;
  // atlas-ref page files are relative to atlas/<character>/; the FileStore root is demo/gunner.
  for (const page of atlas.pages) {
    if (!page.file.startsWith('atlas/')) page.file = `atlas/${character}/${page.file}`;
  }
  return atlas;
}

interface SlotSpec {
  readonly slot: string;
  readonly bone: string;
  readonly region: string;
  readonly x: number;
  readonly y: number;
  readonly targetH: number;
  readonly scaleX?: number;
  readonly rotation?: number;
}

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

interface Rig {
  readonly documentId: string;
  bone(name: string, parent: string | null, x: number, y: number, length?: number): Promise<string>;
  regionSlot(spec: SlotSpec): Promise<string>;
  addVariant(slot: string, region: string, targetH: number, x: number, y: number): Promise<void>;
  setActive(slot: string, attachment: string | null): Promise<void>;
  author(spec: AnimSpec): Promise<void>;
  render(name: string, animation?: string, time?: number): Promise<void>;
}

async function makeRig(name: string, atlas: AtlasJson): Promise<Rig> {
  const { documentId } = (await call('document.new', { name })) as { documentId: string };
  await call('atlas.set', { documentId, atlas });

  const regionSize = new Map<string, { w: number; h: number }>();
  for (const page of atlas.pages)
    for (const r of page.regions) regionSize.set(r.name, { w: r.w, h: r.h });
  const sized = (region: string, targetH: number): { width: number; height: number } => {
    const s = regionSize.get(region);
    if (s === undefined)
      throw new Error(`unknown region ${region}; have: ${[...regionSize.keys()].join(', ')}`);
    return { width: (s.w / s.h) * targetH, height: targetH };
  };

  const boneIds = new Map<string, string>();
  const slotIds = new Map<string, string>();

  return {
    documentId,
    async bone(boneName, parent, x, y, length = 30) {
      const parentId = parent !== null ? boneIds.get(parent) : undefined;
      if (parent !== null && parentId === undefined)
        throw new Error(`unknown parent bone ${parent}`);
      const res = (await call('bone.create', {
        documentId,
        name: boneName,
        ...(parentId !== undefined ? { parentId } : {}),
        x,
        y,
        length,
      })) as { boneId: string };
      boneIds.set(boneName, res.boneId);
      return res.boneId;
    },
    async regionSlot(spec) {
      const boneId = boneIds.get(spec.bone);
      if (boneId === undefined) throw new Error(`unknown bone ${spec.bone}`);
      const { slotId } = (await call('slot.create', { documentId, name: spec.slot, boneId })) as {
        slotId: string;
      };
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
    },
    async addVariant(slot, region, targetH, x, y) {
      await call('attach.region.add', {
        documentId,
        slotId: slotIds.get(slot),
        name: region,
        path: region,
        x,
        y,
        ...sized(region, targetH),
      });
    },
    async setActive(slot, attachment) {
      await call('slot.activeAttachment', { documentId, slotId: slotIds.get(slot), attachment });
    },
    async author(spec) {
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
            boneId: boneIds.get(boneName),
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
            boneId: boneIds.get(boneName),
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
            boneId: boneIds.get(boneName),
            time,
            value: { x, y },
            ...(curve !== undefined ? { curve } : {}),
          });
        }
      }
      for (const [slotName, keys] of Object.entries(spec.attachments ?? {})) {
        for (const [time, attachment] of keys) {
          await call('kf.attachment.set', {
            documentId,
            animationId,
            slotId: slotIds.get(slotName),
            time,
            name: attachment,
          });
        }
      }
    },
    async render(fileName, animation, time) {
      const res = (await call('render_frame', {
        documentId,
        ...(animation !== undefined ? { animation, time } : {}),
        width: 512,
        height: 512,
        fit: 'content',
        background: { r: 0.86, g: 0.89, b: 0.91, a: 1 },
      })) as { pngBase64: string };
      writeFileSync(join(root, 'renders', `${fileName}.png`), Buffer.from(res.pngBase64, 'base64'));
      console.log(`rendered renders/${fileName}.png`);
    },
  };
}

mkdirSync(join(root, 'renders'), { recursive: true });

// ==================================================================================================
// MAMA DUCK. Faces RIGHT. Stands ~260 px tall (ref 854x1424 at world scale 0.1877, ground at the
// feet, x origin under the body center between the feet).
// ==================================================================================================
{
  const mama = await makeRig('mama', loadAtlas('mama'));

  // Bones. Parents precede children; locals are world deltas (no bone rotation at setup).
  await mama.bone('root', null, 0, 0, 10);
  await mama.bone('body', 'root', 0, -110, 90);
  await mama.bone('neck', 'body', 25, -38, 45); // base of the neck column, top of the scarf
  await mama.bone('head', 'neck', -2, -41, 40); // head pivots at the neck top
  await mama.bone('bill-top', 'head', 2.5, -15, 25);
  await mama.bone('bill-bottom', 'head', -3.5, -6, 20); // jaw hinge at the mouth corner
  await mama.bone('wing', 'body', 15, -8, 50); // shoulder pivot; the wing folds over the body side

  // Slots back-to-front (creation order = draw order): body, neck, head, bills, wing on top.
  await mama.regionSlot({
    slot: 'body',
    bone: 'body',
    region: 'body',
    x: -5.8,
    y: 26.4,
    targetH: 168,
  });
  await mama.regionSlot({
    slot: 'neck',
    bone: 'neck',
    region: 'neck',
    x: 0.2,
    y: -31.3,
    targetH: 116,
  });
  await mama.regionSlot({
    slot: 'head',
    bone: 'head',
    region: 'head',
    x: -0.7,
    y: -32.6,
    targetH: 86,
  });
  await mama.regionSlot({
    slot: 'bill-top',
    bone: 'bill-top',
    region: 'bill-top',
    x: 20.4,
    y: 1.9,
    targetH: 40,
  });
  await mama.regionSlot({
    slot: 'bill-bottom',
    bone: 'bill-bottom',
    region: 'bill-bottom',
    x: 27,
    y: 5.5,
    targetH: 30,
  });
  await mama.regionSlot({
    slot: 'wing',
    bone: 'wing',
    region: 'wing',
    x: -32.6,
    y: 21.7,
    targetH: 76,
  });

  // idle: gentle breathe plus a soft head bob, 2.0s loop.
  await mama.author({
    name: 'idle',
    duration: 2.0,
    translate: {
      body: [
        [0, 0, 0, EASE_IN_OUT],
        [1.0, 0, -3.5, EASE_IN_OUT],
        [2.0, 0, 0],
      ],
    },
    rotate: {
      head: [
        [0, 0, EASE_IN_OUT],
        [1.1, 2.5, EASE_IN_OUT],
        [2.0, 0],
      ],
      neck: [
        [0, 0, EASE_IN_OUT],
        [1.0, 1.5, EASE_IN_OUT],
        [2.0, 0],
      ],
      wing: [
        [0, 0, EASE_IN_OUT],
        [1.0, -2, EASE_IN_OUT],
        [2.0, 0],
      ],
    },
  });

  // waddle: the body rocks +-6 deg, y bobs twice per cycle, the neck counter-sways, 0.8s loop.
  await mama.author({
    name: 'waddle',
    duration: 0.8,
    rotate: {
      body: [
        [0, -6, EASE_IN_OUT],
        [0.4, 6, EASE_IN_OUT],
        [0.8, -6],
      ],
      neck: [
        [0, 4, EASE_IN_OUT],
        [0.4, -4, EASE_IN_OUT],
        [0.8, 4],
      ],
      head: [
        [0, 2, EASE_IN_OUT],
        [0.4, -2, EASE_IN_OUT],
        [0.8, 2],
      ],
    },
    translate: {
      body: [
        [0, 0, 0, EASE_OUT],
        [0.2, 0, -4, EASE_IN],
        [0.4, 0, 0, EASE_OUT],
        [0.6, 0, -4, EASE_IN],
        [0.8, 0, 0],
      ],
    },
  });

  // alarm-flap: the wing beats +-40 every 0.15s, the neck extends up 15px, the head shakes,
  // the body hops, the bill hangs open in alarm, 0.9s loop.
  await mama.author({
    name: 'alarm-flap',
    duration: 0.9,
    rotate: {
      wing: [
        [0, -40, EASE_IN_OUT],
        [0.15, 40, EASE_IN_OUT],
        [0.3, -40, EASE_IN_OUT],
        [0.45, 40, EASE_IN_OUT],
        [0.6, -40, EASE_IN_OUT],
        [0.75, 40, EASE_IN_OUT],
        [0.9, -40],
      ],
      head: [
        [0, -6, EASE_IN_OUT],
        [0.15, 6, EASE_IN_OUT],
        [0.3, -6, EASE_IN_OUT],
        [0.45, 6, EASE_IN_OUT],
        [0.6, -6, EASE_IN_OUT],
        [0.75, 6, EASE_IN_OUT],
        [0.9, -6],
      ],
      'bill-bottom': [[0, 14]],
    },
    translate: {
      neck: [[0, 0, -15]],
      body: [
        [0, 0, 0, EASE_OUT],
        [0.075, 0, -6, EASE_IN],
        [0.15, 0, 0, EASE_OUT],
        [0.225, 0, -6, EASE_IN],
        [0.3, 0, 0, EASE_OUT],
        [0.375, 0, -6, EASE_IN],
        [0.45, 0, 0, EASE_OUT],
        [0.525, 0, -6, EASE_IN],
        [0.6, 0, 0, EASE_OUT],
        [0.675, 0, -6, EASE_IN],
        [0.75, 0, 0, EASE_OUT],
        [0.825, 0, -6, EASE_IN],
        [0.9, 0, 0],
      ],
    },
  });

  // talk-quack: the bill opens and closes twice, with a tiny head nod, 0.5s loop.
  await mama.author({
    name: 'talk-quack',
    duration: 0.5,
    rotate: {
      'bill-bottom': [
        [0, 0, EASE_OUT],
        [0.12, 20, EASE_IN_OUT],
        [0.25, 2, EASE_OUT],
        [0.37, 18, EASE_IN_OUT],
        [0.5, 0],
      ],
      head: [
        [0, 0, EASE_IN_OUT],
        [0.12, 1.5, EASE_IN_OUT],
        [0.25, 0.3, EASE_IN_OUT],
        [0.37, 1.2, EASE_IN_OUT],
        [0.5, 0],
      ],
    },
  });

  // Micro state animations for the player's face tracks. Mama has no eye swaps, so blink is a
  // 0.05s no-op (a single zero translate key on root) the player can call on everyone.
  await mama.author({ name: 'mouth-closed', duration: 0.05, rotate: { 'bill-bottom': [[0, 0]] } });
  await mama.author({ name: 'mouth-wide', duration: 0.05, rotate: { 'bill-bottom': [[0, 22]] } });
  await mama.author({ name: 'blink', duration: 0.05, translate: { root: [[0, 0, 0]] } });

  await call('document.save', { documentId: mama.documentId, path: 'rigs/mama.rig.json' });
  const mamaValid = (await call('document.validate', { documentId: mama.documentId })) as {
    ok: boolean;
    errors: unknown[];
  };
  console.log(`mama document.validate: ok=${mamaValid.ok}`);
  if (!mamaValid.ok) throw new Error(`mama invalid: ${JSON.stringify(mamaValid.errors)}`);

  await mama.render('mama-setup');
  await mama.render('mama-waddle', 'waddle', 0.3);
  await mama.render('mama-flap', 'alarm-flap', 0.4);
  await mama.render('mama-quack', 'talk-quack', 0.12);
}

// ==================================================================================================
// DUCKLING. Faces LEFT. Stands ~110 px tall, round and tiny (ref 469x775 at world scale 0.1444).
// The head has the eyes baked in; an 'eyes' overlay slot carries the closed-lid art for
// sleeping/happy moments (default active attachment null so the baked eyes show). The packed
// eyes-closed piece is a mostly-empty 472x900 canvas holding one lash arc plus sheet-cut junk, and
// the bare arc cannot HIDE the dark baked-in eye under it. rebuildLidPixels rebuilds a 150x150
// window of the page around the arc: junk wiped, a feathered skin-colored ellipse (sampled from the
// head art on the same page) to cover the eye, and the arc recomposited over it, centered. Both lid
// regions ('eyes-closed' for the near eye, 'eye-lid-far' for the far one) crop to that window; the
// far eye gets its own overlay slot and the micro animations key both slots together, so players
// only ever call the animations. The rebuild reads the arc from the untouched source layer, so
// re-running it is idempotent.
// ==================================================================================================

const LID_WINDOW = { x: 0, y: 434, size: 150 } as const; // page-space crop shared by both lid regions
const LID_CENTER = { x: 75, y: 509 } as const; // ellipse + arc center inside the page

function rebuildLidPixels(): void {
  const pagePath = join(root, 'atlas', 'duckling', 'atlas-0.png');
  const page = decodePng(new Uint8Array(readFileSync(pagePath)));
  const layer = decodePng(
    new Uint8Array(readFileSync(join(root, 'source-layers', 'duckling', 'eyes-closed.png'))),
  );

  // Skin color: average opaque head pixels in a ring around the near eye. Head region sits at page
  // (0, 1327) with a (2, 3) trim offset; head-canvas (cx, cy) => page (cx - 2, cy - 3 + 1327).
  const ring: Array<[number, number]> = [
    [119, 195],
    [195, 195],
    [157, 153],
    [157, 237],
    [130, 165],
    [184, 165],
    [130, 227],
    [184, 227],
  ];
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const [cx, cy] of ring) {
    const idx = ((cy - 3 + 1327) * page.width + (cx - 2)) * 4;
    const alpha = page.rgba[idx + 3]!;
    const red = page.rgba[idx]!;
    if (alpha < 200 || red < 140) continue; // skip transparent or eye-dark samples
    r += red;
    g += page.rgba[idx + 1]!;
    b += page.rgba[idx + 2]!;
    n += 1;
  }
  if (n === 0) throw new Error('lid skin sampling found no opaque head pixels');
  r = Math.round(r / n);
  g = Math.round(g / n);
  b = Math.round(b / n);

  // Wipe the whole lid window, then lay down the feathered skin ellipse.
  const { x: wx, y: wy, size } = LID_WINDOW;
  // The opaque core (radius * FEATHER_START) must out-size the baked eye INCLUDING its dark
  // outline, or the outline peeks around the patch as a ring.
  const RX = 52,
    RY = 68,
    FEATHER_START = 0.86;
  for (let y = wy; y < wy + size; y += 1) {
    for (let x = wx; x < wx + size; x += 1) {
      const idx = (y * page.width + x) * 4;
      const dx = (x - LID_CENTER.x) / RX;
      const dy = (y - LID_CENTER.y) / RY;
      const d = Math.sqrt(dx * dx + dy * dy);
      let alpha = 0;
      if (d <= FEATHER_START) alpha = 255;
      else if (d < 1) {
        const t = (1 - d) / (1 - FEATHER_START);
        alpha = Math.round(255 * t * t * (3 - 2 * t)); // smoothstep falloff
      }
      page.rgba[idx] = alpha > 0 ? r : 0;
      page.rgba[idx + 1] = alpha > 0 ? g : 0;
      page.rgba[idx + 2] = alpha > 0 ? b : 0;
      page.rgba[idx + 3] = alpha;
    }
  }

  // Recomposite the lash arc from the source layer (canvas bbox x 3..119, y 483..535, center
  // (61, 509)), shifted so its center lands on LID_CENTER. Straight-alpha source-over.
  const shiftX = LID_CENTER.x - 61;
  for (let cy = 470; cy <= 548; cy += 1) {
    for (let cx = 0; cx <= 130; cx += 1) {
      const sIdx = (cy * layer.width + cx) * 4;
      const sa = layer.rgba[sIdx + 3]! / 255;
      if (sa === 0) continue;
      const px = cx + shiftX;
      const py = cy;
      if (px < wx || px >= wx + size || py < wy || py >= wy + size) continue;
      const dIdx = (py * page.width + px) * 4;
      const da = page.rgba[dIdx + 3]! / 255;
      const outA = sa + da * (1 - sa);
      for (let c = 0; c < 3; c += 1) {
        const sc = layer.rgba[sIdx + c]!;
        const dc = page.rgba[dIdx + c]!;
        page.rgba[dIdx + c] = outA === 0 ? 0 : Math.round((sc * sa + dc * da * (1 - sa)) / outA);
      }
      page.rgba[dIdx + 3] = Math.round(outA * 255);
    }
  }

  writeFileSync(pagePath, encodePng(page));
  console.log(`rebuilt duckling lid pixels in atlas-0.png (skin rgb ${r},${g},${b})`);
}

{
  rebuildLidPixels();

  const atlas = loadAtlas('duckling');
  const page = atlas.pages[0]!;
  const eyesClosed = page.regions.find((reg) => reg.name === 'eyes-closed');
  if (eyesClosed === undefined) throw new Error('duckling atlas missing eyes-closed region');
  Object.assign(eyesClosed, {
    x: LID_WINDOW.x,
    y: LID_WINDOW.y,
    w: LID_WINDOW.size,
    h: LID_WINDOW.size,
    offsetX: 0,
    offsetY: 0,
    originalW: LID_WINDOW.size,
    originalH: LID_WINDOW.size,
  });
  page.regions.push({ ...eyesClosed, name: 'eye-lid-far' });

  const duck = await makeRig('duckling', atlas);

  // Bones.
  await duck.bone('root', null, 0, 0, 10);
  await duck.bone('body', 'root', 0, -50, 40);
  await duck.bone('head', 'body', -18, -12, 30); // top-front of the body (front = negative x)
  await duck.bone('bill-top', 'head', 0, -7, 12);
  await duck.bone('bill-bottom', 'head', 0.7, -4, 10); // jaw hinge at the face
  await duck.bone('wing-nub', 'body', 11, -4, 18); // far shoulder pivot, inside the silhouette

  // Slots back-to-front: the wing-nub is the FAR wing and draws BEHIND the body (the body art
  // already has the near wing painted on its side); then body, head, jaw BEHIND the top bill
  // (so the closed mouth hides the dark maw and only the orange lip peeks below), then the eye
  // overlays on top. The far wing tip peeks up-rear over the back line.
  await duck.regionSlot({
    slot: 'wing-nub',
    bone: 'wing-nub',
    region: 'wing-nub',
    x: 10,
    y: 0,
    targetH: 22,
    rotation: -12,
  });
  await duck.regionSlot({
    slot: 'body',
    bone: 'body',
    region: 'body',
    x: -5.9,
    y: 19.6,
    targetH: 61,
  });
  await duck.regionSlot({
    slot: 'head',
    bone: 'head',
    region: 'head',
    x: -4.1,
    y: -18.3,
    targetH: 54,
  });
  await duck.regionSlot({
    slot: 'bill-bottom',
    bone: 'bill-bottom',
    region: 'bill-bottom',
    x: -7.4,
    y: 1.5,
    targetH: 11,
  });
  await duck.regionSlot({
    slot: 'bill-top',
    bone: 'bill-top',
    region: 'bill-top',
    x: -1.5,
    y: -0.8,
    targetH: 16.5,
  });
  await duck.regionSlot({
    slot: 'eyes',
    bone: 'head',
    region: 'eyes-closed',
    x: -7.2,
    y: -17.4,
    targetH: 13,
  });
  await duck.regionSlot({
    slot: 'eyes-far',
    bone: 'head',
    region: 'eye-lid-far',
    x: 13.9,
    y: -19.3,
    targetH: 11,
  });
  // Baked-in eyes show by default; the lid overlays are keyed on by animations only.
  await duck.setActive('eyes', null);
  await duck.setActive('eyes-far', null);

  const DUCK_OPEN = -1; // facing left: negative bill-bottom rotation drops the jaw tip

  // bob-float: floating on water, one slow bob +-5 with a +-3 sway, 1.6s loop.
  await duck.author({
    name: 'bob-float',
    duration: 1.6,
    translate: {
      body: [
        [0, 0, 5, EASE_IN_OUT],
        [0.8, 0, -5, EASE_IN_OUT],
        [1.6, 0, 5],
      ],
    },
    rotate: {
      body: [
        [0, -3, EASE_IN_OUT],
        [0.8, 3, EASE_IN_OUT],
        [1.6, -3],
      ],
      head: [
        [0, 2, EASE_IN_OUT],
        [0.8, -2, EASE_IN_OUT],
        [1.6, 2],
      ],
    },
  });

  // waddle: quick side-to-side roll +-8 with little y hops, 0.5s loop.
  await duck.author({
    name: 'waddle',
    duration: 0.5,
    rotate: {
      body: [
        [0, -8, EASE_IN_OUT],
        [0.25, 8, EASE_IN_OUT],
        [0.5, -8],
      ],
      head: [
        [0, 3, EASE_IN_OUT],
        [0.25, -3, EASE_IN_OUT],
        [0.5, 3],
      ],
    },
    translate: {
      body: [
        [0, 0, 0, EASE_OUT],
        [0.125, 0, -4, EASE_IN],
        [0.25, 0, 0, EASE_OUT],
        [0.375, 0, -4, EASE_IN],
        [0.5, 0, 0],
      ],
    },
  });

  // quack-hop: crouch, hop up 22px with the bill wide open, land with a squash, settle. One-shot.
  await duck.author({
    name: 'quack-hop',
    duration: 0.6,
    translate: {
      body: [
        [0, 0, 0, EASE_IN],
        [0.12, 0, 8, EASE_OUT],
        [0.3, 0, -22, EASE_IN],
        [0.45, 0, 0, EASE_OUT],
        [0.6, 0, 0],
      ],
    },
    scale: {
      body: [
        [0, 1, 1, EASE_IN],
        [0.12, 1.08, 0.9, EASE_OUT],
        [0.3, 0.92, 1.1, EASE_IN],
        [0.45, 1.15, 0.85, EASE_OUT],
        [0.6, 1, 1],
      ],
    },
    rotate: {
      'bill-bottom': [
        [0, 0, EASE_OUT],
        [0.12, DUCK_OPEN * 2, EASE_OUT],
        [0.25, DUCK_OPEN * 24, EASE_IN_OUT],
        [0.45, DUCK_OPEN * 18, EASE_IN],
        [0.6, 0],
      ],
      head: [
        [0, 0, EASE_OUT],
        [0.3, 4, EASE_IN_OUT],
        [0.45, -3, EASE_OUT],
        [0.6, 0],
      ],
      'wing-nub': [
        [0, 0, EASE_OUT],
        [0.12, 20, EASE_IN_OUT],
        [0.3, -30, EASE_IN_OUT],
        [0.45, 10, EASE_OUT],
        [0.6, 0],
      ],
    },
  });

  // imprint-pose: chest puff, head up 8 deg, wing-nub raised like a salute, hold. One-shot.
  await duck.author({
    name: 'imprint-pose',
    duration: 1.0,
    scale: {
      body: [
        [0, 1, 1, EASE_OUT_BACK],
        [0.35, 1.1, 1.08, EASE_IN_OUT],
        [1.0, 1.1, 1.08],
      ],
    },
    rotate: {
      head: [
        [0, 0, EASE_OUT_BACK],
        [0.35, 8, EASE_IN_OUT],
        [1.0, 8],
      ],
      'wing-nub': [
        [0, 0, EASE_OUT_BACK],
        [0.35, -75, EASE_IN_OUT],
        [1.0, -75],
      ],
    },
    translate: {
      body: [
        [0, 0, 0, EASE_OUT],
        [0.35, 0, -3, EASE_IN_OUT],
        [1.0, 0, -3],
      ],
    },
  });

  // panic: fast trembles with the bill open and the wing fluttering, 0.5s loop (waterfall drift).
  await duck.author({
    name: 'panic',
    duration: 0.5,
    translate: {
      body: [
        [0, -2, 0, 'linear'],
        [0.0625, 2, 0, 'linear'],
        [0.125, -2, 0, 'linear'],
        [0.1875, 2, 0, 'linear'],
        [0.25, -2, 0, 'linear'],
        [0.3125, 2, 0, 'linear'],
        [0.375, -2, 0, 'linear'],
        [0.4375, 2, 0, 'linear'],
        [0.5, -2, 0],
      ],
    },
    rotate: {
      'bill-bottom': [[0, DUCK_OPEN * 20]],
      head: [
        [0, -5, EASE_IN_OUT],
        [0.125, 5, EASE_IN_OUT],
        [0.25, -5, EASE_IN_OUT],
        [0.375, 5, EASE_IN_OUT],
        [0.5, -5],
      ],
      'wing-nub': [
        [0, -25, EASE_IN_OUT],
        [0.125, 25, EASE_IN_OUT],
        [0.25, -25, EASE_IN_OUT],
        [0.375, 25, EASE_IN_OUT],
        [0.5, -25],
      ],
    },
  });

  // Micro state animations for the player's face tracks.
  await duck.author({ name: 'mouth-closed', duration: 0.05, rotate: { 'bill-bottom': [[0, 0]] } });
  await duck.author({
    name: 'mouth-wide',
    duration: 0.05,
    rotate: { 'bill-bottom': [[0, DUCK_OPEN * 20]] },
  });
  await duck.author({
    name: 'eyes-closed',
    duration: 0.05,
    attachments: { eyes: [[0, 'eyes-closed']], 'eyes-far': [[0, 'eye-lid-far']] },
  });
  await duck.author({
    name: 'eyes-open',
    duration: 0.05,
    attachments: { eyes: [[0, null]], 'eyes-far': [[0, null]] },
  });
  await duck.author({
    name: 'blink',
    duration: 0.3,
    attachments: {
      eyes: [
        [0, null],
        [0.1, 'eyes-closed'],
        [0.22, null],
      ],
      'eyes-far': [
        [0, null],
        [0.1, 'eye-lid-far'],
        [0.22, null],
      ],
    },
  });

  await call('document.save', { documentId: duck.documentId, path: 'rigs/duckling.rig.json' });
  const duckValid = (await call('document.validate', { documentId: duck.documentId })) as {
    ok: boolean;
    errors: unknown[];
  };
  console.log(`duckling document.validate: ok=${duckValid.ok}`);
  if (!duckValid.ok) throw new Error(`duckling invalid: ${JSON.stringify(duckValid.errors)}`);

  await duck.render('duckling-setup');
  await duck.render('duckling-bob', 'bob-float', 0.6);
  await duck.render('duckling-hop', 'quack-hop', 0.3);
  await duck.render('duckling-sleep', 'eyes-closed', 0.02);
  await duck.render('duckling-imprint', 'imprint-pose', 0.9);
  await duck.render('duckling-panic', 'panic', 0.1);
}

console.log('MAMA + DUCKLING authored.');
