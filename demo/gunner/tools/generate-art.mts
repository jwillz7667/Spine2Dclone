import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GUNNER! art generation: drives Gemini image models over REST to produce every sheet the cartoon
// needs. Sheets land in ../source-sheets/ and are cut by cut-assets.mts. Round 1 turns the real
// reference photo of Gunner into the show's style bible; later rounds attach earlier sheets as image
// references so the whole cast and world read as one show. A sheet that already exists is skipped
// unless --force, so re-runs only fill gaps (and --only re-rolls specific sheets).
//
// Usage: tsx generate-art.mts [--round N] [--only id1,id2] [--force]

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'source-sheets');
mkdirSync(outDir, { recursive: true });

const REFERENCE_PHOTO = join(root, '..', '..', 'IMG_2963_Original 2.jpg');

function loadApiKey(): string {
  const envPath = join(root, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('GEMINI_API_KEY='));
  const key = line
    ?.slice('GEMINI_API_KEY='.length)
    .trim()
    .replace(/^["']|["']$/g, '');
  if (key === undefined || key.length === 0) throw new Error('GEMINI_API_KEY missing from .env');
  return key;
}
const API_KEY = loadApiKey();

const MODELS = ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
const ENDPOINT = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

interface GenPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

function mimeFor(file: string): string {
  return extname(file).toLowerCase() === '.jpg' || extname(file).toLowerCase() === '.jpeg'
    ? 'image/jpeg'
    : 'image/png';
}

async function generateImage(
  prompt: string,
  aspect: string,
  size: '1K' | '2K' | '4K',
  refFiles: readonly string[],
): Promise<Buffer> {
  const parts: GenPart[] = [{ text: prompt }];
  for (const ref of refFiles) {
    parts.push({
      inline_data: { mime_type: mimeFor(ref), data: readFileSync(ref).toString('base64') },
    });
  }
  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: aspect, imageSize: size },
    },
  });

  let lastError = 'no attempt';
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await fetch(ENDPOINT(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `${model}: HTTP ${res.status}`;
        await new Promise((r) => setTimeout(r, attempt * 8000));
        continue;
      }
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
        break;
      }
      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ inlineData?: { data?: string } }> };
          finishReason?: string;
        }>;
      };
      const image = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
        ?.inlineData?.data;
      if (image === undefined) {
        lastError = `${model}: no image in response (finishReason=${json.candidates?.[0]?.finishReason})`;
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return Buffer.from(image, 'base64');
    }
  }
  throw new Error(`generation failed: ${lastError}`);
}

// ---- shared prompt blocks ----------------------------------------------------------------------

const STYLE = `Premium modern children's TV cartoon art, top-tier Nickelodeon Saturday-morning 2D style: bold clean vector-like shapes, thick smooth warm dark-chocolate-brown outlines of consistent weight, flat cel color with exactly one soft darker shade tone and one lighter highlight tone per color area, big expressive glossy eyes, chunky rounded appealing silhouettes, saturated sunny storybook palette, crisp edges, absolutely flat 2D (no 3D render, no photorealism, no painterly texture, no noise, no gradients inside characters).`;

const CUTOUT = `Flat, solid, PURE WHITE background (#FFFFFF) with zero gradients, zero vignette, zero shadows cast on the background. Arrange the requested elements in the exact grid described, generously spaced: every element fully separated from its neighbors by empty white background at least 5 percent of the image width, nothing overlapping, nothing touching the image border. Straight-on orthographic view, identical lighting across all elements. Do not include: any text, letters, numbers, labels, captions, arrows, watermarks, borders, frame lines, or drop shadows on the background.`;

const REF_NOTE = `Match the attached reference image(s) EXACTLY for character design, proportions, palette, outline weight and style; the new art must look like frames from the same TV show.`;

const NO_TEXT = `This is a TEXTURE SPRITE SHEET for a game engine, NOT an instructional diagram. Sprite sheets never contain words. ABSOLUTELY NO TEXT OF ANY KIND anywhere on the image: no words, no letters, no numbers, no part names, no labels, no captions under parts, no numbering. The image contains ONLY the drawn shapes on pure white. If you are about to write a label under a part, do not; leave that area pure white instead. This is the single most important requirement.`;

