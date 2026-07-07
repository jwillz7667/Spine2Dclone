# Chapter 7: Slot Composition

The slot composition layer assembles skeletal characters and VFX into a playable slot-game
scene: a grid of animated symbols, win presentations, feature flows, and cascade choreography.
If you are not building slot games, skip this chapter; nothing else depends on it.

## 7.1 The math boundary

The single non-negotiable rule of this layer: **presentation never decides outcomes.**

A certified external math engine produces a `SpinResult` (the landed grid, win lines, total
win, feature events, cascade steps). The composition layer is a pure function FROM that result
TO a presentation timeline. The same result plus the same scene document yields a deep-equal
timeline every time, on every runtime. There is no code path where the presentation layer picks
a symbol, adjusts a payout, or teases an outcome the result does not imply; the scene document
has no field that could even express it, and results are validated on receipt but never stored
in any document.

During development a mock engine plays committed, deterministic scenario results (big win,
free-spin trigger, cascade chain, dead spin) so the whole presentation can be authored and
tested before the real engine is wired in. Swapping mock for real changes no authored data.

## 7.2 The scene document

A slot scene document (Chapter 10.5) holds five authored aggregates plus pinned references:

**Grid**: the board geometry and feel. Topology (`reelStrip`, `scatterPay`, or `cluster`),
columns and rows, cell size and gap, the per-reel stop stagger in ms, gravity direction, and
anticipation rules (which symbols arm it, how many are needed, how many columns may
anticipate). Presets exist for the three canonical layouts (5x3 reels, 6x5 scatter, 7x7
cluster).

**Symbols**: each symbol id maps to a skeleton document reference and the animation names to
play per state: `idle`, `land`, `win`, and optionally `anticipation`. Symbols are full
skeletal characters, so everything in Chapters 3 and 4 applies to them.

**Win sequencer**: named step lists that choreograph a win. Each step has a time offset, a
target (`allWinningCells`, a line by index, or all cells of one symbol) and an action (play
win animations, fire a VFX preset at each cell or the grid center, start the win counter
rollup, or show an escalation banner). Thresholds define the `big`/`mega`/`epic` tiers as
win-to-bet multiples, and each tier can select a different sequence.

**Feature flows**: a state machine (`states`, `transitions`, entry always `base`) describing
how the game moves between base game, free spins, and bonuses in response to feature events in
the result. States can carry cinematics (a VFX preset and/or an animation) played on entry.

**Tumble choreography**: the timing envelope for cascades: explode, drop (with a named
easing), refill stagger, settle, gap between steps, and the rollup curve.

`refs` pins every referenced skeleton and VFX document by name AND content hash; a scene
cannot load against silently edited assets.

## 7.3 From result to timeline

The sequencer turns `(SpinResult, scene)` into a **presentation timeline**: a sorted list of
directives, each with an integer millisecond time and a sequence number. Directive kinds:
`reelStop`, `symbolLand`, `symbolAnimate`, `vfxBurst`, `counterRollup`, `escalation`,
`flowEnter`/`flowExit`, `multiplierOrb`, and the cascade set (`cascadeExplode`,
`cascadeDrop`, `cascadeRefill`).

The stages, in order:

1. **Landing**: per column left to right, staggered by the grid's stop stagger: reel stop,
   symbol land, then idle.
2. **Anticipation**: armed purely from the landed grid and the authored rules.
3. **Win sequence**: the crossed tier picks the sequence; steps expand into animate/VFX/rollup
   directives. Win amounts roll up with pinned integer fixed-point math so every runtime
   displays the same number on the same frame.
4. **Feature flow**: feature events walk the state machine, emitting enter/exit directives and
   entry cinematics.
5. **Cascades**: per step, explode the removed cells, drop survivors (a pure column-gravity
   solver), refill with the engine's symbols verbatim, and chain the win counter.
6. **Escalation**: banner directives for each crossed tier.

Hosts play a timeline with a forward-only cursor: advance it to the current time each frame
and it fires each directive exactly once, allocation-free. The cursor also answers "what should
the win counter display right now" using the same pinned rollup math.

## 7.4 Authoring workflow

1. Author symbol skeletons with the four state animations, and VFX presets for the moments
   (Chapters 3, 4, 6).
2. Set the grid (or apply a preset), map symbols (`slot.symbol.map`).
3. Build win sequences and thresholds (`slot.winseq.*`).
4. Define the feature flow graph (`slot.flow.*`) matching the math engine's feature events.
5. Set tumble timing if the game cascades (`slot.tumble.set`).
6. Run mock-engine scenarios through the sequencer and review the resulting timelines; because
   they are deterministic data, they diff cleanly and are directly assertable in tests.
