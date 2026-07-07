# Chapter 2: Core Concepts

Armature 2D is built around a small number of hard rules. Knowing them explains almost every
behavior you will meet in the tool, and every error message you will ever see.

## 2.1 The document is the product

Everything you author lives in a **document**. There are three document kinds, each a
validated, versioned JSON file:

- a **skeleton document**: bones, slots, skins, attachments, constraints, animations, atlas
  reference;
- an **effects document**: a library of particle/VFX effects and bundles with its own atlas;
- a **slot scene document**: grid, symbol mappings, win sequences, feature flows, tumble
  choreography (only used for slot-game work).

Documents reference each other by name plus content hash, so a composition can never silently
play against an edited asset.

The format is the one expensive-to-change contract in the system. It has its own semver
(`formatVersion`), independent of the app version. Old documents migrate forward automatically
at load through tested migrations; documents newer than the app refuse to load rather than
half-load. Chapter 10 is the complete field-level reference.

## 2.2 Every mutation is a command

There is exactly one legal way to change a document: execute a **command**. A command knows how
to `do` its change and how to `undo` it exactly. Commands are pushed onto a **history**, which
gives you:

- exact undo/redo (do then undo always restores a deep-equal prior state; this is tested for
  every command in the codebase);
- **coalescing**: rapid same-target edits inside a 250 ms window merge into one history entry,
  and an explicit interaction (a drag, a scrub, a paint stroke, or a scripted
  `beginInteraction`/`endInteraction` pair) always commits as one entry no matter how many
  edits it contained;
- a single source of truth for "what changed", which the UI, the MCP server, and tests all
  observe through the same commit events.

The write surface is structurally locked down: the mutator object that commands use is not
exported from the package and cannot be forged, so no panel, plugin, or script can reach around
the history. If you ever wonder "can X corrupt my undo stack", the answer is no, because X
cannot mutate the document at all except through a command.

Practical consequences:

- Undo depth is 500 entries by default.
- A canceled gesture (Escape mid-drag) unwinds cleanly and pushes nothing.
- Selection changes are NOT undoable; see the next section.

## 2.3 Document state vs editor state

Two kinds of state exist and never mix:

| Document state (undoable, saved) | Editor state (ephemeral, never saved) |
|---|---|
| bones, slots, skins, attachments | current selection |
| constraints, animations, timelines | active tool |
| deform keys, draw order, atlas refs | viewport camera (pan/zoom) |
| effects, bundles, slot scene config | playhead position, open animation |
| | panel layout |

Selecting a bone is not a change to the document, so it is not undoable and never dirties the
file. Moving a bone is. After an undo, the editor re-selects sensibly using hints the command
system attaches to history events, but that is a courtesy of the UI, not document data.

## 2.4 Deterministic by construction

The renderer never decides anything. Playback is a pure function:

- **Pose**: the same document, animation name, and time always produce the same bone worlds,
  slot colors, and mesh vertices, on every runtime, forever. There is no clock and no RNG in
  the solve; hosts pass time in.
- **Particles**: a deterministic effect with the same seed produces the same particles on the
  same frames, using a fixed simulation timestep and a specified integer PRNG.
- **Slot presentation**: the same engine result and the same scene document produce a
  deep-equal presentation timeline.

A conformance suite of committed reference rigs and expected-output fixtures enforces this
across runtimes; changing solve behavior means deliberately regenerating fixtures under review,
never drifting.

For slot-game work this hardens into an absolute boundary (Law 1 internally): presentation is a
function OF a `SpinResult` from the certified math engine and can never influence or invent an
outcome. The command context contains no RNG, no clock, and no spin data, so a document
literally cannot express "decide a symbol here".

## 2.5 One command layer, two drivers

The GUI and the headless MCP server are peers on top of the same package
(`@marionette/document-core`). A gizmo drag and an MCP `bone.move` call construct the same
command class and execute it on the same history. That is why:

- this manual can document tools (Chapter 9) and have that double as the editor's capability
  map;
- an AI agent can co-author scenes with full undo interleaved with a human's edits;
- headless CI can rig, animate, render, and validate real documents with zero GUI.

The MCP server holds up to 16 open documents at once, each an independent session with its own
history. Tool input schemas derive from the same Zod schemas as the format, so the scripting
surface cannot drift from the file format.

## 2.6 The architecture at a glance

Dependencies point one way only; each arrow is machine-enforced by lint rules with guard tests:

```
format  <-  runtime-core  <-  runtime-web  <-  editor viewport
format  <-  document-core <-  editor renderer
                          <-  mcp-server
format  <-  atlas-pack, render-preview, conformance, math-bridge
```

- `format`: schemas, validators, versioning, hashing, the MRNT binary codec. Imports nothing
  internal.
- `runtime-core`: the platform-agnostic solve (pure TypeScript, no renderer imports). This is
  the behavioral source of truth that native runtimes port.
- `runtime-web`: PixiJS v8 rendering of what runtime-core solves; also powers the editor
  viewport, so the editor shows exactly what ships.
- `document-core`: the document model, commands, and history.
- `mcp-server`: the headless control surface.
- `atlas-pack`: deterministic texture packing.
- `render-preview`: a CPU rasterizer for headless rendering (`render_frame`).
- `math-bridge`: the typed boundary to an external math engine (slot games only).
- `conformance`: reference rigs, fixtures, and the cross-runtime comparison harness.

Runtimes only ever READ documents; only the export path WRITES them.

## 2.7 Failing loudly

Every external boundary validates. A malformed file, a bad IPC payload, or an invalid tool
input produces a typed error with a stable code and a precise path, never a partial load or a
silent default. When you see `BONE_ORDER_VIOLATION` at `/bones/7`, that is the validator doing
its job; Chapter 10 explains every code. Content hashes (SHA-256 over canonical JSON) catch
files edited outside the tool.
