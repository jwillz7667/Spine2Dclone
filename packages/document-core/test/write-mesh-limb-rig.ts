import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMeshLimbRig, MESH_LIMB_RIG_DURATION } from './mesh-limb-rig-builder';

// One-off asset writer (run via tsx) for the WP-2.11 committed mesh-limb-rig. It builds the rig through
// document-core commands, then writes the validated/hashed SkeletonDocument as pretty JSON plus the
// sample-time list under packages/conformance/assets/mesh-limb-rig. The committed JSON is reproducible
// from the builder (the document-core DoD test asserts this), so this script is the convenience writer,
// not the source of truth.

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root (pnpm-workspace.yaml) not found');
    dir = parent;
  }
  return dir;
}

const dir = join(repoRoot(), 'packages', 'conformance', 'assets', 'mesh-limb-rig');
mkdirSync(dir, { recursive: true });

const rig = buildMeshLimbRig();
writeFileSync(join(dir, 'mesh-limb-rig.rig.json'), `${JSON.stringify(rig, null, 2)}\n`, 'utf8');

// Sample times spanning [0, duration] plus one past-duration value (clamp check). The midpoint (0.5) is
// the deform/IK peak; 0 and duration are the seamless-loop endpoints; the trailing 1.25 > duration pins
// the per-channel clamp.
const D = MESH_LIMB_RIG_DURATION;
const times = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, D, D + 0.25];
writeFileSync(join(dir, 'mesh-limb-rig.sample-list.json'), `${JSON.stringify(times)}\n`, 'utf8');

console.log(`wrote ${dir}: hash=${rig.hash}`);
