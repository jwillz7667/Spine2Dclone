import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUNNER! dialogue generation via Gemini TTS. The ElevenLabs pipeline (gen-dialogue.mts) is the
// intended production path but the provided key has zero remaining credits, so this script renders
// the same 44-line manifest through Gemini TTS preview models instead. Per-character prebuilt
// voices plus natural-language acting direction; Beans gets a post pitch-up for extra squeak.
// PCM 24 kHz mono from the API is converted to mp3 with ffmpeg. Files: audio/dialogue/<ID>.mp3.
//
// Usage: tsx gen-dialogue-gemini.mts [--only G-101,B-201] [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'audio', 'dialogue');
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

interface Cast {
  readonly voice: string;
  readonly direction: string;
  readonly pitchUp: number; // 1.0 = none; 1.12 = 12 percent squeakier, duration preserved
}

const CASTING: Record<string, Cast> = {
  gunner: {
    voice: 'Puck',
    direction: 'warmly, boyish and brave, like a friendly young cartoon hero dog in a kids show',
    pitchUp: 1.0,
  },
  pip: {
    voice: 'Fenrir',
    direction: 'very fast and excitable, high energy, like a tiny motormouth cartoon pigeon delivering breaking news',
    pitchUp: 1.08,
  },
  luna: {
    voice: 'Kore',
    direction: 'calmly, with dry clever wit, like a smart and cool cartoon cat inventor',
    pitchUp: 1.0,
  },
  beans: {
    voice: 'Leda',
    direction: 'in a tiny squeaky jittery voice, like a very small nervous but brave cartoon chihuahua',
    pitchUp: 1.12,
  },
};

interface Line {
  readonly id: string;
  readonly char: keyof typeof CASTING;
  readonly text: string;
  readonly acting?: string; // per-line override of the emotional direction
}

const LINES: readonly Line[] = [
  { id: 'G-101', char: 'gunner', text: 'Little legs... BIG heart!', acting: 'as a proud excited heroic catchphrase' },
  { id: 'B-201', char: 'beans', text: 'I got it! I got it! ...I do NOT got it!', acting: 'straining hard then suddenly panicking' },
  { id: 'G-202', char: 'gunner', text: 'Nice try, Beans! One more round?', acting: 'laughing kindly' },
  { id: 'L-203', char: 'luna', text: 'Or... you could test my new invention! The Fetch-O-Matic three thousand!', acting: 'sly and proud, presenting an invention' },
  { id: 'P-204', char: 'pip', text: 'Big news, big news! Mama Duck\'s eggs hatched! Three fuzzy ducklings, right down at Willow Creek!' },
  { id: 'G-205', char: 'gunner', text: 'Ducklings? Picnic at the creek! Team Gunner, roll out!', acting: 'rallying the team, joyful battle cry' },
  { id: 'B-206', char: 'beans', text: 'Wait for meee!', acting: 'yelling while running, fading' },
  { id: 'L-301', char: 'luna', text: 'Aww. They are so tiny.', acting: 'melting with cuteness' },
  { id: 'G-302', char: 'gunner', text: 'Almost as tiny as Beans.', acting: 'gentle teasing chuckle' },
  { id: 'B-303', char: 'beans', text: 'Hey! I am travel sized.', acting: 'mock offended, proud' },
  { id: 'P-304', char: 'pip', text: 'Uh oh. Uh OH! The ducklings are floating away!', acting: 'rising panic' },
  { id: 'G-305', char: 'gunner', text: 'Duckling overboard! Team, follow that float!', acting: 'urgent heroic command' },
  { id: 'P-401', char: 'pip', text: 'I got this! Pigeon power!', acting: 'overconfident battle cry' },
  { id: 'P-402', char: 'pip', text: 'Too... heavy... abort, abort!', acting: 'straining with all his might, squeezed voice' },
  { id: 'G-403', char: 'gunner', text: 'You okay, Pip?', acting: 'caring, slightly amused' },
  { id: 'P-404', char: 'pip', text: 'The float is fine. My pride? Soggy.', acting: 'deadpan, deflated' },
  { id: 'L-405', char: 'luna', text: 'The creek bends at the old log! We can cut them off!', acting: 'quick thinking, urgent' },
  { id: 'L-501', char: 'luna', text: 'Fetch-O-Matic... launch the bridge!', acting: 'dramatic launch command' },
  { id: 'B-502', char: 'beans', text: 'A bridge! I will grab them! Tiny paws, do not fail me now!', acting: 'summoning all his courage' },
  { id: 'B-503', char: 'beans', text: 'So. Much. Water.', acting: 'frozen in terror, tiny whisper' },
  { id: 'G-504', char: 'gunner', text: 'Hang on, buddy! I got you!', acting: 'urgent shout while lunging' },
  { id: 'L-505', char: 'luna', text: 'They are heading for Fog Hollow. We will never see them in there!', acting: 'grim warning' },
  { id: 'G-601', char: 'gunner', text: 'I can\'t see a thing.', acting: 'hushed, peering into fog' },
  { id: 'B-602', char: 'beans', text: 'This is all my fault. My paws were too tiny. My bark is too loud...', acting: 'sad, sniffling, voice trembling' },
  { id: 'G-603', char: 'gunner', text: 'Too loud? Beans... that\'s it! Your bark is not too loud. It is JUST loud enough!', acting: 'realization blooming into excitement' },
  { id: 'B-604', char: 'beans', text: 'You mean it?', acting: 'small hopeful voice' },
  { id: 'G-605', char: 'gunner', text: 'Bark, buddy. Bark like you mean it!', acting: 'warm encouraging coach' },
  { id: 'L-606', char: 'luna', text: 'The quacks came from the left! This way!', acting: 'sharp and certain' },
  { id: 'P-701', char: 'pip', text: 'Waterfall! Dead ahead!', acting: 'alarmed lookout shout' },
  { id: 'G-702', char: 'gunner', text: 'Team Gunner, huddle up! Luna, tie your best knot. Pip, fly the loop to the float. Beans, count us down!', acting: 'calm confident leader giving the plan fast' },
  { id: 'L-703', char: 'luna', text: 'Double sailor knot. Done!', acting: 'crisp, professional' },
  { id: 'P-704', char: 'pip', text: 'Loop is on! Go, go, go!', acting: 'mission accomplished, urgent' },
  { id: 'B-705', char: 'beans', text: 'Three! Two! One! TUG!', acting: 'shouting a countdown at the top of his tiny lungs' },
  { id: 'G-706', char: 'gunner', text: 'Little legs...', acting: 'through gritted teeth, straining with everything he has' },
  { id: 'G-707', char: 'gunner', text: 'BIG! HEART!', acting: 'a mighty triumphant roar' },
  { id: 'L-708', char: 'luna', text: 'You did it, Gunner!', acting: 'overjoyed, breathless' },
  { id: 'G-709', char: 'gunner', text: 'WE did it. All of us.', acting: 'humble and warm, catching his breath' },
  { id: 'P-801', char: 'pip', text: 'Extra, extra! Team Gunner saves the day!', acting: 'newspaper crier, celebratory' },
  { id: 'B-802', char: 'beans', text: 'And nobody got soggy! ...Except Pip.', acting: 'giggling' },
  { id: 'P-803', char: 'pip', text: 'My pride dried fast.', acting: 'happy deadpan' },
  { id: 'G-804', char: 'gunner', text: 'See? You do not have to be big to save the day. You just have to be there for your friends.', acting: 'the warm gentle moral of the story' },
  { id: 'L-805', char: 'luna', text: 'And always bring a good rope.', acting: 'wry topper' },
  { id: 'G-806', char: 'gunner', text: 'Aww. Welcome to the team.', acting: 'melting, chuckling softly' },
  { id: 'G-901', char: 'gunner', text: 'See you next time, pups!', acting: 'bright sign-off with a wink in the voice' },
];

