# @marionette/runtime-web

The TypeScript + PixiJS v8 playback runtime. It renders validated documents by driving
`@marionette/runtime-core` per frame, and it also powers the editor viewport (the editor imports
`SkeletonView` directly), so what you author is what ships: one render path, one placement math.

Dependencies: `@marionette/format`, `@marionette/runtime-core` (workspace), `pixi.js` pinned exact
at `8.19.0`.

This package renders; it never solves. Solving (skeleton pose, mesh deform, particle integration, the slot
directive sequence) is `runtime-core`'s job, and every timing, ordering, and pooling decision here lives in
a pure, headless testable module with the PixiJS calls in a thin adapter over it. That split keeps the web
player, the editor viewport, and the future Unity / Godot runtimes from drifting.

## The supported embedding API: `createPlayer`

`createPlayer` is the one entry point for embedding a finished character or scene in a web page. It loads a
document and its atlas, wires the render views, and hands back a `Player` you drive from your own frame
loop.

```ts
import { createPlayer } from '@marionette/runtime-web';

const player = await createPlayer({
  document: heroBytes, // MRNT binary or JSON bytes, JSON text, or a parsed SkeletonDocument
  atlas: { pages: [{ file: 'hero.png', url: '/hero.png' }] },
  animation: 'idle',
  loop: true,
});

stage.addChild(player.root); // mount under your PixiJS stage
app.ticker.add((ticker) => player.update(ticker.deltaMS / 1000)); // drive with your own clock
```

Every source is validated on import (Law 3); a bad asset throws a typed `PlayerLoadError` whose `code`
distinguishes decode, validation, JSON, and fetch failures.

### `Player`

| Member | Purpose |
| --- | --- |
| `root` | The `Container` to mount. Slot scene at the back, skeleton in the middle, particles on top. |
| `update(deltaSeconds)` | Advance playback by your frame delta. Owns no clock (Law 1 determinism); a paused player ignores the tick. |
| `play()` / `pause()` / `isPlaying()` | Start / stop advancing. |
| `setAnimation(id, loop?)` | Replace track 0 (no crossfade) and render the first frame. |
| `crossfade(id, mixSeconds, loop?)` | Crossfade track 0 into another animation (AnimationState rule 4). |
| `seek(seconds)` | Seek the current animation to an absolute time; the pose is a pure function of the seek time. |
| `setLoop(loop)` | Default loop flag for subsequent `setAnimation` / `seek`. |
| `onEvent(listener)` | Subscribe to fired animation events (returns an unsubscribe). The `FiredEvent` is a transient pooled entry: read it synchronously, do not retain it. |
| `setActiveSkin(name)` / `getSkinNames()` | Runtime skin switching. A costume skin overrides some slots and inherits the rest from `default`. |
| `triggerEffect(effect, anchor, seed?, startTime?)` | Fire a VFX effect by name (requires an `effects` document). |
| `setSlotTimeline(timeline)` | Load a slot spin's `PresentationTimeline` (requires a `slot` scene). |
| `skeletonView` / `particleView` / `slotView` | The underlying views, for advanced use. |
| `destroy()` | Release every GPU / display resource. Not reusable afterward. |

### The `AssetLoader` seam

Every network / texture touch lives behind an injectable `AssetLoader` (`loadBytes`, `loadTexture`). The
default is the browser (`fetch` + the PixiJS `Assets` pipeline); tests and non browser hosts inject their
own, so the whole player is exercisable headlessly with no network and no WebGL. This package uses no Node
built-ins. Atlas pages can be supplied as URLs (loaded and sliced into region textures for you) or as a
prebuilt `RegionTextureResolver`. Premultiplied alpha is a texture property: pages loaded premultiplied
compose correctly with the single `blendModeToPixi` mapping every view shares (no second blend path).

## The three render views

`createPlayer` wires these; use them directly to build a custom host.

### `SkeletonView`

Renders a skeleton at its setup pose (`sync`), a single animation (`syncAnimated` / `syncAnimatedLoop`), or
a multi track `AnimationState` (`syncState`, ADR-0005). What renders: **bones** (tapered diamond
`Graphics`), **region attachments** (`Sprite`, anchor 0.5, slot x attachment tint, world matrix via
`applyWorldToTarget`), and **mesh attachments** (`Mesh` + `MeshGeometry`; UVs / triangles built once, only
the position buffer rewritten in place each frame from the skinned world space vertices).

- **Runtime skin switching** (`setActiveSkin`, `getActiveSkin`, `getSkinNames`): attachment records are
  built across all skins, and each frame resolves the presented attachment under the active skin with a
  default fallback, so a costume skin overrides some slots and inherits the rest. A switch recycles the
  pooled sprites and mesh displays with no structural rebuild.
- **Draw order**: rendering follows the solved `pose.drawOrder` (ADR-0008); the attachment layer children
  are re-appended only when the permutation changes. A setup or no key frame keeps setup slot order.
