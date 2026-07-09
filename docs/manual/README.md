# Armature 2D Manual

Armature 2D is a desktop authoring tool for 2D skeletal animation. You import artwork, build a
bone skeleton over it, attach and deform images, animate with keyframed timelines, add particle
effects, and export one portable data format that runtimes play back identically everywhere.

It covers three layers of a production:

1. **Skeletal animation** (the core): bones, slots, image and mesh attachments, skinning and
   weights, IK and transform constraints, skins, and keyframed animations. This is the
   Spine-equivalent editor, implemented from first principles with its own format.
2. **VFX and particles**: a deterministic effects subsystem (emitters, sprite animators, ribbon
   trails) with life curves, seeded playback, and composable effect bundles.
3. **Slot composition** (optional, for slot-game work): grid and reel configuration, symbol
   mapping, win sequencing, feature flows, and cascade choreography, driven strictly by results
   from an external certified math engine.

You only need layers 1 and 2 for general character animation; layer 3 exists for teams shipping
casino-style games and can be ignored entirely otherwise.

## What makes it different

- **Everything is a command.** Every document change goes through an undoable command history.
  Undo/redo is exact, drags coalesce into single undo steps, and there is no second mutation
  path that can corrupt a file.
- **One portable format.** Documents are validated, versioned, hashed JSON (with an optional
  deterministic binary container for shipping). Malformed data fails loudly at load with typed
  errors, never silently.
- **Deterministic playback.** The solve is a pure function: the same document, animation, and
  time always produce the same pose, and the same seed always produces the same particles. A
  conformance suite of committed fixtures keeps every runtime honest.
- **Dual control: human and AI.** The GUI and a headless MCP (Model Context Protocol) server
  drive the exact same command layer. An AI agent or a script can build, inspect, render, and
  save everything a person can, with the same undo history.

## The manual

| Chapter | Contents |
|---|---|
| [1. Getting Started](01-getting-started.md) | Install, build, launch the editor and the MCP server, author your first animated character end to end |
| [2. Core Concepts](02-core-concepts.md) | The document model, commands and undo, document vs editor state, the format contract, architecture |
| [3. Rigging](03-rigging.md) | Bones, slots, draw order, region attachments, meshes, weights, IK, transform constraints, skins |
| [4. Animation](04-animation.md) | Animations, timelines, keyframes and curves, deform keys, the solve order, tracks and crossfades |
| [5. Images and Atlases](05-images-and-atlases.md) | Preparing art, atlas packing, texture resolution, export profiles, compressed texture variants |
| [6. VFX and Particles](06-vfx-particles.md) | Effects, emitter layers, life curves, determinism and seeds, bundles, budgets |
| [7. Slot Composition](07-slot-composition.md) | The math boundary, grids, symbols, win sequences, feature flows, tumbles, the presentation timeline |
| [8. Playback and Export](08-playback-and-export.md) | The runtimes, rendering, saving and exporting, the binary format, conformance |
| [9. Tool Reference](09-tool-reference.md) | The complete MCP tool reference (157 tools), which is also the editor's full capability map |
| [10. Format Reference](10-format-reference.md) | Every document type, field by field, plus validation codes, versioning, and the MRNT binary container |

## A note on current status

The backend of the product (document model, commands, runtimes, formats, MCP control surface,
conformance suite) is complete and CI-verified through the slot composition layer, with
production hardening in progress. The desktop GUI intentionally trails it: authoring panels are
being built on top of the already-finished command layer, phase by phase. Everything in this
manual that is expressed as a tool or command works today, headlessly and in the editor's
command layer; where a GUI surface is still landing, the MCP tools are the complete interface.
Native Unity and Godot runtimes are planned and specified (the TypeScript core is their
behavioral source of truth) but not yet implemented; web playback is complete.

Armature 2D is proprietary software of Viral Ventures LLC, Maple Grove, Minnesota. See the
repository LICENSE file for terms.
