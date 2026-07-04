# GUNNER! Episode 1 Storyboard / Shot List

This document is the timing authority for `player/cartoon.json`. Where the
screenplay and this sheet disagree on seconds, this sheet wins.

Stage: 1920 x 1080, 24 fps, total 300.0 s (7200 frames).
Ground line: y = 880. Positions are stage-space; camera pans/zooms are applied on
a world container. Characters face LEFT in their rigs; `flip: true` mirrors to face right.
Actor scale reference: Gunner shoulder height ~300 px at scale 1.0. Pip 0.45,
Luna 0.95, Beans 0.55, ducklings 0.30, Mama 0.75 relative to their source art,
tuned after atlas import.

Transitions: `cut` (default), `iris-out`/`iris-in` (black circle wipe, 0.7 s),
`fade` (0.8 s).

| Shot | Time (s) | BG | Camera | Action / acting | Audio (D=dialogue S=sfx M=music) |
|---|---|---|---|---|---|
| SH-101 | 0.0 - 3.0 | bg-title-skyline | slow zoom-in 1.00 to 1.04 | Fade from black. Sun rays rotate slowly (prop). | M: theme starts |
| SH-102 | 3.0 - 8.0 | bg-title-skyline | static | Gunner run cycle enters left, crosses to center, skids to stop. Dust puff FX. | S: whoosh-run 3.2, skid 6.6 |
| SH-103 | 8.0 - 14.0 | bg-title-skyline | static | Gunner hero-pose. Logo prop drops in with squash bounce + sparkle burst FX. Gunner wink at 12.5. | S: sparkle-pop 9.0, wink-ting 12.5 |
| SH-104 | 14.0 - 20.0 | bg-title-skyline | static | Gunner holds pose, talk for line. Iris-out starting 18.8. | D: G-101 at 14.4. M: theme button |
| SH-201 | 20.0 - 27.0 | bg-meadow | static wide | Iris-in. Gunner (left, flip) and Beans (right) tug rope. Gunner planted (tug-strain loop), Beans flailing. Luna mid-left cranks Fetch-O-Matic (crank-gadget). Butterflies drift (FX). Beans loses grip at 25.2, tumbles back. | M: meadow. S: birds-meadow amb, tug-growl 20.5, crank-ratchet 21.0, boing-tumble 25.3. D: B-201 at 22.0 |
| SH-202 | 27.0 - 31.5 | bg-meadow | push-in to Gunner+Beans | Gunner talk, relaxed. Beans upside down, dizzy eye swaps. | D: G-202 at 27.4 |
| SH-203 | 31.5 - 38.0 | bg-meadow | pan to Luna | Luna point anim at wagon, proud. Gadget creaks, one bolt pops (FX spark). | D: L-203 at 32.0. S: creak-gadget 36.0 |
| SH-204 | 38.0 - 46.0 | bg-meadow | static | Pip dive-bombs in from top-right, lands on basket. Talk with beak flaps, wings gesturing. | S: flap-land 38.6. D: P-204 at 39.6 |
| SH-205 | 46.0 - 52.5 | bg-meadow | static wide | Gunner rally: hero-pose then run off right. Grabs rope, wears it bandolier (attachment swap torso+rope). All dash right with dust FX. | D: G-205 at 46.3. S: whoosh-group 50.8 |
| SH-206 | 52.5 - 55.0 | bg-meadow | static | Beat on empty meadow. Beans sprints through late, ears flapping. | D: B-206 at 53.0 |
| SH-301 | 55.0 - 63.0 | bg-creek | static | Mama Duck leads 3 ducklings (bob-float line) L to R midstream. Team enters left on bank, stops, leans in. | M: meadow softer. S: creek-flow amb, quack-mama 57.0, quack-babies 59.0 |
| SH-302 | 63.0 - 71.0 | bg-creek | push-in on team | Heart eyes (eye-happy swaps). Three quick lines. | D: L-301 63.4, G-302 65.6, B-303 68.2 |
| SH-303 | 71.0 - 79.0 | bg-creek | static | Gust bends the willow (bg prop sway). Donut float blows in bouncing, lands in creek. Ducklings quack-hop onto it one-two-three, boing. | S: wind-gust 71.2, boing-soft 74.8/75.6/76.4, quack-babies 77.0 |
| SH-304 | 79.0 - 86.0 | bg-creek | slow pan right | Current catches float, drift accelerates right. Mama alarm-flap on bank. Duckling eyes go wide. | S: quack-alarm 80.0, flap-panic 80.5. M: tension-rise 82.0 |
| SH-305 | 86.0 - 90.0 | bg-creek | quick push on Pip then Gunner | Pip panic hover. Gunner point + rally. | D: P-304 86.2, G-305 88.2. M: chase starts 89.5 |
| SH-401 | 90.0 - 100.0 | bg-bank-run | parallax scroll | Full-team side-scroll run montage. Bushes/trees parallax strips. Float bobs midstream ahead of them. | M: chase. S: paws-running amb, river-fast amb |
| SH-402 | 100.0 - 104.0 | bg-bank-run | scroll | Pip line then fly anim boosts ahead, motion streak FX. | D: P-401 100.3. S: flap-fast 102.5 |
| SH-403 | 104.0 - 114.0 | bg-bank-run | static (bank POV) | Pip grips float valve, lift-strain: face red swap, shake, one feather pops. Float does not budge. | S: strain-squeak 106.0, feather-pop 111.5. D: P-402 111.8 |
| SH-404 | 114.0 - 120.0 | bg-bank-run | static | Pip flops onto Gunner's head. Deadpan exchange. | S: flop-soft 114.3. D: G-403 115.0, P-404 117.0 |
| SH-405 | 120.0 - 130.0 | bg-bank-run | scroll resumes | Luna points ahead (point anim), team angles off. | D: L-405 120.5. M: chase lift |
| SH-501 | 130.0 - 137.0 | bg-log-bend | static | Team skids in. Luna wheels the Fetch-O-Matic to bank edge and cranks. | S: skid 130.4, crank-ratchet 132.0 |
| SH-502 | 137.0 - 143.0 | bg-log-bend | static | Luna fires. Branch arcs over creek (prop tween with rotation), thunks onto rock: bridge complete. | D: L-501 137.2. S: catapult-twang 139.0, branch-thunk 141.2. M: tension-rise |
| SH-503 | 143.0 - 151.0 | bg-log-bend | push toward branch | Beans volunteers (proud-strut onto branch), walk across. | D: B-502 143.4. |
| SH-504 | 151.0 - 158.0 | bg-log-bend | close on Beans | Freeze mid-span: freeze-shiver loop, eye-worried, branch wobble. Float sweeps under and past. | S: wobble-creak 151.5, shiver-rattle 152.0. D: B-503 154.0 |
| SH-505 | 158.0 - 165.0 | bg-log-bend | static | Gunner lunges (yank-grab), branch snaps, big splash. Beans saved, soggy branch floats off. | D: G-504 158.2. S: crack-snap 161.0, splash-big 161.5, yank-grab 161.8 |
| SH-506 | 165.0 - 170.0 | bg-log-bend | push on Luna | Beans drips (drip FX). Luna grim line. All look off right: fog wall in distance. | D: L-505 165.6. M: chase urgent 169.0 |
| SH-601 | 170.0 - 177.0 | bg-fog-hollow | static, desaturated | Team creeps in slow walk, silhouettes soft. Fog drift FX layers. | M: lost. S: fog-wind amb. D: G-601 174.0 |
| SH-602 | 177.0 - 186.0 | bg-fog-hollow | slow push on Beans | Beans sits, ears down, eye-worried. Saddest beat of the show. | D: B-602 178.0 |
| SH-603 | 186.0 - 194.0 | bg-fog-hollow | two-shot | Gunner lights up mid-line (idea!). Beans hopeful. | D: G-603 186.4, B-604 191.0, G-605 192.2 |
| SH-604 | 194.0 - 200.0 | bg-fog-hollow | pull back wide | Beans inhales huge (mega-bark anim), MEGA BARK shockwave ripples the fog (ring FX). Beat. Distant quacks answer left. Luna points. All dash left. | S: mega-bark 195.0, quack-distant 197.2. M: hope-sting 197.5, chase-final 199.0. D: L-606 198.0 |
| SH-701 | 200.0 - 206.0 | bg-waterfall | static wide | Mist. Float drifts toward the falls edge frame right. Team bursts from fog left. | S: waterfall-roar amb. D: P-701 203.5 |
| SH-702 | 206.0 - 215.0 | bg-waterfall | push on huddle | Gunner assigns roles, pointing to each friend in turn. Heads nod. | D: G-702 206.5 |
| SH-703 | 215.0 - 221.0 | bg-waterfall | close Luna | Luna whips rope off Gunner's shoulder, tie-knot anim, loop held up proud. | S: rope-whip 215.5. D: L-703 218.5 |
| SH-704 | 221.0 - 228.0 | bg-waterfall | track Pip flight | Pip rope-carry flight out over water, drops loop over float valve. Click. | S: flap-fast 221.5, hook-click 225.5. D: P-704 226.0 |
| SH-705 | 228.0 - 234.0 | bg-waterfall | low angle on Gunner | Gunner wraps rope across chest, dig-in: paws plant one by one into mud. Beans on a rock, counting down big. | S: paw-dig 229.0. D: B-705 231.0 |
| SH-706 | 234.0 - 244.0 | bg-waterfall | alternating strain cuts | TUG. Rope piano-wire tight, float dead-stops AT the lip, spray flying. Gunner slides an inch at a time, teeth grit. | S: rope-stretch 234.5. M: climax. D: G-706 240.0 |
| SH-707 | 244.0 - 250.0 | bg-waterfall | snap wide | "BIG! HEART!" One giant heave. Float rockets back upstream, beaches. Ducklings tumble out, dizzy-safe. | D: G-707 244.2. S: heave-yank 245.0, slide-thump 247.0, quack-babies 248.0 |
| SH-708 | 250.0 - 262.0 | bg-waterfall | warm push-in | Mama Duck rushes in, wings around ducklings. Team collapses relieved. Victory lines. | S: quack-mama 250.5, flap-land 250.8. M: victory 250.5. D: L-708 255.0, G-709 257.5 |
| SH-801 | 262.0 - 270.0 | bg-golden-meadow | static wide | Golden hour picnic, everyone flopped. Ducklings in leaf party hats. Banter. | M: golden. S: birds-evening amb. D: P-801 262.5, B-802 265.0, P-803 267.6 |
| SH-802 | 270.0 - 279.0 | bg-golden-meadow | slow push on Gunner | The moral, warm and simple. Luna tops it. | D: G-804 270.4, L-805 276.0 |
| SH-803 | 279.0 - 285.0 | bg-golden-meadow | static | Three ducklings waddle over, strike Gunner's hero pose in a row (imprint-pose). Gunner melts. | S: quack-squeak 280.0, pop-cute 280.5. D: G-806 282.0 |
| SH-901 | 285.0 - 292.0 | bg-title-skyline (dusk tint) | static | Theme reprise. Iris-in closes to Gunner winking. | M: theme-reprise. D: G-901 287.0. S: wink-ting 290.0 |
| SH-902 | 292.0 - 300.0 | card-the-end | static | "The End" card. Duckling pops through the iris hole, squeaky quack, iris snaps shut. Music button. Black. | S: quack-squeak 294.5, iris-pop 296.0. M: button 297.0 |

## Notes for cartoon.json

- Ambient SFX (`birds-meadow`, `creek-flow`, `paws-running`, `river-fast`,
  `fog-wind`, `waterfall-roar`, `birds-evening`) loop for the duration of their
  scene and duck under dialogue by 6 dB.
- Music cues crossfade over 1.0 s at scene boundaries; stings overlay.
- Dialogue timings above are line START times; the player drives mouth swaps
  from live audio amplitude, so exact line durations come from the mp3s.
- Run scenes (SH-401..405) scroll the world container; characters run in place.
- The float + ducklings group is one composite actor (float rig with three
  duckling rigs parented) so drift motion is a single tween track.
- Screenplay scene boundaries 4:15/4:45 shifted to 4:22/4:45 here (S7 needed
  the room for the reunion); this sheet is authoritative.
