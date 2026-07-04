# GUNNER! Character Bible

Series: "GUNNER!" (children's cartoon, ages 4 to 8)
Episode 1: "Big Heart at Willow Creek" (runtime 5:00)
Art direction: modern Nickelodeon TV style. Bold clean shapes, thick warm outlines,
flat cel color with simple two-tone shading, big expressive eyes, chunky silhouettes.
Palette is sunny and saturated. Everything reads at a glance.

---

## GUNNER (hero)

Pocket pitbull (American Bully). Modeled on the reference photo `IMG_2963_Original 2.jpg`:
stocky and low to the ground, huge blocky head, broad chest, short strong legs,
cropped upright ears, serious brow that flips adorable when he smiles.

- Coat: warm fawn tan `#C4A08A` with soft lilac undertone
- Markings: white chest blaze and a white stripe up the muzzle and between the eyes `#F5EFE8`
- Muzzle: pale pink-white, big dark nose `#3B2F2F`
- Eyes: round hazel `#8A6B3F`, big cartoon pupils
- Ears: short cropped triangles, dark inner `#8A6B63`
- Collar: red with a gold bone tag `#D8442E` / `#F2B233`
- Personality: brave, warm, a little goofy, never gives up
- Catchphrase: "Little legs, BIG heart!"
- Signature skill: unbeatable TUG. Digs in, never slips.

Voice: warm, boyish, medium pitch, friendly grin you can hear.

## PIP (scout)

Sky-blue pigeon, tiny, hovers constantly, talks a mile a minute. Town crier energy.

- Body: sky blue `#6FB7E8`, cream belly `#F4EDDC`, coral feet and beak `#E8825A`
- Eyes: big, slightly crossed when excited
- Personality: motormouth, dramatic, loyal
- Skill: flies, scouts, delivers rope loops

Voice: fast, high, excitable.

## LUNA (brains)

Small black cat, sleek, calm, wears amber goggles pushed up on her head. Inventor.

- Fur: soft black `#33323E` with blue sheen highlights `#5A5A78`
- Chest patch and paw tips: white
- Eyes: big amber-green `#B7C94A`
- Goggles: amber lenses `#F2B233`, brown strap
- Gadget: the Fetch-O-Matic 3000, a little red wagon catapult
- Personality: cool head, dry wit, plans first
- Skill: knots, gadgets, geometry

Voice: calm, clever girl, lightly amused.

## BEANS (heart in training)

Chihuahua, absurdly tiny, giant ears, giant eyes, nervous shivers, and a bark
five times bigger than his body.

- Coat: cream `#EAD9BE`, darker muzzle mask `#C9AE8C`
- Ears: enormous satellite-dish triangles, pink inner
- Eyes: huge, watery, adorable
- Personality: anxious but tries anyway; comic relief with a real arc
- Skill (discovered this episode): the MEGA BARK, loud enough to echo-locate

Voice: squeaky, jittery, small dog big feelings.

## MAMA DUCK and THE DUCKLINGS (guest cast, non-verbal)

- Mama: classic white duck, orange bill, blue ribbon
- Ducklings (3): yellow fuzzballs `#F7D148`, orange bills, tiny wing nubs.
  Same rig, three tints: Sunny (yellow), Butter (paler `#F5DE86`), Pepper (yellow with brown cap `#8A6B3F`)
- All duck dialogue is quack SFX

---

## Rig part lists (drives the Gemini part-sheet prompts and the layer cutter)

All characters are authored in side view (the show's main staging), facing LEFT by
default, drawn as separated parts on a flat neutral background for cutting.

### Gunner (quadruped rig, 18 parts)

| Part | Notes |
|---|---|
| torso | chest blaze visible, collar baked on |
| head | includes blaze stripe; mouth area blank (mouths are swaps) |
| ear-near, ear-far | cropped triangles |
| eye-open, eye-half, eye-closed, eye-happy | attachment swaps |
| brow | separate for acting |
| mouth-closed, mouth-small, mouth-wide, mouth-oo, mouth-smile, mouth-grit | viseme + acting swaps |
| tail | short whip tail |
| front-leg-near-upper, front-leg-near-lower | two-segment near legs |
| back-leg-near-upper, back-leg-near-lower | |
| front-leg-far, back-leg-far | single segment, darker tint |

### Pip (bird rig, 9 parts)

body, head, beak-top, beak-bottom (talk = beak flap), wing-near, wing-far,
tail, eye-open, eye-closed

### Luna (quadruped rig, 16 parts)

torso, head, goggles, ear-near, ear-far, eye-open, eye-half, eye-closed,
mouth-closed, mouth-small, mouth-smile, tail (long, expressive),
front-leg-near, back-leg-near, front-leg-far, back-leg-far

### Beans (quadruped rig, 14 parts)

torso, head, ear-near, ear-far, eye-open, eye-closed, eye-worried,
mouth-closed, mouth-small, mouth-bark-huge, tail,
front-legs (near pair), back-legs (near pair), legs-far (pair)

### Duckling (5 parts) and Mama Duck (7 parts)

Duckling: body, head, bill-top, bill-bottom, wing-nub
Mama: body, neck, head, bill-top, bill-bottom, wing, ribbon

---

## Animation set (authored per character in Armature 2D)

| Character | Loops | One-shots |
|---|---|---|
| Gunner | idle, walk, run, talk | tug-strain, dig-in, hero-pose, wink, head-shake, yank-grab |
| Pip | hover, fly, talk (beak flap) | lift-strain, feather-pop, land, rope-carry |
| Luna | idle, walk, run, talk | crank-gadget, tie-knot, point |
| Beans | idle (shiver), walk, run, talk | freeze-shiver, mega-bark, proud-strut |
| Duckling | bob-float, waddle | quack-hop, imprint-pose |
| Mama Duck | idle, waddle | alarm-flap |

Lip sync strategy: dialogue shots play the `talk` loop; the player drives mouth
attachment swaps from the live audio amplitude of the line (RMS gate), so sync is
automatic and per-line viseme authoring is not needed.

---

## Voice casting (ElevenLabs, premade voices, free tier)

Final voice IDs are chosen at generation time from `/v1/voices` (premade set).
Casting targets:

| Character | Target quality | Settings direction |
|---|---|---|
| Gunner | young warm male, friendly | stability 0.45, style 0.35 |
| Pip | fast bright high energy | stability 0.30, style 0.55, speed 1.12 |
| Luna | calm smart female | stability 0.60, style 0.25 |
| Beans | squeaky nervous small | highest-pitch premade, stability 0.35, style 0.6 |

Credit budget (free tier, 10,000 total): dialogue ~1,700 chars x 1 credit, one retake
allowance ~1,700, SFX ~30 generations x 100 = 3,000. Ceiling ~6,500 of 10,000.
