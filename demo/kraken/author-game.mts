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
    const baseX = COLS[c]!;
    const baseY = ROWS[r]!;
    for (const [t, dy] of [
      [0, 0],
      [0.12, 14],
      [0.24, -5],
      [0.35, 0],
    ] as const) {
      await call('kf.set', {
        documentId,
        animationId: reelStopBounce,
        channel: 'translate',
        boneId: b,
        time: t,
        value: { x: baseX, y: baseY + dy },
      });
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
  for (const [t, scale] of [
    [0, 1],
    [0.2, 1.35],
    [0.5, 1],
  ] as const) {
    await call('kf.set', {
      documentId,
      animationId: scatterLand,
      channel: 'scale',
      boneId: b,
      time: t,
      value: { x: scale, y: scale },
    });
  }
  for (const [t, color] of [
    [0, WHITE],
    [0.15, { r: 1, g: 0.98, b: 0.8, a: 1 }],
    [0.5, WHITE],
  ] as const) {
    await call('kf.set', {
      documentId,
      animationId: scatterLand,
      channel: 'color',
      slotId: s,
      time: t,
      value: { color },
    });
  }
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
// Tune both emitters for the ~400px source art: the default startScale renders each particle at the
// region's full base size (an additive orb stack saturates to white). Scale pearls to coin size with
// downward gravity so the shower rains; scale orbs small with a fast fade-out so the burst sparkles
// instead of blooming. setField takes the WHOLE rebuilt body (the field name is the coalesce key).
async function tuneEmitter(
  effectId: string,
  patch: (body: any) => void,
  field: string,
): Promise<void> {
  const detail = await call('effect.get', { documentId, effectId });
  const layer = detail.effect.layers[0];
  const body = structuredClone(layer.body);
  patch(body);
  await call('effect.layer.setField', { documentId, effectId, layerId: layer.id, field, body });
}
await tuneEmitter(
  coins,
  (body) => {
    body.startScale = { min: 0.09, max: 0.16 };
    body.gravity = { x: 0, y: 720 };
    body.startSpeed = { min: 260, max: 520 };
    body.emissionAngle = { min: 200, max: 340 };
  },
  'startScale',
);
await tuneEmitter(
  rays,
  (body) => {
    body.startScale = { min: 0.05, max: 0.1 };
    body.startSpeed = { min: 120, max: 420 };
    body.lifetime = { min: 0.35, max: 0.7 };
  },
  'startScale',
);

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
// the pearlShower particles live, exactly as the composed render frame solves them headlessly.
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

// The two v2 showcase frames use render_frame's effect-overlay param: the megaWin bundle (pearlShower +
// orbBurst) composited ON TOP of the skeleton at the grid center. Frame 05 is the big-win moment (the win
// animation at its scale peak, the shower a beat later at 0.8s); frame 06 is the bonus intro at t=1.6
// (both banners in), with a lighter shower for celebration.
const GRID_CENTER = { x: 0, y: ROWS[1]! };
await render('05-composed-bigwin.png', {
  animation: 'win_celebration',
  time: 0.5,
  effect: { bundle: 'megaWin', seed: 1, time: 0.8, anchors: { gridCenter: GRID_CENTER } },
});
await render('06-bonus-intro.png', {
  animation: 'bonus_intro',
  time: 1.6,
  effect: { bundle: 'megaWin', seed: 7, time: 1.0, anchors: { gridCenter: GRID_CENTER } },
});

const validation = await call('document.validate', { documentId });
console.log('validate:', JSON.stringify(validation));
console.log('DONE: krakens-hoard authored end to end over the MCP tool surface.');
