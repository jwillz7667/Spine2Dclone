# Chapter 6: VFX and Particles

The effects subsystem authors particle and visual effects as their own document kind, played by
a deterministic simulator. Effects are independent of any skeleton (they attach to anchors at
play time), so one library serves many scenes.

## 6.1 The effects document

An effects document is a library: its own atlas of VFX textures, a map of named **effects**,
and a map of named **bundles** that compose effects into bigger moments.

An effect has:

- `duration`: seconds, or `null` for an endless (looping/ambient) effect;
- `deterministic`: `true` means seeded playback (same seed, same particles, same frames),
  which is mandatory for anything that must replay identically, for example win celebrations
  driven by a game result. `false` marks ambient decoration (dust motes, embers) that may be
  quality-scaled on weak devices;
- `simulationDt`: the fixed simulation step (default 1/60). Simulation always advances in
  fixed sub-steps regardless of display frame rate, which is the root of its determinism;
- `blendMode` and an ordered list of **layers**, drawn bottom to top.

## 6.2 Layer kinds

**Emitter** is the workhorse: it spawns, integrates, and recycles particles from a pooled
buffer (`maxParticles` is a hard cap; pre-allocated, never grown mid-play).

- **Spawn**: `rate` (particles per second), a single `burst` (count at a time), or a `bursts`
  schedule (ascending times). Rate plus a burst list covers fountains, explosions, and
  multi-hit impacts.
- **Shape**: where particles are born relative to the anchor: `point`, `line`, `circle`
  (optionally edge-only, good for rings), or `rect`.
- **Randomized ranges**: `lifetime`, `startSpeed`, `emissionAngle`, `startRotation`,
  `angularVelocity`, `startScale`, each a `{ min, max }`. Equal min and max means a constant
  (and, in deterministic effects, consumes no random draws, which keeps seeds stable when you
  pin a value).
- **Forces**: `gravity` and `acceleration` vectors, plus scalar `drag`. Integration is
  semi-implicit Euler in a fixed operation order.
- **Life curves**: `scaleOverLife`, `colorOverLife`, `alphaOverLife` shape each particle over
  its normalized lifetime (see 6.3).
- **Texture**: a `static` region or an `animated` flipbook (`regions`, `fps`, and a mode:
  `loop`, `once`, or `overLife`, which maps the flipbook across the particle's lifetime).
- **Trail**: optionally, each particle drags a ribbon (`region`, `maxSegments`,
  `segmentSpacing`, width/alpha over the trail's length).

**Sprite animator**: one non-particle sprite with rotation speed, life curves, looping, and a
duration; `anchorSpace` can be `world` (in the scene) or `screen` (overlays such as full-screen
flashes and god-ray sheets).

**Ribbon trail**: a standalone ribbon that follows a moving anchor (`anchorRef`), with width,
color, and alpha profiled over the ribbon's length. Use for motion streaks and magic wisps.

## 6.3 Life curves

Life curves are gradient-style stop lists: at least two stops, the first pinned at `t = 0`, the
last at `t = 1`, strictly ascending, each stop holding a scalar or RGB value plus an easing to
the next stop (the same linear/stepped/bezier vocabulary as animation keys).

The standard sparkle recipe is three stops on alpha (0 at birth, 1 quickly, 0 at death) and a
shrinking scale curve. Because stops are validated (anchors protected, order enforced), a
malformed curve is a load error, not a runtime surprise.

## 6.4 Determinism, seeds, and budgets

- Deterministic effects draw all randomness from a specified integer PRNG seeded per trigger.
  Replays, tests, and cross-runtime conformance rely on this: the fixture suite pins exact
  particle counts and positions per frame.
- A global particle budget guards the frame: when the live-particle cap is hit, the system
  evicts oldest-first from the lowest-priority effects, ambient before deterministic, and
  reports a budget warning. Authored (deterministic) effects keep their counts; ambient ones
  absorb the squeeze.
- Quality tiers (low/medium/high) scale spawn rate and pool caps for AMBIENT effects only, so
  a weak phone drops decorative particles, never the choreographed moment.

## 6.5 Bundles and anchors

A bundle is a named playlist of effects: each item is an effect name, a `startOffset` in
seconds, an `anchorRole`, and a `seedSalt`. Triggering a bundle with one base seed derives each
item's seed from the salt, so an entire composed moment (flash, then coin burst, then rays,
then lingering sparkle) replays identically from one number.

Anchor roles are logical names, not coordinates: the HOST resolves `"grid-center"` or
`"reel-3-top"` (or a bone anchor on a skeleton) to positions at play time. This keeps effects
reusable across scenes and screen sizes.

## 6.6 Authoring workflow

1. Pack VFX textures into the effects atlas (`effect.setAtlas`); regions must exist before
   layers reference them.
2. `effect.create`, then `effect.layer.add` and shape each layer with
   `effect.layer.setField`.
3. Tune life curves with the `effect.lifeStop.*` tools.
4. Preview headlessly by rendering composed frames (`render_frame` with the `effect` option,
   passing a seed and time) or watch it live in the editor viewport.
5. Compose the moment as a bundle and trigger it from the host with one seed.

Blend mode advice: `additive` is the default for energy (sparks, glows, rays) and stacks
brightly; `normal` for smoke, debris, and anything with body; `screen` when additive blows out
on light backgrounds.

## 6.7 Playing effects from a host

```ts
import { EffectSystem } from '@marionette/runtime-core';

const system = new EffectSystem(effectsDoc, {
  maxLiveParticles: 2000,
  qualityTier: 'high',
  resolveBone,                       // lets anchors track skeleton bones
  onWarning: (w) => console.warn(w),
});

const id = system.trigger({ effect: 'coin-burst', anchor, seed: 1234, startTime: 0 });
// per frame:
system.step(dt);
const frame = system.readState();    // packed particle data for the renderer
```

`stop(id)` is a soft stop (spawning ceases, live particles finish); `stop(id, true)` clears
instantly. `triggerBundle` does the same for a whole bundle with per-item derived seeds.