const SIDE_VIEW = `full body SIDE VIEW facing LEFT, standing on an invisible flat ground line, all four legs visible (the two far-side legs drawn slightly offset behind and filled with a subtly darker shade), tail visible, head drawn as a friendly three-quarter cheat toward the camera so BOTH eyes and the face read clearly while the body stays in profile`;

// ---- the sheet manifest --------------------------------------------------------------------------

interface Sheet {
  readonly id: string;
  readonly round: 1 | 2 | 3 | 4 | 5;
  readonly aspect: string;
  readonly size: '1K' | '2K' | '4K';
  readonly refs: readonly string[]; // sheet ids from earlier rounds, or PHOTO
  readonly prompt: string;
}

const PHOTO = 'PHOTO' as const;

const SHEETS: readonly Sheet[] = [
  // ---------------- ROUND 1: Gunner himself, from the real photo ----------------
  {
    id: 'gunner-ref',
    round: 1,
    aspect: '4:3',
    size: '2K',
    refs: [PHOTO],
    prompt: `${STYLE}
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text anywhere.
The attached photo shows a real pocket American Bully dog. Design GUNNER, the heroic and adorable main character of a children's cartoon, based faithfully on this exact dog: keep his warm fawn-tan coat, the white chest blaze, the white stripe running up his muzzle and between his eyes, his short cropped upright triangle ears with dark pink inner, his pale pink-white muzzle and big dark nose, his HUGE blocky head, broad chest, very stocky muscular little body, short strong legs and short whip tail. Add a red collar with a small gold bone-shaped tag.
Make him unmistakably a lovable kids-show hero: giant friendly hazel eyes with big glossy pupils and white sparkle highlights, a warm confident smile with a hint of tongue, soft rounded shapes, extra chunky and huggable proportions (head almost as big as his body).
ONE single centered character, ${SIDE_VIEW}. Neutral happy standing pose, mouth in a gentle closed smile.`,
  },

  // ---------------- ROUND 2: the cast lineup, locked to Gunner ----------------
  {
    id: 'cast-lineup',
    round: 2,
    aspect: '16:9',
    size: '2K',
    refs: ['gunner-ref'],
    prompt: `${STYLE}
${REF_NOTE}
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text anywhere.
The full main cast of the show standing in one line on a shared invisible ground line, all in ${SIDE_VIEW}, correct relative sizes, generously spaced with clear white gaps between them, left to right:
1) GUNNER, the attached pocket bully hero, exactly as designed in the reference;
2) LUNA, a small sleek black cat, soft blue-black fur with a white chest patch and white paw tips, big amber-green eyes, round amber goggles pushed up on top of her head with a brown strap, long expressive tail, calm clever smirk, slightly shorter than Gunner;
3) BEANS, a tiny cream chihuahua, half Gunner's height, enormous satellite-dish triangle ears with pink inner, huge watery adorable eyes, slightly darker cream muzzle mask, skinny little legs, tiny curled tail, nervous hopeful smile;
4) PIP, a small round sky-blue pigeon standing on the ground, cream belly, small coral-orange beak and feet, tiny folded wings, big keen eyes, about knee height to Gunner;
5) MAMA DUCK, a classic white mother duck with an orange bill and feet and a small blue neck ribbon, standing tall and proud, with THREE identical tiny fluffy yellow ducklings with orange bills standing in a neat row in front of her, each duckling about the size of Pip's head.`,
  },

  // ---------------- ROUND 3: individual character model refs ----------------
  {
    id: 'luna-ref',
    round: 3,
    aspect: '4:3',
    size: '2K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE} Use the black cat with amber goggles from the attached cast lineup.
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text.
ONE single centered character model of LUNA the cat, ${SIDE_VIEW}. Neutral relaxed standing pose, tail in a gentle S curve held off the ground, calm clever smirk, goggles up on her head.`,
  },
  {
    id: 'beans-ref',
    round: 3,
    aspect: '4:3',
    size: '2K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE} Use the tiny cream chihuahua from the attached cast lineup.
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text.
ONE single centered character model of BEANS the chihuahua, ${SIDE_VIEW}. Neutral standing pose, giant ears up and alert, huge hopeful eyes, tiny tail curled, nervous-sweet closed smile.`,
  },
  {
    id: 'pip-ref',
    round: 3,
    aspect: '4:3',
    size: '2K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE} Use the sky-blue pigeon from the attached cast lineup.
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text.
ONE single centered character model of PIP the pigeon, full body SIDE VIEW facing LEFT, standing, head as a friendly three-quarter cheat so both eyes read, round chubby body, cream belly patch, small folded near-side wing visible, coral beak closed, big keen glossy eyes.`,
  },
  {
    id: 'ducks-ref',
    round: 3,
    aspect: '4:3',
    size: '2K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE} Use the white mother duck and yellow ducklings from the attached cast lineup.
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border, no text.
Exactly TWO elements side by side with a wide white gap: on the left, MAMA DUCK standing in full body SIDE VIEW facing LEFT (white feathers, orange bill and feet, small blue neck ribbon, head three-quarter cheat so both eyes read); on the right, ONE DUCKLING standing in full body SIDE VIEW facing LEFT (round fluffy yellow chick body, stubby wing nub, orange bill, big cute eyes, head three-quarter cheat), drawn at correct relative scale (the duckling much smaller).`,
  },

  // ---------------- ROUND 4: rig part kits ----------------
  {
    id: 'gunner-body-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['gunner-ref'],
    prompt: `${NO_TEXT}
${STYLE}
${REF_NOTE} The attached GUNNER character is the assembled target; every part below must reassemble into exactly that pose at exactly that scale.
${CUTOUT}
An exploded skeletal-animation body-parts kit of GUNNER, exactly 11 separate parts arranged in exactly 2 rows (6 parts in the top row, 5 in the bottom row), each part drawn COMPLETE including the regions that were hidden behind neighboring parts in the assembled pose, each part in the same orientation as in the assembled side view, consistent relative scale, matching colors and outlines:
TOP ROW, left to right:
1) HEAD: the full huge blocky head with the white blaze, muzzle and nose, but with EMPTY smooth fawn fur where the eyes go and an EMPTY smooth muzzle where the mouth goes (eye and mouth areas blank, no brows), and WITHOUT the ears;
2) NEAR EAR: the left cropped triangle ear alone;
3) FAR EAR: the right cropped triangle ear alone, slightly darker;
4) BROWS: the pair of soft fawn brow patches alone, side by side in their natural spacing;
5) TAIL: the short whip tail alone;
6) TORSO: the stocky body with the white chest blaze and the red collar with gold bone tag, WITHOUT head, legs, or tail, the hidden shoulder and hip areas drawn complete and rounded;
BOTTOM ROW, left to right:
7) NEAR FRONT LEG UPPER: the near front leg's shoulder-to-knee segment alone, drawn complete with rounded overlap ends;
8) NEAR FRONT LEG LOWER: the near front leg's knee-to-paw segment with the white paw;
9) NEAR BACK LEG UPPER: the near back leg's hip-to-knee segment (the big thigh);
10) NEAR BACK LEG LOWER: the near back leg's knee-to-paw segment with the white paw;
11) FAR LEGS: the two far-side legs (one front, one back) drawn as complete single pieces side by side, in the subtly darker far-side shade.`,
  },
  {
    id: 'gunner-face-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['gunner-ref'],
    prompt: `${NO_TEXT}
${STYLE}
${REF_NOTE} These parts must fit the attached GUNNER character's face at exactly his scale and angle (three-quarter cheat).
${CUTOUT}
A facial-animation parts kit for GUNNER, exactly 10 elements arranged in exactly 2 rows of exactly 5, every element drawn at the same scale as it appears on the assembled face. CRITICAL: do NOT draw the head, do NOT draw the whole face, do NOT draw ears or the big black nose; every element below is a small ISOLATED floating shape on white:
TOP ROW, left to right, EYE PAIRS (each element is both eyes together, side by side at their natural spacing on the face, nothing else):
1) EYES OPEN: big friendly hazel eyes, glossy pupils, sparkle highlights;
2) EYES HALF: the same eyes half-lidded, relaxed;
3) EYES CLOSED: the same eyes fully closed, two thick happy curved lash lines;
4) EYES HAPPY: the same eyes squeezed shut in delight, curved like upside-down U shapes;
5) BROWS WORRIED: the pair of brow patches tilted sad-worried;
BOTTOM ROW, left to right, MOUTHS. CRITICAL RULE FOR ALL FIVE MOUTHS: a mouth is ONLY lips, teeth, tongue and smile-line strokes, with NOTHING else. Do NOT draw a nose in any mouth element (the character's nose already exists on his head; a second nose would ruin the rig). Do NOT draw a backing patch, do NOT draw a circle of fur, do NOT draw the muzzle: just the bare mouth linework and its interior, floating on pure white:
6) MOUTH CLOSED: one gentle closed smile line with tiny corner curls;
7) MOUTH SMALL OPEN: small friendly open mouth showing tongue tip;
8) MOUTH WIDE OPEN: big open shout mouth, dark interior, pink tongue, tiny white teeth;
9) MOUTH OO: small round pursed O mouth;
10) MOUTH GRIT: gritted-teeth determined mouth, corners pulled wide showing a row of clenched white teeth.`,
  },
  {
    id: 'luna-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['luna-ref'],
    prompt: `${NO_TEXT}
${STYLE}
${REF_NOTE} The attached LUNA character is the assembled target; parts must reassemble into exactly that pose and scale.
${CUTOUT}
An exploded skeletal-animation parts kit of LUNA the black cat, exactly 16 separate parts arranged in exactly 3 rows (6, then 5, then 5), each part drawn COMPLETE including hidden overlap regions, same orientation as the assembled side view, consistent scale:
TOP ROW: 1) HEAD without ears, with completely EMPTY smooth dark fur where the eyes, nose and mouth go (NO eyes, NO eye sockets, NO nose, NO mouth, NO smile line on the head; a totally blank face); 2) NEAR EAR; 3) FAR EAR slightly darker; 4) GOGGLES: the amber goggles with brown strap alone, shaped to sit on top of the head; 5) TAIL: the long expressive tail alone in its S curve; 6) TORSO: sleek body with white chest patch, without head, legs or tail, shoulders and hips drawn complete;
MIDDLE ROW (legs: every leg element is exactly ONE single leg with exactly ONE paw; never draw two legs in one element): 7) NEAR FRONT LEG: one straight slender leg with white paw tip; 8) NEAR BACK LEG: one leg with the cat hock bend and white paw tip, ONE leg only; 9) FAR FRONT LEG: one straight leg in the darker shade; 10) FAR BACK LEG: one bent leg in the darker shade; 11) EYES OPEN pair: big amber-green cat eyes with glossy pupils;
BOTTOM ROW: 12) EYES HALF pair, sly half-lidded; 13) EYES CLOSED pair, two elegant curved lines; 14) MOUTH CLOSED: her small pink nose with a tiny smirk line below it, drawn on a soft-edged dark-fur-colored oval patch; 15) MOUTH SMALL OPEN: nose plus small open talking mouth on the same style of patch; 16) MOUTH SMILE: nose plus wide warm open smile on the same style of patch.`,
  },
  {
    id: 'beans-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['beans-ref'],
    prompt: `${NO_TEXT}
${STYLE}
${REF_NOTE} The attached BEANS character is the assembled target; parts must reassemble into exactly that pose and scale.
${CUTOUT}
An exploded skeletal-animation parts kit of BEANS the chihuahua, exactly 15 separate parts arranged in exactly 3 rows of exactly 5, each part drawn COMPLETE including hidden overlap regions, same orientation as the assembled side view, consistent scale:
TOP ROW: 1) HEAD without ears, with completely EMPTY fur where the eyes, nose and mouth go (NO eyes, NO nose, NO mouth on the head), including the darker cream muzzle mask; 2) NEAR EAR: one enormous satellite-dish triangle ear with pink inner; 3) FAR EAR slightly darker; 4) TAIL: tiny curled tail; 5) TORSO: skinny little cream body without head, legs or tail;
MIDDLE ROW (legs: every leg element is exactly ONE single skinny leg with exactly ONE tiny paw; never draw two legs in one element): 6) NEAR FRONT LEG: one straight twig leg; 7) NEAR BACK LEG: one leg with a little hock bend, ONE leg only; 8) FAR FRONT LEG: one straight leg, darker; 9) FAR BACK LEG: one bent leg, darker; 10) EYES OPEN pair: huge watery adorable eyes;
BOTTOM ROW: 11) EYES CLOSED pair, squeezed shut; 12) EYES WORRIED pair: huge eyes with tilted worried lids and tiny welling tears; 13) MOUTH CLOSED: his brown nose with a small nervous smile below it on a soft-edged cream muzzle patch; 14) MOUTH SMALL OPEN: nose plus small open talking mouth on the same style of patch; 15) MOUTH BARK HUGE: nose plus a gigantic wide-open bark mouth, comically huge, dark interior, tongue, tiny teeth, on the same style of patch.`,
  },
  {
    id: 'pip-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['pip-ref'],
    prompt: `${STYLE}
${REF_NOTE} The attached PIP character is the assembled target; parts must reassemble into exactly that pose and scale.
${CUTOUT}
An exploded skeletal-animation parts kit of PIP the sky-blue pigeon, exactly 10 separate parts arranged in exactly 2 rows of exactly 5, each part drawn COMPLETE including hidden overlap regions, same orientation as the assembled side view, consistent scale:
TOP ROW: 1) BODY: the round chubby body with cream belly and both little orange legs and feet, WITHOUT head, wings or tail; 2) HEAD: the head with EMPTY feathers where the eyes go and WITHOUT the beak; 3) BEAK TOP: the upper coral beak half alone; 4) BEAK BOTTOM: the lower coral beak half alone; 5) TAIL: the short fanned tail feathers alone;
BOTTOM ROW: 6) NEAR WING: the near-side wing alone, folded; 7) NEAR WING SPREAD: the same near wing fully spread with feather fingers; 8) FAR WING: the far-side wing folded, slightly darker; 9) EYES OPEN pair: big keen glossy eyes; 10) EYES CLOSED pair: two happy curved lines.`,
  },
  {
    id: 'ducks-parts',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['ducks-ref'],
    prompt: `${STYLE}
${REF_NOTE} The attached MAMA DUCK and DUCKLING are the assembled targets; parts must reassemble into exactly those poses and scales.
${CUTOUT}
An exploded skeletal-animation parts kit for BOTH birds, exactly 12 separate parts arranged in exactly 2 rows of exactly 6, each part drawn COMPLETE including hidden overlap regions, same orientation as the assembled side views, consistent relative scale (duckling parts much smaller):
TOP ROW, MAMA DUCK parts, left to right: 1) BODY: white body with both orange legs and feet, without neck, head or wing; 2) NECK: the neck alone with the small blue ribbon at its base; 3) HEAD: head with eye drawn on, WITHOUT the bill; 4) BILL TOP: upper orange bill half; 5) BILL BOTTOM: lower orange bill half; 6) WING: the near-side white wing alone, folded;
BOTTOM ROW, DUCKLING parts, left to right: 7) BODY: round fluffy yellow body with tiny orange legs; 8) HEAD: fluffy head with big cute eye drawn on, WITHOUT the bill; 9) BILL TOP: tiny upper orange bill; 10) BILL BOTTOM: tiny lower orange bill; 11) WING NUB: the stubby little wing alone; 12) EYES CLOSED pair for the duckling: two happy curved lines.`,
  },

  // ---------------- ROUND 4 continued: props ----------------
  {
    id: 'props-a',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE}
${CUTOUT}
A cartoon prop kit for the show, exactly 10 elements arranged in exactly 2 rows of exactly 5, consistent outline and palette:
TOP ROW: 1) an inflatable swimming pool donut float, cheerful red and white stripes, seen from a slight three-quarter top angle so its hole reads; 2) a coiled striped play rope (red and cream candy stripes), neatly coiled; 3) the same striped rope as one straight taut horizontal segment; 4) a woven picnic basket with a red gingham cloth peeking out; 5) a red gingham picnic blanket spread flat, seen at a slight angle;
BOTTOM ROW: 6) a little red wooden wagon with chunky wheels carrying a whimsical homemade catapult contraption made of planks, springs and a big lever arm with a launch basket; 7) a long sturdy tree branch with a few leaf tufts; 8) a rounded grey river boulder; 9) a fallen mossy log seen from the side; 10) a tiny green leaf folded into a pointy party hat.`,
  },
  {
    id: 'props-b',
    round: 4,
    aspect: '16:9',
    size: '4K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE}
${CUTOUT}
A cartoon scenery-piece kit for parallax layers of the show, exactly 8 elements arranged in exactly 2 rows of exactly 4, consistent outline and palette:
TOP ROW: 1) a round fluffy green bush; 2) a wider low green bush with a few pink flowers; 3) a full leafy green tree with a chunky brown trunk; 4) a hanging willow branch curtain of long soft green fronds;
BOTTOM ROW: 5) a small white butterfly with wings up; 6) the same butterfly with wings flat open; 7) a big cheerful cartoon sun with soft triangular rays; 8) a plump white cumulus cloud.`,
  },
  {
    id: 'logo',
    round: 4,
    aspect: '16:9',
    size: '2K',
    refs: ['gunner-ref'],
    prompt: `${STYLE}
${REF_NOTE}
Flat, solid, PURE WHITE background (#FFFFFF), zero shadows on the background, nothing touching the image border.
One single centered TV-show logo: the word "GUNNER!" in huge bouncy rounded 3D-ish cartoon letters, warm fawn-tan fill with a white highlight stripe (matching the attached hero's coat), thick dark chocolate outline, a red collar-strap swooshing through behind the letters with a small gold bone tag hanging from it, and a few tiny yellow sparkle stars around the edges. Playful, chunky, perfectly readable for young kids. The ONLY text in the image is exactly the word GUNNER! spelled correctly with the exclamation mark.`,
  },

  // ---------------- ROUND 5: backgrounds (bg-meadow is the location style bible) ----------------
  {
    id: 'bg-meadow',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['cast-lineup'],
    prompt: `${STYLE}
${REF_NOTE} Paint the world these characters live in, but do NOT include any characters.
Full-frame 16:9 EMPTY background painting for a children's cartoon, no characters, no animals, no text: SUNNY MEADOW PARK in the town of Pawville at mid-morning. Rolling super-green grassy meadow with simple flat cel shading, a few chunky rounded trees and bushes, scattered tiny daisies, a big cheerful blue sky with plump white clouds and a warm sun high left, soft distant rolling hills. The ground plane across the bottom third is a clean open grassy stage where characters will stand (keep it simple and uncluttered, gentle shading only). Bright, warm, inviting, flat 2D storybook style.`,
  },
  {
    id: 'bg-title-skyline',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-meadow'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same show and palette as the attached meadow, no characters, no text: the TOWN OF PAWVILLE seen from a grassy hilltop, a cheerful low skyline of rounded pastel cottages and shops with dog-bone weathervanes and a little clock tower, puffy clouds, big morning sun with soft rays upper left, a few birds as tiny distant Vs. The grassy hilltop foreground across the bottom third is a clean open stage. Bright, heroic, welcoming title-card energy.`,
  },
  {
    id: 'bg-creek',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-meadow'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same show and palette, no characters, no animals, no text: WILLOW CREEK. A gentle wide blue-green creek flows horizontally across the middle of the frame, calm rippled water with a few round lily pads, grassy near bank across the bottom third as a clean open stage, a big friendly willow tree on the far bank left with hanging fronds, reeds and cattails in clumps, bright sunny sky. Flat cel water with simple ripple shapes.`,
  },
  {
    id: 'bg-bank-run',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-creek'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same creek and palette as the attached, no characters, no text: a LONG STRAIGHT stretch of Willow Creek built for a horizontal side-scrolling chase. The creek runs perfectly horizontal across the middle, moving water with small repeated wave shapes and a hint of current lines, the near grassy bank across the bottom third as a clean flat running stage with an even repeating rhythm of grass tufts, the far bank with an even repeating rhythm of bushes and trees, sunny sky with small repeated clouds. Composition deliberately even and repetitive from left edge to right edge so it can pan.`,
  },
  {
    id: 'bg-log-bend',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-creek'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same creek and palette as the attached, no characters, no text: OLD LOG BEND. The creek sweeps in a wide bend from the upper left to the lower right of the frame, faster water with white swirl accents, a huge old half-fallen mossy log jutting from the near bank partway over the water at mid-frame, a large flat rock in the middle of the creek beyond the log's reach, dramatic-but-friendly late-morning light, grassy near bank bottom third as a clean stage.`,
  },
  {
    id: 'bg-fog-hollow',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-creek'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same creek and palette as the attached but desaturated and mysterious, no characters, no text: FOG HOLLOW. The creek disappears into a low hollow filled with thick soft pale blue-grey fog in flat cel layers, silhouetted soft trees fading into the mist in three depth bands, the near grassy bank across the bottom third still readable as a clean stage, cool dim light, gentle and moody but never scary for kids (soft rounded shapes, a hint of warm light high in the sky).`,
  },
  {
    id: 'bg-waterfall',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-creek'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting, same creek and palette as the attached, no characters, no text: WATERFALL POINT. The creek widens and rushes toward a waterfall edge at the RIGHT side of the frame where the water curls over and drops out of view with white spray and small mist puffs rising, current lines and white swirls across the water, the near grassy-muddy bank across the bottom third as a clean stage ending in a last spit of land near the falls, a rainbow faintly visible in the mist, afternoon light, exciting but hopeful.`,
  },
  {
    id: 'bg-golden-meadow',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['bg-meadow'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 EMPTY background painting: EXACTLY the attached Sunny Meadow Park scene repainted at GOLDEN HOUR sunset. Same composition and shapes, but warm amber-and-pink sky, long soft shadows, honey-gold light on the grass, the sun low on the left glowing orange, a few clouds tinted pink and lavender. Cozy, warm, end-of-a-good-day feeling. No characters, no text.`,
  },
  {
    id: 'card-the-end',
    round: 5,
    aspect: '16:9',
    size: '2K',
    refs: ['logo', 'bg-golden-meadow'],
    prompt: `${STYLE}
${REF_NOTE}
Full-frame 16:9 end card for the show, matching the attached logo's lettering style and the attached sunset palette: a warm deep amber-to-dusk gradient background with soft vignette of tiny sparkle stars, and the words "The End" centered in big friendly bouncy rounded cartoon letters, cream-white fill with a thick dark chocolate outline, one small gold bone-shaped tag hanging off the last letter. The ONLY text in the image is exactly the words "The End" spelled correctly.`,
  },
];

