import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUNNER! vocal sound effects: animal vocals performed by Gemini TTS (quacks, barks, growls,
// whimpers) with ffmpeg post-processing (pitch, echo, distance). Physical SFX (whooshes, splashes,
// boings) are synthesized separately in gen-sfx.mts. Files: audio/sfx/<ID>.mp3.
//
// Usage: tsx gen-vocal-sfx.mts [--only id1,id2] [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'audio', 'sfx');
mkdirSync(outDir, { recursive: true });

function loadApiKey(): string {
  const envPath = join(root, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  const key = line?.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (key === undefined || key.length === 0) throw new Error('GEMINI_API_KEY missing from .env');
  return key;
}
const API_KEY = loadApiKey();
const MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts', 'gemini-2.5-flash-preview-tts'];
const FFMPEG = '/opt/homebrew/bin/ffmpeg';

interface VocalSfx {
  readonly id: string;
  readonly voice: string;
  readonly prompt: string;
  // ffmpeg audio-filter chain applied after decode (input 24 kHz mono pcm)
  readonly filters?: string;
}

// Pitch helper: asetrate up + atempo down keeps duration, raises pitch
const up = (f: number): string => `asetrate=24000*${f},aresample=44100,atempo=${(1 / f).toFixed(6)}`;
const down = (f: number): string => `asetrate=24000*${f},aresample=44100,atempo=${(1 / f).toFixed(6)}`;

const SFX: readonly VocalSfx[] = [
  {
    id: 'quack-mama',
    voice: 'Gacrux',
    prompt: 'Perform ONLY the animal sound with no words: two warm motherly duck quacks, like a cartoon mother duck greeting her babies: Quack! Quack!',
    filters: up(1.15),
  },
  {
    id: 'quack-babies',
    voice: 'Leda',
    prompt: 'Perform ONLY the animal sound with no words: three tiny adorable baby duckling peeps in a row, high and squeaky: Peep! Peep! Peep!',
    filters: up(1.45),
  },
  {
    id: 'quack-alarm',
    voice: 'Gacrux',
    prompt: 'Perform ONLY the animal sound with no words: rapid alarmed panicked duck quacking, five fast quacks rising in urgency: QuackQuackQuack! Quack! QUACK!',
    filters: up(1.2),
  },
  {
    id: 'quack-squeak',
    voice: 'Leda',
    prompt: 'Perform ONLY the animal sound with no words: one single tiny squeaky baby duckling peep, short and cute: Peep!',
    filters: up(1.5),
  },
  {
    id: 'quack-distant',
    voice: 'Gacrux',
    prompt: 'Perform ONLY the animal sound with no words: three worried duck quacks answering a call from far away: Quack! Quack! Quack!',
    filters: `${up(1.2)},lowpass=f=1800,volume=0.5,aecho=0.6:0.4:220:0.35`,
  },
  {
    id: 'mega-bark',
    voice: 'Puck',
    prompt: 'Perform ONLY the sound with no words: one single gigantic mighty cartoon dog bark, the loudest bark in the world from the smallest dog: WOOF!',
    filters: `${down(0.92)},aecho=0.8:0.55:180|320:0.45|0.28,volume=1.4`,
  },
  {
    id: 'tug-growl',
    voice: 'Puck',
    prompt: 'Perform ONLY the sound with no words: a playful determined little dog growl during a game of tug of war, sustained and rumbly but friendly: Grrrrrrrr!',
  },
  {
    id: 'strain-squeak',
    voice: 'Fenrir',
    prompt: 'Perform ONLY the sound with no words: a tiny bird straining with all its might to lift something far too heavy, squeezed grunts: Nnngh! Hnnngh!',
    filters: up(1.12),
  },
  {
    id: 'shiver-rattle',
    voice: 'Leda',
    prompt: 'Perform ONLY the sound with no words: a tiny scared dog whimpering with chattering teeth, trembling: hhh-hhh-hhh, mmmm!',
    filters: up(1.15),
  },
  {
    id: 'flap-panic',
    voice: 'Gacrux',
    prompt: 'Perform ONLY the animal sound with no words: a mother duck honk-quacking in alarm while flapping, two sharp honks: HONK! HONK!',
    filters: up(1.1),
  },
];

async function ttsPcm(item: VocalSfx): Promise<Buffer> {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: item.prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: item.voice } } },
    },
  });
  let lastError = 'no attempt';
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body },
      );
      if (res.status === 429 || res.status >= 500) {
        lastError = `${model}: HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, attempt * 10000));
        continue;
      }
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`;
        break;
      }
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
      };
      const data = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (data === undefined) {
        lastError = `${model}: no audio in response`;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return Buffer.from(data, 'base64');
    }
  }
  throw new Error(`${item.id}: ${lastError}`);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.includes('--only')
  ? new Set(String(args[args.indexOf('--only') + 1]).split(','))
  : undefined;

let generated = 0;
for (const item of SFX) {
  if (onlyArg !== undefined && !onlyArg.has(item.id)) continue;
  const out = join(outDir, `${item.id}.mp3`);
  if (existsSync(out) && !force && !(onlyArg?.has(item.id) ?? false)) continue;
  process.stdout.write(`SFX ${item.id} (${item.voice}) ... `);
  const pcm = await ttsPcm(item);
  const tmp = `${out}.pcm`;
  writeFileSync(tmp, pcm);
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 's16le', '-ar', '24000', '-ac', '1',
    '-i', tmp,
    ...(item.filters !== undefined ? ['-af', item.filters] : ['-ar', '44100']),
    '-codec:a', 'libmp3lame', '-b:a', '128k',
    out,
  ]);
  rmSync(tmp);
  console.log(`ok ${(pcm.length / 48000).toFixed(1)}s`);
  generated += 1;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`DONE: ${generated} vocal SFX -> ${outDir}`);