async function ttsPcm(line: Line): Promise<Buffer> {
  const cast = CASTING[line.char];
  const direction = line.acting !== undefined ? `${cast.direction}, ${line.acting}` : cast.direction;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Say ${direction}: ${line.text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cast.voice } } },
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
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
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
  throw new Error(`${line.id}: ${lastError}`);
}

function pcmToMp3(pcm: Buffer, out: string, pitchUp: number): void {
  const tmp = `${out}.pcm`;
  writeFileSync(tmp, pcm);
  const filters =
    pitchUp !== 1.0
      ? ['-af', `asetrate=24000*${pitchUp},aresample=44100,atempo=${(1 / pitchUp).toFixed(6)}`]
      : ['-ar', '44100'];
  execFileSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-f', 's16le', '-ar', '24000', '-ac', '1',
    '-i', tmp,
    ...filters,
    '-codec:a', 'libmp3lame', '-b:a', '128k',
    out,
  ]);
  rmSync(tmp);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyArg = args.includes('--only')
  ? new Set(String(args[args.indexOf('--only') + 1]).split(','))
  : undefined;

let generated = 0;
let skipped = 0;
for (const line of LINES) {
  if (onlyArg !== undefined && !onlyArg.has(line.id)) continue;
  const out = join(outDir, `${line.id}.mp3`);
  if (existsSync(out) && !force && !(onlyArg?.has(line.id) ?? false)) {
    skipped += 1;
    continue;
  }
  process.stdout.write(`TTS ${line.id} (${line.char}/${CASTING[line.char].voice}) ... `);
  const pcm = await ttsPcm(line);
  pcmToMp3(pcm, out, CASTING[line.char].pitchUp);
  console.log(`ok ${(pcm.length / 48000).toFixed(1)}s`);
  generated += 1;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`DONE: ${generated} generated, ${skipped} skipped -> ${outDir}`);
