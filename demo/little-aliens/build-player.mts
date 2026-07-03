import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// esbuild is resolved from the mcp-server workspace (the demo dir is not a workspace package).
import { buildSync } from '../../packages/mcp-server/node_modules/esbuild/lib/main.js';

// Bundle the standalone Little Aliens player: esbuild the entry (runtime-web + pixi + runtime-core +
// format) to one IIFE, inline the MCP-authored rig, the effects library, and the atlas pages as data URLs,
// and emit a single self-contained index.html that runs from file:// with no server and no network.

const here = dirname(fileURLToPath(import.meta.url));
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

const gameDocument = readFileSync(join(here, 'little-aliens.rig.json'), 'utf8');
// The effects library is saved separately from the skeleton rig; the player builds a live EffectSystem
// from it to display the alienCelebration particles.
const effectsDocument = readFileSync(join(here, 'little-aliens.effects.json'), 'utf8');

const pages: Record<string, string> = {};
// The saved rig carries the (project-relative) main atlas page paths; inline each as a data URL.
const gameAtlas = JSON.parse(gameDocument).atlas as { pages: Array<{ file: string }> };
for (const page of gameAtlas.pages) {
  const bytes = readFileSync(join(here, page.file));
  pages[page.file] = `data:image/png;base64,${bytes.toString('base64')}`;
}
// Also inline the SEPARATE effects atlas pages (glow/spark/goo/ring), keyed by the project-relative page
// path the effects document references, so the player can slice particle textures from it.
const effectsAtlas = JSON.parse(effectsDocument).atlas as { pages: Array<{ file: string }> };
for (const page of effectsAtlas.pages) {
  const bytes = readFileSync(join(here, page.file));
  pages[page.file] = `data:image/png;base64,${bytes.toString('base64')}`;
}

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Little Aliens demo</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0a0e22; font-family: 'Trebuchet MS', system-ui, sans-serif; }
  #title {
    position: fixed; top: 14px; left: 50%; transform: translateX(-50%); z-index: 10;
    font: 800 34px/1 'Trebuchet MS', system-ui, sans-serif; letter-spacing: 3px;
    color: #b6ff6a; text-shadow: 0 0 14px rgba(90,230,120,0.75), 0 3px 0 #1c6f2a; pointer-events: none;
  }
  #freespins {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.6);
    z-index: 20; opacity: 0; transition: opacity 180ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
    font: 900 68px/1 'Trebuchet MS', system-ui, sans-serif; letter-spacing: 4px; text-align: center;
    color: #eaffd6; text-shadow: 0 0 26px rgba(90,240,120,0.95), 0 5px 0 #1c6f2a; pointer-events: none;
  }
  #freespins.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  #controls {
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 16px; z-index: 10;
  }
  #controls button {
    padding: 14px 44px; font: 800 20px/1 'Trebuchet MS', system-ui, sans-serif; letter-spacing: 2px;
    color: #08240d; background: linear-gradient(#c8ff8a, #58c72c); border: 2px solid #2c7a18;
    border-radius: 12px; cursor: pointer; box-shadow: 0 4px 18px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.4);
  }
  #controls button.alt { background: linear-gradient(#8ae6ff, #2ca6c7); border-color: #186c86; color: #06222b; }
  #controls button:hover { filter: brightness(1.08); }
  #controls button:disabled { filter: grayscale(0.5) brightness(0.8); cursor: default; }
</style>
</head>
<body>
<div id="title">LITTLE ALIENS</div>
<div id="freespins">FREE SPINS!</div>
<div id="controls">
  <button id="spin" type="button">SPIN</button>
  <button id="celebrate" class="alt" type="button">CELEBRATE</button>
</div>
<script>
const GAME_DOCUMENT = ${gameDocument};
const EFFECTS_DOCUMENT = ${effectsDocument};
const ATLAS_PAGES = ${JSON.stringify(pages)};
</script>
<script>${bundle}</script>
</body>
</html>`;

const out = join(here, 'player', 'index.html');
writeFileSync(out, html);
console.log(`player written: ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
