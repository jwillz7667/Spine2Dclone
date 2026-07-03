import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeFileStore, runAtlasPipeline } from '../../apps/editor/src/main/atlas/index';

// Demo step 1: pack the Kraken's Hoard source art into deterministic atlas pages + an AtlasRef, using
// the EXACT pipeline the editor's Assets panel runs (import -> trim -> pack -> emit). The AtlasRef JSON
// is consumed by the authoring script (step 2), the page PNGs by the render step (step 3).

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, 'source');
const outputDir = join(here, 'atlas');
mkdirSync(outputDir, { recursive: true });

const atlas = await runAtlasPipeline({
  sourceDir,
  outputDir,
  fileStore: createNodeFileStore(),
});

writeFileSync(join(outputDir, 'atlas-ref.json'), JSON.stringify(atlas, null, 2));
const regions = atlas.pages.flatMap((page) => page.regions.map((r) => r.name));
console.log(
  `packed ${regions.length} regions onto ${atlas.pages.length} page(s): ${atlas.pages
    .map((p) => `${p.file} ${p.width}x${p.height}`)
    .join(', ')}`,
);
console.log(`regions: ${regions.sort().join(', ')}`);
