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

// KRAKEN'S HOARD: the full-game authoring demonstration. Every document mutation below goes through the
// LITERAL MCP tool handlers (TOOLS by name, Zod-validated input, Law 2 commands on the live History),
// exactly what an external LLM speaks over stdio; this script is that client minus the JSON-RPC framing.

const here = dirname(fileURLToPath(import.meta.url));
const deps: ToolDeps = {
  sessions: new SessionRegistry(),
  files: createNodeFileStore(here),
};
const byName = new Map(TOOLS.map((t) => [t.name, t]));

async function call(name: string, input: Record<string, unknown>): Promise<any> {
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

// ---- 1. document + atlas -------------------------------------------------------------------------
const { documentId } = await call('document.new', { name: 'krakens-hoard' });
const atlasRef = JSON.parse(readFileSync(join(here, 'atlas', 'atlas-ref.json'), 'utf8'));
// Page files are project-relative for the render tool; the atlas dir holds them.
atlasRef.pages = atlasRef.pages.map((p: any) => ({ ...p, file: join('atlas', p.file) }));
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
const LAYOUT: string[][] = [
  ['blue_ruby', 'chest', 'kraken', 'pearl', 'green_ruby'],
  ['trident', 'wild', 'princess', 'scatter', 'orb'],
  ['purple_ruby', 'snake', 'treasure', 'diamond', 'bonus'],
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
    await call('attach.region.add', {
      documentId,
      slotId,
      name: symbol,
      path: symbol,
      ...sized(symbol, CELL),
    });
    cellBones[r]!.push(boneId);
    cellSlots[r]!.push(slotId);
  }
}

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

// ---- 6. animations -------------------------------------------------------------------------------
// 'idle': a gentle 2s loop; every cell breathes, the kraken sways.
const { animationId: idle } = await call('anim.create', { documentId, name: 'idle', duration: 2 });
for (let r = 0; r < 3; r += 1) {
  for (let c = 0; c < 5; c += 1) {
    const phase = (r * 5 + c) % 2 === 0 ? 1.045 : 1.03;
    const b = cellBones[r]![c]!;
    await call('kf.set', {
      documentId,
      animationId: idle,
      channel: 'scale',
      boneId: b,
      time: 0,
      value: { x: 1, y: 1 },
    });
    await call('kf.set', {
      documentId,
      animationId: idle,
      channel: 'scale',
      boneId: b,
      time: 1,
      value: { x: phase, y: phase },
    });
    await call('kf.set', {
      documentId,
      animationId: idle,
      channel: 'scale',
      boneId: b,
      time: 2,
      value: { x: 1, y: 1 },
    });
  }
}
for (const [t, angle] of [
  [0, 0],
  [0.5, 5],
  [1.5, -5],
  [2, 0],
] as const) {
  await call('kf.set', {
    documentId,
    animationId: idle,
    channel: 'rotate',
    boneId: krakenTip,
    time: t,
    value: { angle },
  });
}

// 'win_celebration': 2s. The middle row pops and flashes gold, the banner pops in, the kraken's
// tentacles WAVE via a deform timeline on the weighted mesh (world-space offsets, post-skin).
const { animationId: win } = await call('anim.create', {
  documentId,
  name: 'win_celebration',
  duration: 2,
});
for (let c = 0; c < 5; c += 1) {
  const b = cellBones[1]![c]!;
  const s = cellSlots[1]![c]!;
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'scale',
    boneId: b,
    time: 0,
    value: { x: 1, y: 1 },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'scale',
    boneId: b,
    time: 0.5,
    value: { x: 1.22, y: 1.22 },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'scale',
    boneId: b,
    time: 1.2,
    value: { x: 1.08, y: 1.08 },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'scale',
    boneId: b,
    time: 2,
    value: { x: 1, y: 1 },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'color',
    slotId: s,
    time: 0,
    value: { color: WHITE },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'color',
    slotId: s,
    time: 0.5,
    value: { color: { r: 1, g: 0.92, b: 0.55, a: 1 } },
  });
  await call('kf.set', {
    documentId,
    animationId: win,
    channel: 'color',
    slotId: s,
    time: 2,
    value: { color: WHITE },
  });
}
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'color',
  slotId: bannerSlot,
  time: 0,
  value: { color: { ...WHITE, a: 0 } },
});
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'color',
  slotId: bannerSlot,
  time: 0.35,
  value: { color: WHITE },
});
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'color',
  slotId: bannerSlot,
  time: 1.8,
  value: { color: WHITE },
});
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'color',
  slotId: bannerSlot,
  time: 2,
  value: { color: { ...WHITE, a: 0 } },
});

// Deform wave: sinusoidal world-space offsets across the kraken mesh (bigger toward the bottom, where
// the tentacles live). offsets are [dx, dy] per logical vertex.
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
  [0.5, 9, 1.2],
  [1.0, 4, 2.6],
  [1.5, 9, 4.0],
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
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'rotate',
  boneId: krakenTip,
  time: 0.5,
  value: { angle: 10 },
});
await call('kf.set', {
  documentId,
  animationId: win,
  channel: 'rotate',
  boneId: krakenTip,
  time: 1.5,
  value: { angle: -10 },
});

// ---- 7. effects: the mega-win bundle -------------------------------------------------------------
await call('effect.setAtlas', { documentId, atlas: atlasRef });
const { effectId: coins } = await call('effect.create', { documentId, name: 'pearlShower' });
await call('effect.layer.add', {
  documentId,
  effectId: coins,
  kind: 'emitter',
  region: 'pearl',
  blendMode: 'normal',
});
const { effectId: rays } = await call('effect.create', {
  documentId,
  name: 'orbBurst',
  blendMode: 'additive',
});
await call('effect.layer.add', {
  documentId,
  effectId: rays,
  kind: 'emitter',
  region: 'orb',
  blendMode: 'additive',
});
await call('bundle.create', { documentId, name: 'megaWin' });
await call('bundle.item.add', {
  documentId,
  name: 'megaWin',
  item: { effect: coins, startOffset: 0, anchorRole: 'gridCenter', seedSalt: 1 },
});
await call('bundle.item.add', {
  documentId,
  name: 'megaWin',
  item: { effect: rays, startOffset: 0.2, anchorRole: 'gridCenter', seedSalt: 2 },
});

// ---- 8. slot composition -------------------------------------------------------------------------
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
for (const symbol of SYMBOLS) {
  await call('slot.symbol.map', {
    documentId,
    symbolId: symbol,
    animSet: { skeletonRef: 'krakens-hoard', idle: 'idle', land: 'idle', win: 'win_celebration' },
    skeletonAnimationNames: ['idle', 'win_celebration'],
  });
}
await call('slot.winseq.create', { documentId, name: 'megaWinSequence' });
await call('slot.flow.createState', { documentId, name: 'freeSpins' });

// ---- 9. save + render ----------------------------------------------------------------------------
await call('document.save', { documentId, path: 'krakens-hoard.rig.json' });
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

const validation = await call('document.validate', { documentId });
console.log('validate:', JSON.stringify(validation));
console.log('DONE: krakens-hoard authored end to end over the MCP tool surface.');
