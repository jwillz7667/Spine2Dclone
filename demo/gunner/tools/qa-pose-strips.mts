import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';
import { decodePng, encodePng, type DecodedImage } from './cut-core.mts';

// Joint-integrity QA: renders every locomotion/gesture animation of a rig at several phases and
// composites them into one contact strip per character. A limb whose pivot or overlap is wrong
// shows an open gap at its socket in the mid-swing cells; freeze-frame spot checks miss this.
//
// Usage: tsx qa-pose-strips.mts [char ...]   (default: all six)

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
  return (await tool.handler(deps, input)) as Record<string, unknown>;
}

const ANIMS: Record<string, string[]> = {
  gunner: ['idle', 'walk', 'run', 'tug-strain', 'hero-pose', 'yank-grab'],
  luna: ['idle', 'walk', 'run', 'crank-gadget', 'point', 'tie-knot'],
  beans: ['idle', 'walk', 'run', 'freeze-shiver', 'mega-bark', 'proud-strut'],
  pip: ['hover', 'fly', 'walk', 'talk', 'land', 'lift-strain'],
  mama: ['idle', 'waddle', 'alarm-flap', 'talk-quack'],
  duckling: ['bob-float', 'waddle', 'quack-hop', 'imprint-pose', 'panic'],
};
const PHASES = [0.05, 0.3, 0.55, 0.8];
const CELL = 300;

function blank(w: number, h: number): DecodedImage {
  return { width: w, height: h, rgba: new Uint8Array(w * h * 4) };
}
function blit(dst: DecodedImage, src: DecodedImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y += 1) {
    const dy = y + oy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x += 1) {
      const dx = x + ox;
      if (dx < 0 || dx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const di = (dy * dst.width + dx) * 4;
      dst.rgba[di] = src.rgba[si]!;
      dst.rgba[di + 1] = src.rgba[si + 1]!;
      dst.rgba[di + 2] = src.rgba[si + 2]!;
      dst.rgba[di + 3] = src.rgba[si + 3]!;
    }
  }
}

const chars = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(ANIMS);
mkdirSync(join(root, 'renders', 'qa-strips'), { recursive: true });

for (const char of chars) {
  const anims = ANIMS[char];
  if (anims === undefined) throw new Error(`unknown character ${char}`);
  const { documentId } = (await call('document.open', { path: `rigs/${char}.rig.json` })) as {
    documentId: string;
  };
  const { animations } = (await call('anim.list', { documentId })) as {
    animations: Array<{ name: string; duration: number }>;
  };
  const durByName = new Map(animations.map((a) => [a.name, a.duration]));

  const sheet = blank(CELL * PHASES.length, CELL * anims.length);
  for (let row = 0; row < anims.length; row += 1) {
    const anim = anims[row]!;
    const dur = durByName.get(anim);
    if (dur === undefined) {
      console.log(`  ${char}/${anim}: MISSING`);
      continue;
    }
    for (let col = 0; col < PHASES.length; col += 1) {
      const res = (await call('render_frame', {
        documentId,
        animation: anim,
        time: PHASES[col]! * dur,
        width: CELL,
        height: CELL,
        fit: 'content',
        background: { r: 0.96, g: 0.95, b: 0.92, a: 1 },
      })) as { pngBase64: string };
      blit(sheet, decodePng(Buffer.from(res.pngBase64, 'base64')), col * CELL, row * CELL);
    }
  }
  const out = join(root, 'renders', 'qa-strips', `${char}.png`);
  writeFileSync(out, encodePng(sheet));
  console.log(`${char}: ${anims.length}x${PHASES.length} strip -> renders/qa-strips/${char}.png`);
}
