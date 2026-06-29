# Product editions: Armature 2D Essentials and Pro

> Status: direction note (no code yet). Owner: product. Tracked for Phase 4/5; NOT a Phase 2 deliverable.

This note records the intended product direction so it is captured and not lost. It deliberately adds NO
code, NO feature gating, and NO licensing mechanism. Per Law 5 (phase independence, build in order), edition
gating is out of scope until the phase that owns it.

## Name

The user-facing product name is "Armature 2D". The internal codename remains "Marionette": the spec file
(`MARIONETTE_HANDOFF.md`) and the package scope (`@marionette/*`) keep the codename for now. A deep package
rename, if desired, is its own change on its own branch, not folded into a feature phase.

## Editions (intended split, subject to revision)

Armature 2D is planned to ship in two editions sharing one codebase and one portable export format:

- **Essentials**: the core authoring loop. Import art, rig a bone skeleton, region attachments, animation
  (dopesheet, curves, playback), save/load, and export the portable format. The target is a complete,
  shippable 2D character pipeline for straightforward rigs.
- **Pro**: everything in Essentials plus the advanced rigging and composition surface, expected to include
  the Phase 2 rigging stack (mesh deform, linear blend skinning, weight painting, analytic IK, transform
  constraints, named skins, deform timelines), the Phase 3 VFX/particle subsystem, and the Phase 4 slot
  composer. The exact boundary is a product decision to be finalized when the gating mechanism lands.

The split above is provisional. It is recorded only to give later phases a target; the authoritative scope of
each edition is decided when the gating work is scheduled.

## Why no gating now

1. **One format, one runtime contract (Law 3).** Both editions read and write the same `packages/format`
   document. An Essentials document opened in Pro, and vice versa, must remain valid. Gating is a UI/licensing
   concern layered ON TOP of the shared model, never a fork of the format or the command set.
2. **Phase independence (Law 5).** A feature-flag or licensing layer is its own work package with its own
   tests; introducing it mid-Phase-2 would scaffold ahead of the plan of record.
3. **Commands stay universal (Law 2).** Every mutation is a command in `document-core`, shared by the editor
   and the headless MCP server. Edition gating, when it arrives, hides or disables UI affordances; it does not
   remove commands from `document-core` (an automated/MCP client still drives the full surface).

## When this gets built

Revisit during Phase 4 (slot composer) or Phase 5 (production hardening), whichever schedules the packaging
and licensing work. At that point: pin the exact per-edition feature boundary, decide the gating mechanism
(build-time flag, runtime license check, or both), and add it as a dedicated work package with tests. Update
this note from "direction" to "specification" then.
