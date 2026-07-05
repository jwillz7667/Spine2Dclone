import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// Anatomy-orientation QA probes for the Luna rig (renders/luna-fix2). Full-body pose probes for the
// limb-direction defects plus head-closeup probes (explicit world-rect fit) for the ear/goggles
// stack and the mouth-variant anchor. Read-only against rigs/luna.rig.json except for the
// slot.activeAttachment swaps used to photograph each mouth variant (restored, never saved).
//
// Usage: tsx qa-luna-fix2.mts [outSubdir]   (default: luna-fix2)

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const deps: ToolDeps = { sessions: new SessionRegistry(), files: createNodeFileStore(root) };
const byName = new Map(TOOLS.map((t) => [t.name, t]));
async function call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = byName.get(name);
  if (tool === undefined) throw new Error(`no such tool: ${name}`);
  return (await tool.handler(deps, input)) as Record<string, unknown>;
}

const outDir = process.argv[2] ?? 'luna-fix2';
mkdirSync(join(root, 'renders', outDir), { recursive: true });

const { documentId } = (await call('document.open', { path: 'rigs/luna.rig.json' })) as {
  documentId: string;
};

type Fit = 'content' | { x: number; y: number; w: number; h: number };
// world rect around the head + ears (head spans x -157..1, y -305..-175; ears reach y -352)
const HEAD_RECT: Fit = { x: -175, y: -375, w: 200, h: 220 };

async function shoot(name: string, opts: { animation?: string; time?: number; fit?: Fit }): Promise<void> {
  const res = (await call('render_frame', {
    documentId,
    ...(opts.animation !== undefined ? { animation: opts.animation, time: opts.time } : {}),
    width: 512,
    height: 512,
    fit: opts.fit ?? 'content',
    background: { r: 0.94, g: 0.93, b: 0.9, a: 1 },
  })) as { pngBase64: string };
  writeFileSync(join(root, 'renders', outDir, `${name}.png`), Buffer.from(res.pngBase64, 'base64'));
  console.log(`rendered renders/${outDir}/${name}.png`);
}

await shoot('setup', {});
await shoot('idle-t0.5', { animation: 'idle', time: 0.5 });
await shoot('walk-t0.22', { animation: 'walk', time: 0.22 });
await shoot('run-t0.25', { animation: 'run', time: 0.25 });
await shoot('crank-t0.1', { animation: 'crank-gadget', time: 0.1 });
await shoot('crank-t0.3', { animation: 'crank-gadget', time: 0.3 });
await shoot('crank-t0.5', { animation: 'crank-gadget', time: 0.5 });
await shoot('crank-t0.7', { animation: 'crank-gadget', time: 0.7 });
await shoot('point-t0.7', { animation: 'point', time: 0.7 });
await shoot('tie-knot-t0.3', { animation: 'tie-knot', time: 0.3 });
await shoot('head-setup', { fit: HEAD_RECT });

// one head closeup per mouth variant, swapped via slot.activeAttachment and restored after
const { slots } = (await call('slot.list', { documentId })) as {
  slots: Array<{ id: string; name: string }>;
};
const mouthSlot = slots.find((s) => s.name === 'mouth');
if (mouthSlot === undefined) throw new Error('no mouth slot');
for (const variant of ['mouth-closed', 'mouth-small', 'mouth-smile']) {
  await call('slot.activeAttachment', { documentId, slotId: mouthSlot.id, attachment: variant });
  await shoot(`head-${variant}`, { fit: HEAD_RECT });
}
await call('slot.activeAttachment', { documentId, slotId: mouthSlot.id, attachment: 'mouth-closed' });
console.log('luna fix2 probes done.');
