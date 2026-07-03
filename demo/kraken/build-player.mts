import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// esbuild is resolved from the mcp-server workspace (the demo dir is not a workspace package).
import { buildSync } from '../../packages/mcp-server/node_modules/esbuild/lib/main.js';

// Bundle the standalone Kraken's Hoard player: esbuild the entry (runtime-web + pixi + runtime-core +
// format) to one IIFE, inline the MCP-authored document and the atlas pages as data URLs, and emit a
// single self-contained index.html that runs from file:// with no server and no network.

const here = dirname(fileURLToPath(import.meta.url));

// The demo dir is not a workspace package, so the workspace imports resolve via explicit aliases
// (source barrels, exactly what the packages' exports maps point at) and pixi via runtime-web's link.
const repo = join(here, '..', '..');
const bundle = buildSync({
  entryPoints: [join(here, 'player', 'entry.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2022',
  logLevel: 'silent',
  alias: {
    'pixi.js': join(repo, 'packages', 'runtime-web', 'node_modules', 'pixi.js'),
    '@marionette/runtime-web': join(repo, 'packages', 'runtime-web', 'src', 'index.ts'),
    '@marionette/runtime-core': join(repo, 'packages', 'runtime-core', 'src', 'index.ts'),
    '@marionette/format/types': join(repo, 'packages', 'format', 'src', 'types.ts'),
    '@marionette/format/effects-types': join(
      repo,
      'packages',
      'format',
      'src',
      'effects',
      'types.ts',
    ),
    '@marionette/format/slot-types': join(repo, 'packages', 'format', 'src', 'slot', 'types.ts'),
    '@marionette/format/slot': join(repo, 'packages', 'format', 'src', 'slot', 'index.ts'),
    '@marionette/format/effects': join(repo, 'packages', 'format', 'src', 'effects', 'index.ts'),
    '@marionette/format': join(repo, 'packages', 'format', 'src', 'index.ts'),
  },
}).outputFiles[0]!.text;

const gameDocument = readFileSync(join(here, 'krakens-hoard.rig.json'), 'utf8');
const atlasRef = JSON.parse(readFileSync(join(here, 'atlas', 'atlas-ref.json'), 'utf8'));
const pages: Record<string, string> = {};
for (const page of atlasRef.pages) {
  const bytes = readFileSync(join(here, 'atlas', page.file));
  pages[join('atlas', page.file)] = `data:image/png;base64,${bytes.toString('base64')}`;
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Leviathan's Deep - Kraken's Hoard demo</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #04121a; }
  #celebrate {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    padding: 14px 42px; font: 700 20px/1 Georgia, serif; letter-spacing: 1px;
    color: #2b1c04; background: linear-gradient(#ffe9a8, #d9a52c); border: 2px solid #8a6516;
    border-radius: 10px; cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,0.55); z-index: 10;
  }
  #celebrate:hover { filter: brightness(1.08); }
</style>
</head>
<body>
<button id="celebrate" type="button">Celebrate</button>
<script>
const GAME_DOCUMENT = ${gameDocument};
const ATLAS_PAGES = ${JSON.stringify(pages)};
</script>
<script>${bundle}</script>
</body>
</html>`;

const out = join(here, 'player', 'index.html');
writeFileSync(out, html);
console.log(`player written: ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
