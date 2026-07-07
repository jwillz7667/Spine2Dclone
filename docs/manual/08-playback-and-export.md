# Chapter 8: Playback and Export

Everything you author exists to be played back somewhere else. This chapter covers the runtime
APIs a host integrates, the export paths, the binary shipping format, and the conformance
system that keeps every player honest.

## 8.1 The runtime split

Playback is two layers by design:

- `@marionette/runtime-core` SOLVES: pure TypeScript, no renderer, no DOM, no clock, no RNG.
  Given a document, an animation, and a time, it produces bone world matrices, slot colors,
  active attachments, and skinned mesh vertices. This package is the behavioral source of
  truth that native runtimes port function for function.
- `@marionette/runtime-web` RENDERS: PixiJS v8 sprites and meshes driven by what core solved.
  The editor viewport uses this same package, so the editor is never a different renderer from
  production.

## 8.2 Playing a skeleton (runtime-web)

```ts
import { parseDocument } from '@marionette/format';
import {
  SkeletonView, buildRegionTextures, makeRegionTextureResolver,
} from '@marionette/runtime-web';

const doc = parseDocument(JSON.parse(fileText));
const view = new SkeletonView();
view.setTextureResolver(makeRegionTextureResolver(buildRegionTextures(doc.atlas, pageTextures)));
stage.addChild(view.root);
```

Then, per frame, one of three drive modes:

- `view.syncAnimated(doc, 'walk', t)`: sample one animation at an absolute time (clamped at
  the ends).
- `view.syncAnimatedLoop(doc, 'walk', elapsed)`: same, with time wrapped for looping.
- `view.syncState(doc, state)`: full multi-track playback via an animation state (below).

The view caches the scene per document, pools display objects, and does no per-frame
allocation; you own the ticker and pass time in.

## 8.3 Animation state: tracks, crossfades, queues

For real characters, drive playback through the animation state machine in runtime-core:

```ts
import {
  makeAnimationState, setAnimation, crossfadeTo, queueAnimation, updateAnimationState,
} from '@marionette/runtime-core';

const state = makeAnimationState(doc);
setAnimation(state, 0, 'idle', true);            // track 0, looping

// on input:
crossfadeTo(state, 0, 'walk', true, 0.2);        // 0.2 s mix
queueAnimation(state, 0, 'idle', true, 0);       // after the current entry completes

// per frame:
updateAnimationState(state, dt);
view.syncState(doc, state);
```

Tracks layer in ascending order (track 0 is the base; higher tracks override or add on top via
each entry's `alpha` and `additive` flags). Crossfades ease linearly, rotations blend along
the shortest arc, and discrete channels (attachment swaps, IK bend) resolve to the
higher-weight side. Chapter 4.7 covers the authoring implications.

## 8.4 Headless rendering

Two paths render without a GPU or a browser:

- `render_frame` (MCP) rasterizes any document, animation, time, and optional VFX overlay to
  PNG through a deterministic CPU renderer that shares the runtime-core solve. This is how
  scripts and agents SEE their work, and how visual regression tests pin frames.
- `SkeletonView.describe()` returns a structured scene description (what would be drawn,
  where, with what tint), which is what most rendering tests assert against.

## 8.5 Saving, exporting, and the binary format

- `document.save` writes validated format JSON; this is the editing format and stays the
  source of truth in version control.
- `document.export` returns the same portable JSON in memory (for pipelines).
- **MRNT** is the shipping container: a compact, deterministic, lossless binary encoding of
  the same document (Chapter 10.7). Encoding is byte-stable (same document, same bytes), CRC
  protected, and decoding runs the SAME validator as JSON, so the binary path can never admit
  a document the JSON path would reject. Effects and slot-scene documents currently ship as
  JSON; MRNT covers skeletons.
- Atlas pages ship as PNG plus optional compressed variants per the export profile
  (Chapter 5.4); the web runtime selects ASTC, BC7, ETC2, or PNG at load in a fixed
  deterministic order based on GPU capabilities.

## 8.6 Conformance: how runtimes stay identical

The conformance package is the behavioral contract in executable form:

- A committed corpus of reference rigs (bone chains, rigid and weighted meshes, one and two
  bone IK, transform constraints, deform), effects rigs, animation-state scenarios, and slot
  spin-plus-scene pairs, each with expected-output fixtures and hash locks. Every rig also has
  its MRNT binary twin, verified to decode identically and re-encode byte-for-byte.
- Fixtures are GENERATED from runtime-core, so core is definitionally correct and every other
  implementation is measured against it. Integer lanes (particle counts, draw order, frame
  indices, displayed rollup values) must match exactly; float lanes match within pinned
  tolerances.
- Changing solve behavior means regenerating fixtures in the same reviewed change; drift fails
  CI.

Native Unity and Godot runtimes are planned, not yet implemented. Their acceptance criteria
already exist: load the committed binary rigs, replay the sample specs, match the fixtures,
reproduce the PRNG golden vectors, and emit byte-equal presentation timelines. The TypeScript
packages were shaped for that port (no renderer types in core, typed arrays, fixed-step
simulation, integer math where displays must agree).

## 8.7 Performance model

The runtime is allocation-free per frame by design: poses solve into pre-allocated typed
arrays, particles live in fixed pools, render batches reuse buffers, and region textures are
sub-windows of page textures (one GPU upload per page). Hosts keep that promise by:

- reusing one `SkeletonView` per character instance rather than rebuilding;
- passing `dt` from their ticker instead of letting anything read a clock;
- respecting the particle budget and quality tiers on mobile (Chapter 6.4);
- keeping a character's atlas to one page where possible (Chapter 5.5).

## 8.8 Known gaps in this version

Stated plainly so integration plans can rely on them:

- No animation event track yet (Chapter 4.8).
- Blend modes are per-slot document state, not animatable.
- Multi-track mesh DEFORM blending is scoped to the base track's current animation; bone and
  color channels blend across tracks fully.
- Rotated atlas regions are not consumed by the web runtime (the built-in packer never emits
  them; only relevant for externally packed atlases).
- Unity and Godot runtimes are specified but not shipped; web is the production runtime today.
