import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUNNER! dialogue generation: renders every screenplay line through ElevenLabs TTS (eleven_v3,
// the expressive model; audio tags like [excited] shape the acting). Files land in
// audio/dialogue/<ID>.mp3. A line that already exists is skipped unless --force or --only, so
// re-runs only fill gaps and retakes stay cheap. Credit usage is printed before and after
// (free tier: 10,000 lifetime credits, 1 credit per character including tags).
//
// Usage: tsx gen-dialogue.mts [--only G-101,B-201] [--force] [--dry]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'audio', 'dialogue');
mkdirSync(outDir, { recursive: true });

function loadApiKey(): string {
  const envPath = join(root, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('ELEVENLABS_API_KEY='));
  const key = line?.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  if (key === undefined || key.length === 0) throw new Error('ELEVENLABS_API_KEY missing from .env');
  return key;
}
const API_KEY = loadApiKey();

// Casting (ElevenLabs premade voices)
const VOICES = {
  gunner: 'bIHbv24MWmeRgasZH58o', // Will: relaxed young optimist, warm and boyish
  pip: 'TX3LPaxmHKxFdv7VOQHJ', // Liam: energetic, fast, bright
  luna: 'EXAVITQu4vr4xnSDxMaL', // Sarah: calm, confident, lightly amused
  beans: 'FGY2WhTYpPnrIDTdsKH5', // Laura: quirky, excitable, small-dog energy
} as const;
type CharacterId = keyof typeof VOICES;

interface Line {
  readonly id: string;
  readonly char: CharacterId;
  readonly text: string; // v3 audio tags in [brackets] are acting direction, they are not spoken
  readonly stability?: 0 | 0.5 | 1; // v3 accepts exactly these three
}

const LINES: readonly Line[] = [
  { id: 'G-101', char: 'gunner', text: '[excited] Little legs... BIG heart!' },
  { id: 'B-201', char: 'beans', text: 'I got it! I got it! ...I do NOT got it!' },
  { id: 'G-202', char: 'gunner', text: '[laughs] Nice try, Beans! One more round?' },
  { id: 'L-203', char: 'luna', text: 'Or... you could test my new invention! The Fetch-O-Matic three thousand!' },
  { id: 'P-204', char: 'pip', text: '[excited] Big news, big news! Mama Duck\'s eggs hatched! Three fuzzy ducklings, right down at Willow Creek!' },
  { id: 'G-205', char: 'gunner', text: 'Ducklings? Picnic at the creek! Team Gunner, roll out!' },
  { id: 'B-206', char: 'beans', text: 'Wait for meee!' },
  { id: 'L-301', char: 'luna', text: 'Aww. They are so tiny.' },
  { id: 'G-302', char: 'gunner', text: '[chuckles] Almost as tiny as Beans.' },
  { id: 'B-303', char: 'beans', text: 'Hey! I am travel sized.' },
  { id: 'P-304', char: 'pip', text: 'Uh oh. Uh OH! The ducklings are floating away!' },
  { id: 'G-305', char: 'gunner', text: 'Duckling overboard! Team, follow that float!' },
  { id: 'P-401', char: 'pip', text: 'I got this! Pigeon power!' },
  { id: 'P-402', char: 'pip', text: '[straining] Too... heavy... abort, abort!', stability: 0 },
  { id: 'G-403', char: 'gunner', text: 'You okay, Pip?' },
  { id: 'P-404', char: 'pip', text: 'The float is fine. My pride? Soggy.' },
  { id: 'L-405', char: 'luna', text: 'The creek bends at the old log! We can cut them off!' },
  { id: 'L-501', char: 'luna', text: 'Fetch-O-Matic... launch the bridge!' },
  { id: 'B-502', char: 'beans', text: 'A bridge! I will grab them! Tiny paws, do not fail me now!' },
  { id: 'B-503', char: 'beans', text: '[whispers] So. Much. Water.', stability: 0 },
  { id: 'G-504', char: 'gunner', text: 'Hang on, buddy! I got you!' },
  { id: 'L-505', char: 'luna', text: 'They are heading for Fog Hollow. We will never see them in there!' },
  { id: 'G-601', char: 'gunner', text: 'I can\'t see a thing.' },
  { id: 'B-602', char: 'beans', text: '[sad] This is all my fault. My paws were too tiny. My bark is too loud...', stability: 0 },
  { id: 'G-603', char: 'gunner', text: 'Too loud? Beans... that\'s it! Your bark is not too loud. It is JUST loud enough!' },
  { id: 'B-604', char: 'beans', text: 'You mean it?' },
  { id: 'G-605', char: 'gunner', text: 'Bark, buddy. Bark like you mean it!' },
  { id: 'L-606', char: 'luna', text: 'The quacks came from the left! This way!' },
  { id: 'P-701', char: 'pip', text: 'Waterfall! Dead ahead!' },
  { id: 'G-702', char: 'gunner', text: 'Team Gunner, huddle up! Luna, tie your best knot. Pip, fly the loop to the float. Beans, count us down!' },
  { id: 'L-703', char: 'luna', text: 'Double sailor knot. Done!' },
  { id: 'P-704', char: 'pip', text: 'Loop is on! Go, go, go!' },
  { id: 'B-705', char: 'beans', text: '[shouting] Three! Two! One! TUG!', stability: 0 },
  { id: 'G-706', char: 'gunner', text: '[straining] Little legs...', stability: 0 },
  { id: 'G-707', char: 'gunner', text: '[shouting] BIG! HEART!', stability: 0 },
  { id: 'L-708', char: 'luna', text: '[excited] You did it, Gunner!' },
  { id: 'G-709', char: 'gunner', text: 'WE did it. All of us.' },
  { id: 'P-801', char: 'pip', text: 'Extra, extra! Team Gunner saves the day!' },
  { id: 'B-802', char: 'beans', text: '[laughs] And nobody got soggy! ...Except Pip.' },
  { id: 'P-803', char: 'pip', text: 'My pride dried fast.' },
  { id: 'G-804', char: 'gunner', text: 'See? You do not have to be big to save the day. You just have to be there for your friends.' },
  { id: 'L-805', char: 'luna', text: 'And always bring a good rope.' },
  { id: 'G-806', char: 'gunner', text: '[chuckles] Aww. Welcome to the team.' },
  { id: 'G-901', char: 'gunner', text: '[excited] See you next time, pups!' },
];

async function credits(): Promise<{ used: number; limit: number }> {
  const res = await fetch('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': API_KEY } });
  const json = (await res.json()) as { subscription: { character_count: number; character_limit: number } };
  return { used: json.subscription.character_count, limit: json.subscription.character_limit };
}