- **Two-color dark tint** (PP-C8): a slot with a setup `darkColor` renders through a PixiJS v8 two-color
  filter (`two-color-filter.ts`) that applies the shared light+dark formula (`two-color.ts`, the twin of
  render-preview's, asserted by the same parity vectors). The filter is created lazily behind a DOM guard, so
  the headless `describe()` path reports the resolved dark tint without a rendering context.
- **Linked meshes** (PP-C8): a `linkedmesh` renders as a regular mesh built from its resolved parent geometry
  (`resolveRenderMesh`) with the linked mesh's own texture, color, and size; the world vertices come from
  runtime-core (`sampleMeshVertices` resolves the chain when animated).
- **Sequence attachments** (PP-C8): a region / mesh attachment with a `sequence` block swaps its texture to
  the resolved frame's region per sample (named by `sequenceRegionName`), through the pooled texture
  resolver. `describe()` reports the presented region name.
- **Skin-scoped constraints** (PP-C8): `syncAnimated` forwards the active skin to the solve, so a constraint
  a skin scopes toggles with that skin. The multi-track `syncState` path cannot forward the skin yet
  (runtime-core's `applyAnimationState` takes no skin argument), documented in place as a runtime-core
  follow-up.
- `setTextureResolver(resolver)` binds decoded atlas page textures; without one, attachments render as
  tintable 1x1 white placeholders. Atlas trim offsets are applied to placement (`sizeForTexture`, PP-C1)
  and rotated regions slice with a swapped frame + PixiJS `rotate=2` (`sliceRegion`, PP-C2), both mirroring
  `@marionette/render-preview`.

### `ParticleLayerView`

Consumes the `EffectSystem` readonly frames: a pooled `Sprite` per emitter particle (pool sized to the
emitter capacity, never grown per frame, fed by the pure `fillEmitterBatch` bridge), a `MeshGeometry` strip
per ribbon (fed by the pure `ribbon-strip` bridge), and a world / viewport cover quad per sprite animator.
Per layer blend goes through the one `blendModeToPixi` mapping; quality tiers are respected structurally
(the `EffectSystem` tier scales an ambient effect's pool capacity, which the pool follows). Zero per frame
allocation in the steady state.

### `SlotSceneView`

Consumes a `PresentationTimeline` through the allocation free timeline cursor and a pure board reducer:
`reelStop`, `symbolLand`, `symbolAnimate`, and the cascade explode / drop / refill directives fold into a
cell board (matching the drop solver). Renders one pooled `SkeletonView` per grid cell (positioned via the
pure grid layout), plays each symbol's phase animation, and draws a winning cell highlight overlay. The
counter rollup value, VFX bursts, escalation banners, feature flow transitions, and multiplier orbs are
surfaced to host callbacks (the counter text glyph and VFX widgets stay host owned). A backward seek
replays deterministically.

## Headless parity and testing

The suites run in plain Node / Vitest. PixiJS v8 display objects (`Container`, `Sprite`, `Mesh`,
`Graphics`, `MeshGeometry`) construct and expose their transforms without a WebGL context, so the adapters
are asserted structurally (pool counts, child order, blend modes, transforms) via each view's `describe()`
snapshot, and the pure modules (batch bridge, ribbon strip, timeline cursor, board reducer, grid layout,
skin resolution, document decode) are asserted directly. `samplePlaybackWorlds`
(`src/headless/sample-playback.ts`) samples the same playback path with no WebGL, which is how CI proves
editor vs runtime parity (WP-1.13) and how the conformance suite drives the web runtime headlessly.

## What is NOT exercised headlessly

WebGL pixel output cannot be produced in a headless container, so these remain verified only by the pure
logic / structural tests above plus the committed fixtures, not by pixel capture:

- **Compressed texture GPU work** (the WP-5.2 remainder): KTX2 / UASTC transcode, mip generation, and scale
  variants behind the export profile. The variant SELECTION algorithm (`selectTextureVariant`,
  `src/atlas/variant-select.ts`) is pure and tested here; the live GPU capability read and the transcode /
  decode are the GL edge.
- **On device pixel parity**: the offscreen pixel sample of a rendered frame and its comparison against the
  render preview rasterizer.
- **Per vertex ribbon shading**: the ribbon taper's per vertex color / alpha needs a custom shader; the
  strip geometry (positions, UVs, indices) and the per vertex taper data are produced and tested here.
- **Two-color filter pixel output** (PP-C8): the GPU light+dark tint. The pure formula (`two-color.ts`) is
  parity-tested against render-preview, and `describe()` proves the dark lane is read; only the filter's
  actual pixels need a GL context. Web-worker rendering without a `document` takes the single-color fallback.

## Still pending

- **Clipping mask render** (PP-C8 part 2): stencil / geometry clipping, gated on the PP-B2 clip evaluation.
- **Compressed texture GPU work** (WP-5.2, above): transcode, mips, and scale variants at the GL edge.

## Run

```sh
pnpm --filter @marionette/runtime-web typecheck
pnpm --filter @marionette/runtime-web test   # vitest (parity, mesh render, particles, slot, player, skin)
pnpm --filter @marionette/runtime-web build
```

Documents arrive validated; this package passes `verifyHash: false` (runtimes treat the content hash as
opaque).
