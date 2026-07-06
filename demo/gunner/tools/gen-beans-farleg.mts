import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropRegion, decodePng, encodePng, opaqueBounds } from './cut-core.mts';

// BEANS far hind leg: the rig's leg-back-far slot used to REUSE the near-leg region behind a
// neutral gray slot tint (0.72), which desaturated the cream fur into the wrong-looking
// gray-green sliver between the hind legs. The artist's actual far-side treatment is a darker
// warm TAN (see leg-front-far, piece-08), and beans-parts piece-09 is the unused far
// HINDQUARTERS drawn exactly that way: rump plus both far hind legs in far-side tan. This
// deterministic cutter carves the FORWARD (left, paw pointing left like every other leg) leg out
// of piece-09 with its haunch, leaving the raw vertical cut edge on the rump side, where the
// torso and the near haunch always cover it.
//
// Usage: tsx gen-beans-farleg.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = decodePng(readFileSync(join(root, 'source-layers', 'beans-parts', 'piece-09.png')));
const bounds = opaqueBounds(src);
if (bounds === null) throw new Error('piece-09 is empty');

// The two legs separate below the crotch at x ~279..281 (measured alpha runs); a vertical cut at
// 281 keeps the whole left leg and its haunch and only crosses rump fill above the crotch.
const CUT_X = 281;

// blank everything right of the cut, then take the opaque bounds of what remains
const work: { width: number; height: number; rgba: Uint8Array } = {
  width: src.width,
  height: src.height,
  rgba: new Uint8Array(src.rgba),
};
for (let y = 0; y < work.height; y += 1) {
  for (let x = CUT_X + 1; x < work.width; x += 1) work.rgba[(y * work.width + x) * 4 + 3] = 0;
}
const legBounds = opaqueBounds(work);
if (legBounds === null) throw new Error('cut produced an empty image');
const piece = cropRegion(work, legBounds, 4);
const out = join(root, 'source-layers', 'beans', 'leg-back-far.png');
writeFileSync(out, encodePng(piece));

// Placement numbers for author-beans.mts, derived at piece-09's native scale so the far leg
// matches the near haunch (piece-07, trim 807 px -> targetH 46: s = 0.057 rig px per piece px).
const S = 46 / 807;
const trimW = legBounds.maxX - legBounds.minX + 1;
const trimH = legBounds.maxY - legBounds.minY + 1;
const targetH = trimH * S;
// paw bottom sits at the trim bottom, so offsetY = |boneWorldY| - targetH/2 with the bone at
// world y -38 puts the paw exactly on the ground
const offsetY = 38 - targetH / 2;
console.log(`leg-back-far: file ${piece.width}x${piece.height} trim ${trimW}x${trimH}`);
console.log(`  suggested transform: targetH ${targetH.toFixed(1)}, attach y ${offsetY.toFixed(1)} (x art-directed, start near -1)`);
