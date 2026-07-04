# GUNNER! Episode 1 "Big Heart at Willow Creek" Production Bible

A complete 5:00 children's cartoon produced end to end inside this repo:
art by Gemini, rigging and animation by Armature 2D (document-core commands via
the MCP tool handlers), voices and SFX by ElevenLabs, music by an offline
procedural synth, playback by a self-contained runtime-web player.

Reference for Gunner's design: `IMG_2963_Original 2.jpg` (repo root), a fawn
pocket American Bully with a white chest blaze, white face stripe, cropped ears.

## Story documents

- `story/characters.md` character bible, rig part lists, animation sets, voice casting
- `story/screenplay.md` timecoded script, dialogue IDs, SFX and music cue inventory
- `story/storyboard.md` shot-by-shot timing authority (becomes `player/cartoon.json`)

## Pipeline (mirrors demo/diamond-fusion, the proven template)

| Stage | Script | Output |
|---|---|---|
| 1. Art generation | `tools/generate-art.mts` (+ `tools/ART_PROMPTS.md`) | `source-sheets/*.png` |
| 2. Layer cutting | `tools/cut-assets.mts` (+ `tools/cut-core.mts`) | `source/`, `source-layers/<char>/`, `source-manifest.json` |
| 3. FX textures | `tools/gen-fx-textures.mts` | `source-fx/*.png` |
| 4. Atlas packing | `tools/build-atlas.mts` | `atlas/<char>/atlas-0.png` + `atlas-ref.json` |
| 5. Rig + animation | `tools/author-<char>.mts` via mcp-server `TOOLS` handlers | `rigs/<char>.rig.json`, `renders/` |
| 6. Dialogue | `tools/gen-dialogue.mts` (ElevenLabs TTS) | `audio/dialogue/<ID>.mp3` |
| 7. SFX | `tools/gen-sfx.mts` (ElevenLabs sound-generation) | `audio/sfx/<ID>.mp3` |
| 8. Music | `tools/gen-music.mts` (offline synth, zero credits) | `audio/music/<cue>.wav` |
| 9. Player | `tools/build-player.mts` (esbuild, single file) | `player/index.html` |

Run everything with `tsx` on the pinned Node (`.node-version`).

## Hard constraints

- ElevenLabs free tier: 10,000 credits total. Dialogue ~1,700 chars, one retake
  allowance, ~33 SFX x 100 credits. Ceiling ~6,500. Music must stay procedural.
- The Five Laws apply: all rig mutations go through commands (the tool handlers
  guarantee this), runtime determinism, no Spine source.
- No em-dashes anywhere, including generated docs and UI copy.

## Cast and rigs

Six rigs: gunner (18 parts), pip (9), luna (16), beans (14), duckling (5, three
tints), mama-duck (7). Plus a float composite and prop sprites. Backgrounds are
full-frame PNGs, not atlased; props/logo live in a scene atlas.

## Status

- [x] Production bible (this doc + story/)
- [x] Art: character part sheets (Gemini gemini-3-pro-image, reference-chained)
- [x] Art: backgrounds and props (9 bgs, 18 props, logo, end card)
- [x] Layer cutting + atlases (numbered-piece cut, human-mapped, per-char 2048 atlases)
- [x] Rigs (6 characters, all mutations through MCP tool handlers)
- [x] Animations (60+ clips incl. lip-sync micro anims; translate keys are DELTAS from setup)
- [x] Dialogue audio (44 lines; Gemini TTS fallback, ElevenLabs key had 0 credits;
      tools/gen-dialogue.mts re-renders via ElevenLabs eleven_v3 when credits exist)
- [x] SFX (10 TTS animal vocals + 37 procedural cues)
- [x] Music (12 procedural cues, Gunner motif, seamless loops)
- [x] Player (player/index.html, 60 MB self-contained; ?t=NN&noaudio=1 QA hooks)
- [x] Final QA (renders/player-qa/ frames verified across all 9 scenes)

## Regenerating

Everything under source-sheets/, source-layers/, source/, atlas/, audio/, rigs/, renders/ and
player/index.html is generated. Full rebuild order: generate-art, cut-assets, map-pieces,
build-atlas, author-gunner + author-luna + author-beans + author-pip + author-ducks,
fix-translate-deltas, gen-dialogue-gemini + gen-vocal-sfx + gen-sfx + gen-music, build-player.
QA screenshots: qa-screenshot.mts <outDir> <t...>.