// ---- run ------------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const force = args.includes('--force');
const roundArg = args.includes('--round') ? Number(args[args.indexOf('--round') + 1]) : undefined;
const onlyArg = args.includes('--only')
  ? new Set(String(args[args.indexOf('--only') + 1]).split(','))
  : undefined;

const sheetPath = (id: string): string =>
  id === PHOTO ? REFERENCE_PHOTO : join(outDir, `${id}.png`);

let generated = 0;
let skipped = 0;
for (const sheet of SHEETS) {
  if (roundArg !== undefined && sheet.round !== roundArg) continue;
  if (onlyArg !== undefined && !onlyArg.has(sheet.id)) continue;
  const out = sheetPath(sheet.id);
  if (existsSync(out) && !force && !(onlyArg?.has(sheet.id) ?? false)) {
    console.log(`SKIP ${sheet.id} (exists)`);
    skipped += 1;
    continue;
  }
  const missingRefs = sheet.refs.filter((r) => !existsSync(sheetPath(r)));
  if (missingRefs.length > 0) {
    throw new Error(
      `${sheet.id}: missing reference sheet(s) ${missingRefs.join(', ')}; run earlier rounds first`,
    );
  }
  process.stdout.write(
    `GEN  ${sheet.id} (round ${sheet.round}, ${sheet.aspect} ${sheet.size}, refs: ${sheet.refs.join(',') || 'none'}) ... `,
  );
  const started = Date.now();
  const png = await generateImage(
    sheet.prompt,
    sheet.aspect,
    sheet.size,
    sheet.refs.map(sheetPath),
  );
  writeFileSync(out, png);
  console.log(
    `ok ${(png.length / 1024 / 1024).toFixed(1)}MB in ${((Date.now() - started) / 1000).toFixed(0)}s`,
  );
  generated += 1;
}
console.log(`DONE: ${generated} generated, ${skipped} skipped -> ${outDir}`);