async function tts(line: Line): Promise<Buffer> {
  const body = {
    text: line.text,
    model_id: 'eleven_v3',
    voice_settings: { stability: line.stability ?? 0.5, use_speaker_boost: true },
  };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICES[line.char]}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`${line.id}: HTTP ${res.status} ${detail}`);
  }
  throw new Error(`${line.id}: retries exhausted`);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const dry = args.includes('--dry');
const onlyArg = args.includes('--only')
  ? new Set(String(args[args.indexOf('--only') + 1]).split(','))
  : undefined;

const totalChars = LINES.reduce((n, l) => n + l.text.length, 0);
console.log(`manifest: ${LINES.length} lines, ${totalChars} characters`);
const before = await credits();
console.log(`credits before: ${before.used}/${before.limit}`);
if (dry) process.exit(0);

let generated = 0;
let skipped = 0;
for (const line of LINES) {
  if (onlyArg !== undefined && !onlyArg.has(line.id)) continue;
  const out = join(outDir, `${line.id}.mp3`);
  if (existsSync(out) && !force && !(onlyArg?.has(line.id) ?? false)) {
    skipped += 1;
    continue;
  }
  process.stdout.write(`TTS ${line.id} (${line.char}, ${line.text.length} ch) ... `);
  const mp3 = await tts(line);
  writeFileSync(out, mp3);
  console.log(`ok ${(mp3.length / 1024).toFixed(0)}KB`);
  generated += 1;
  await new Promise((r) => setTimeout(r, 400));
}
const after = await credits();
console.log(
  `DONE: ${generated} generated, ${skipped} skipped. credits: ${after.used}/${after.limit} (spent ${after.used - before.used})`,
);
