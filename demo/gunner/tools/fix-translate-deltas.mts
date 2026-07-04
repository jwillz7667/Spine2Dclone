import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createNodeFileStore,
  SessionRegistry,
  TOOLS,
  type ToolDeps,
} from '../../../packages/mcp-server/src/index';

// Repair pass: translate keyframes are DELTAS added to the bone's setup position (see
// runtime-core sample.ts), but several author scripts keyed ABSOLUTE positions. Visually invisible
// under fit-content renders (whole-skeleton offset) but in the player each animation would carry a
// different baked offset, making actors jump between animations. This script re-keys every
// translate keyframe as key minus setup, through the same kf.set command surface (Law 2), and
// saves the rig back.
//
// Usage: tsx fix-translate-deltas.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const deps: ToolDeps = { sessions: new SessionRegistry(), files: createNodeFileStore(root) };
const byName = new Map(TOOLS.map((t) => [t.name, t]));
async function call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = byName.get(name);
  if (tool === undefined) throw new Error(`no such tool: ${name}`);
  return (await tool.handler(deps, input)) as Record<string, unknown>;
}

interface RigJson {
  bones: Array<{ name: string; x: number; y: number }>;
  animations: Record<
    string,
    { bones?: Record<string, { translate?: Array<{ time: number; value: { x: number; y: number }; curve?: unknown }> }> }
  >;
}

const THRESHOLD = 60; // |key| beyond this on either axis marks an absolute-keyed timeline

for (const rig of ['gunner', 'luna', 'beans', 'pip']) {
  const path = `rigs/${rig}.rig.json`;
  const json = JSON.parse(readFileSync(join(root, path), 'utf8')) as RigJson;
  const setup = new Map(json.bones.map((b) => [b.name, { x: b.x, y: b.y }]));

  const { documentId } = (await call('document.open', { path })) as { documentId: string };
  const { animations } = (await call('anim.list', { documentId })) as {
    animations: Array<{ id: string; name: string }>;
  };
  const animIdByName = new Map(animations.map((a) => [a.name, a.id]));
  const { bones } = (await call('bone.list', { documentId })) as {
    bones: Array<{ id: string; name: string }>;
  };
  const boneIdByName = new Map(bones.map((b) => [b.name, b.id]));

  let fixed = 0;
  for (const [animName, animData] of Object.entries(json.animations)) {
    for (const [boneName, channels] of Object.entries(animData.bones ?? {})) {
      const keys = channels.translate ?? [];
      if (keys.length === 0) continue;
      // A timeline is absolute-keyed when any key lands near the setup position magnitude.
      const isAbsolute = keys.some(
        (k) => Math.abs(k.value.x) > THRESHOLD || Math.abs(k.value.y) > THRESHOLD,
      );
      if (!isAbsolute) continue;
      const s = setup.get(boneName);
      if (s === undefined) continue;
      for (const k of keys) {
        await call('kf.set', {
          documentId,
          animationId: animIdByName.get(animName),
          channel: 'translate',
          boneId: boneIdByName.get(boneName),
          time: k.time,
          value: { x: k.value.x - s.x, y: k.value.y - s.y },
          ...(k.curve !== undefined ? { curve: k.curve } : {}),
        });
        fixed += 1;
      }
    }
  }
  await call('document.save', { documentId, path });
  console.log(`${rig}: ${fixed} translate keys re-keyed as deltas`);
}
