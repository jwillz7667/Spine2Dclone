# Chapter 1: Getting Started

This chapter takes you from a clean checkout to a saved, animated, rendered character.

## 1.1 Prerequisites

- **Node.js 22.13 or newer** (the repo pins 22.13.1 for byte-exact fixture generation; any
  22.13+ works for authoring).
- **pnpm 11** (the repo declares `packageManager: pnpm@11.8.0`; `corepack enable` gives you the
  right one automatically).

```sh
git clone <repo>
cd <repo>
pnpm install
pnpm build          # builds all packages through Turborepo
pnpm test           # optional: run the full unit + conformance suite
```

## 1.2 The two front doors

Armature 2D has two equivalent control surfaces on top of one command layer:

**The desktop editor** (Electron + React + PixiJS):

```sh
pnpm --filter editor dev
```

This opens the editor shell with dockable hierarchy, viewport, and inspector panels. You can
pan/zoom the viewport, create bones by dragging, move and rotate them with the gizmo, undo and
redo, and save/load documents.

**The headless MCP server** (for scripts, agents, and CI):

```sh
pnpm --filter @marionette/mcp-server build
node packages/mcp-server/dist/cli.js
```

This starts a stdio MCP server exposing 142 tools (Chapter 9). Point any MCP client at it, for
example in a Claude Code MCP configuration:

```jsonc
{
  "mcpServers": {
    "armature": { "command": "node", "args": ["<repo>/packages/mcp-server/dist/cli.js"] }
  }
}
```

Everything below uses the tool names; in the editor the same operations are menu items, panel
buttons, and gizmo drags backed by the identical commands.

## 1.3 Your first character, end to end

The workflow for any rig is always the same five steps: images in, skeleton over them,
attachments on slots, keyframes in animations, save.

### Step 1: Prepare and pack your images

Put each body part in its own transparent PNG in one directory, for example:

```
my-project/parts/
  torso.png
  head.png
  arm.png
```

Create a document and pack the parts into an atlas:

```
document.new       { name: "hero" }                       -> { documentId: "doc_1" }
atlas.pack         { documentId: "doc_1",
                     sourceDir: "parts",
                     outputDir: "atlas" }                 -> writes atlas-0.png, installs the atlas
```

Packing is deterministic: the same inputs always produce the same pages and regions. Each
region keeps the source file's base name, so `torso.png` becomes region `torso`.

### Step 2: Build the skeleton

Bones form a tree. Create a root, then children; positions are in the parent's local space.

```
bone.create  { documentId, parentId: null,     name: "hip",   x: 0,  y: 0 }        -> boneId hip
bone.create  { documentId, parentId: <hip>,    name: "torso", x: 0,  y: 20, length: 80 }
bone.create  { documentId, parentId: <torso>,  name: "head",  x: 0,  y: 90, length: 40 }
bone.create  { documentId, parentId: <torso>,  name: "arm",   x: 10, y: 70, length: 60, rotation: -30 }
```

Bone lengths are cosmetic for rendering the bone itself but matter for IK and for your own
sanity in the viewport. Rotation is degrees, counterclockwise.

### Step 3: Slots and attachments

A slot is a draw-order position owned by a bone; an attachment is the image in it.

```
slot.create        { documentId, boneId: <torso>, name: "torso" }   -> slotId
attach.region.add  { documentId, slotId: <torso>, name: "torso", path: "torso",
                     width: 256, height: 512 }
slot.activeAttachment { documentId, slotId: <torso>, attachment: "torso" }
```

Two things to remember:

- `path` must name an atlas region; `width`/`height` are the source pixel size of the image.
- Adding an attachment does NOT display it. Setting `slot.activeAttachment` does. Forgetting
  this is the single most common "why is my character invisible" mistake.

Repeat for the head and arm. Slots render in creation order; use `slot.reorder` to fix
layering (higher index draws on top).

### Step 4: Animate

```
anim.create { documentId, name: "idle", duration: 2.0 }    -> animationId
kf.set      { documentId, animationId, channel: "rotate", boneId: <arm>,
              time: 0.0, value: { angle: -30 } }
kf.set      { documentId, animationId, channel: "rotate", boneId: <arm>,
              time: 1.0, value: { angle: -18 },
              curve: { type: "bezier", cx1: 0.25, cy1: 0, cx2: 0.75, cy2: 1 } }
kf.set      { documentId, animationId, channel: "rotate", boneId: <arm>,
              time: 2.0, value: { angle: -30 } }
```

That is a 2-second breathing arm swing. Keys hold a value at a time; each key's `curve` eases
toward the NEXT key (`linear`, `stepped`, or a cubic bezier). First and last keys matching
makes the loop seamless.

### Step 5: Look at it, validate it, save it

```
render_frame      { documentId, animation: "idle", time: 0.5, width: 512, height: 512 }
                  -> { pngBase64, ... }        a rendered frame you can inspect
document.validate { documentId }               -> { ok: true, errors: [] }
document.save     { documentId, path: "hero.skel.json" }
```

`render_frame` is a real renderer (CPU rasterizer with the same solve as the web runtime), so
what you see is what ships. If `validate` returns errors, each one carries a stable code and a
JSON pointer to the offending field (Chapter 10 lists them all).

## 1.4 Playing it back

The saved document plays in any host through `@marionette/runtime-web` (PixiJS v8):

```ts
import { parseDocument } from '@marionette/format';
import { SkeletonView, buildRegionTextures, makeRegionTextureResolver } from '@marionette/runtime-web';

const doc = parseDocument(JSON.parse(fileText));    // throws with typed errors if malformed
const view = new SkeletonView();
view.setTextureResolver(makeRegionTextureResolver(buildRegionTextures(doc.atlas, pageTextures)));
app.stage.addChild(view.root);

let elapsed = 0;
app.ticker.add((t) => {
  elapsed += t.deltaMS / 1000;
  view.syncAnimatedLoop(doc, 'idle', elapsed);      // loops the idle animation
});
```

Chapter 8 covers playback in depth, including multi-track animation state and crossfades.

## 1.5 Undo, redo, and gestures

Every mutation above went through the command history. `history.undo` and `history.redo` walk
it exactly. When scripting a continuous gesture (say, interpolating a drag across 50 small
moves), wrap it so it becomes ONE undo step:

```
history.beginInteraction { documentId }
bone.move ... bone.move ... bone.move ...
history.endInteraction   { documentId, label: "Drag arm" }
```

In the editor this happens automatically: a drag, a timeline scrub, or a weight-paint stroke
is always a single undo entry.

## 1.6 Where to go next

- Chapter 2 explains the architecture these steps rode on, which pays off the first time
  something surprises you.
- Chapter 3 goes deep on rigging: meshes, weights, IK legs, transform constraints, skins.
- Chapter 4 covers animation beyond one bone channel: color, attachment swaps, deform keys,
  and runtime crossfading.
