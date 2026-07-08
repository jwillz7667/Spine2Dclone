import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from '../../../packages/mcp-server/node_modules/esbuild/lib/main.js';

// Bundle the GUNNER! cartoon player: esbuild the entry (runtime-web + pixi + runtime-core + format
// + cartoon data) into one IIFE and inline EVERYTHING as data URLs: six rig documents, their atlas
// pages, the props atlas, nine backgrounds (recompressed to 1080p JPEG via ffmpeg for size), and
// the full soundtrack (dialogue + SFX mp3s, music WAVs converted to mp3). The result is a single
// self-contained player/index.html that plays the whole 5-minute episode from file://.
//
// Usage: tsx build-player.mts

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '..', '..');
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const FFPROBE = '/opt/homebrew/bin/ffprobe';

const bundle = buildSync({
  entryPoints: [join(root, 'player', 'entry.ts')],
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

// ---- rigs + atlas pages ----------------------------------------------------------------------
const RIG_NAMES = ['gunner', 'luna', 'beans', 'pip', 'mama', 'duckling'] as const;
const rigs: Record<string, unknown> = {};
const pages: Record<string, string> = {};
for (const name of RIG_NAMES) {
  const rigPath = join(root, 'rigs', `${name}.rig.json`);
  const rig = JSON.parse(readFileSync(rigPath, 'utf8')) as {
    atlas: { pages: Array<{ file: string }> };
  };
  rigs[name] = rig;
  for (const page of rig.atlas.pages) {
    const rel = page.file.startsWith('atlas/') ? page.file : `atlas/${name}/${page.file}`;
    page.file = rel;
    if (pages[rel] === undefined) {
      const bytes = readFileSync(join(root, rel));
      pages[rel] = `data:image/png;base64,${bytes.toString('base64')}`;
    }
  }
}

// props atlas
const propsAtlas = JSON.parse(
  readFileSync(join(root, 'atlas', 'props', 'atlas-ref.json'), 'utf8'),
) as {
  pages: Array<{ file: string }>;
};
for (const page of propsAtlas.pages) {
  const rel = page.file.startsWith('atlas/') ? page.file : `atlas/props/${page.file}`;
  page.file = rel;
  const bytes = readFileSync(join(root, rel));
  pages[rel] = `data:image/png;base64,${bytes.toString('base64')}`;
}

// ---- backgrounds (recompress to 1080p jpeg, cached) --------------------------------------------
const bgCache = join(root, 'source', 'bg', '.jpeg-cache');
mkdirSync(bgCache, { recursive: true });
const backgrounds: Record<string, string> = {};
for (const file of readdirSync(join(root, 'source', 'bg'))) {
  if (!file.endsWith('.png')) continue;
  const id = basename(file, '.png');
  const src = join(root, 'source', 'bg', file);
  const dst = join(bgCache, `${id}.jpg`);
  if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
    execFileSync(FFMPEG, [
      '-y',
      '-loglevel',
      'error',
      '-i',
      src,
      '-vf',
      'scale=1920:1080',
      '-q:v',
      '4',
      dst,
    ]);
  }
  backgrounds[id] = `data:image/jpeg;base64,${readFileSync(dst).toString('base64')}`;
}

// ---- audio ---------------------------------------------------------------------------------------
const audio: Record<string, string> = {};
const durations: Record<string, number> = {};
function probe(file: string): number {
  const out = execFileSync(FFPROBE, [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ])
    .toString()
    .trim();
  return Number(out);
}
function addAudioDir(dir: string, toMp3: boolean): void {
  if (!existsSync(dir)) return;
  const mp3Cache = join(dir, '.mp3-cache');
  if (toMp3) mkdirSync(mp3Cache, { recursive: true });
  for (const file of readdirSync(dir)) {
    if (file.startsWith('.')) continue;
    const id = file.replace(/\.(mp3|wav)$/, '');
    const src = join(dir, file);
    if (file.endsWith('.mp3')) {
      audio[id] = `data:audio/mpeg;base64,${readFileSync(src).toString('base64')}`;
      durations[id] = probe(src);
    } else if (file.endsWith('.wav') && toMp3) {
      const dst = join(mp3Cache, `${id}.mp3`);
      if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
        execFileSync(FFMPEG, [
          '-y',
          '-loglevel',
          'error',
          '-i',
          src,
          '-codec:a',
          'libmp3lame',
          '-b:a',
          '128k',
          dst,
        ]);
      }
      audio[id] = `data:audio/mpeg;base64,${readFileSync(dst).toString('base64')}`;
      durations[id] = probe(dst);
    }
  }
}
addAudioDir(join(root, 'audio', 'dialogue'), false);
addAudioDir(join(root, 'audio', 'sfx'), false);
addAudioDir(join(root, 'audio', 'music'), true);

// ---- emit ------------------------------------------------------------------------------------------
const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>GUNNER! Episode 1: Big Heart at Willow Creek</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
  canvas { display: block; }
</style>
</head>
<body>
<script>
const RIGS = ${JSON.stringify(rigs)};
const ATLAS_PAGES = ${JSON.stringify(pages)};
const BACKGROUNDS = ${JSON.stringify(backgrounds)};
const AUDIO = ${JSON.stringify(audio)};
const AUDIO_DURATIONS = ${JSON.stringify(durations)};
const PROPS_ATLAS = ${JSON.stringify(propsAtlas)};
</script>
<script>${bundle}</script>
</body>
</html>
`;

const out = join(root, 'player', 'index.html');
writeFileSync(out, html);
const mb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(1);
console.log(`player/index.html written (${mb} MB)`);
console.log(`  rigs: ${Object.keys(rigs).join(', ')}`);
console.log(`  atlas pages: ${Object.keys(pages).length}`);
console.log(`  backgrounds: ${Object.keys(backgrounds).length}`);
console.log(`  audio cues: ${Object.keys(audio).length}`);
