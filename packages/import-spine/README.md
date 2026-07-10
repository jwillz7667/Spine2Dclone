# @marionette/import-spine

Import-only, strictly clean-room importer that converts a user-owned exported Spine project into a
validated `@marionette/format` document (PP-A5). It is the single sanctioned exception to LAW 4 (owner
directive 2026-07-08): it lets a Spine user migrate their own project into Armature 2D on import. The
package PRODUCES our validated format and nothing else; it never writes, exports, or round-trips any
Spine format.

## Legal posture (read first)

- **Import only.** No code path serializes to `.skel` or Spine JSON. We never claim Spine compatibility
  as a specification promise.
- **Strict clean room.** Every field mapping in this package is derived EXCLUSIVELY from Esoteric's
  PUBLISHED format documentation (the public JSON and binary format reference pages) and from inspecting
  user-owned exported files. No Spine runtime or editor source was consulted, opened, or referenced while
  building it, and none may be.
- **Fail loud, never guess.** A construct that the published documentation does not let us convert
  faithfully is surfaced as a typed `SpineImportWarning` (feature, path, reason), never silently dropped
  or approximated. A malformed input is a typed `SpineImportError`. The importer NEVER emits a document
  that does not pass `validateDocument`.
- **Quarantined.** This package imports `@marionette/format` and nothing else in-repo; only the editor
  import flow and the MCP server may import it (enforced by the boundary lint and the package allowlist).

## API

- `importSpineJson(input: unknown, options?: { name?: string }): SpineImportResult` (`src/import-json.ts`).
  Pure and deterministic (no I/O, no globals, no clock, no RNG): same input in produces the same result
  out. On success it returns `{ ok: true, document, warnings }` with a VALIDATED format 0.6.0
  `SkeletonDocument`; on failure `{ ok: false, errors, warnings }`. `input` is the already-parsed JSON
  value (the caller reads the file); `options.name` supplies the document name (Spine JSON has none),
  defaulting to `imported-skeleton`.
- Typed diagnostics: `SpineImportError` (`code`, `path`, `message`, `detail?`) and `SpineImportWarning`
  (`feature`, `path`, `why`, `detail?`). Error codes are `SPINE_ROOT_INVALID`, `SPINE_VERSION_MISSING`,
  `SPINE_VERSION_UNSUPPORTED`, `SPINE_SCHEMA`, `SPINE_COLOR_INVALID`, `SPINE_DOCUMENT_INVALID` (the last
  carries the underlying `FormatErrorCode` in `detail.formatCode`).

## Version handling

The version lives in `skeleton.spine`. The importer accepts the documented Spine 4.x JSON shape (major
version 4) and rejects any other major version with `SPINE_VERSION_UNSUPPORTED`. An absent skeleton block
or version string is `SPINE_VERSION_MISSING`.

## Convention mappings

Every decision below is derived from the published documentation. The most important finding: Armature's
coordinate and rotation conventions coincide with Spine's published conventions, so geometry maps by
identity (no axis flip, no angle negation).

| Concept | Spine (published) | Armature format | Conversion |
|---|---|---|---|
| Coordinate space | +Y up; bone x/y parent-local; attachment x/y slot-bone-local | +Y up; same locality | Identity |
| Rotation | degrees, counterclockwise positive | degrees, counterclockwise positive | Identity |
| Scale / shear | scaleX/scaleY (default 1), shearX/shearY degrees (default 0) | same | Identity |
| Color | hex string `RRGGBBAA` (8) or `RRGGBB` (6, opaque) | RGBA floats in [0, 1] | channel / 255; 6 digit sets alpha 1 |
| Bone inherit mode | `transform`: normal, onlyTranslation, noRotationOrReflection, noScale, noScaleOrReflection | `transformMode` (same identifiers) | Identity |
| Blend mode | `blend`: normal, additive, multiply, screen | `blendMode` (same) | Identity |
| Slot dark tint | `dark`: 6 digit RGB | `darkColor`: RGBA | parse RGB, alpha 1 |
| Region `path` | texture lookup, defaults to attachment name | `path` | `path` if present else the attachment name |
| Weighted vertices | `[boneCount, (boneIndex, bindX, bindY, weight) * boneCount, ...]` | same stream + derived `bones` manifest | stream carried through; `bones` = ascending unique referenced indices |
| Unweighted vertices | flat `[x, y, ...]` (`vertices.length == 2 * vertexCount`) | flat `vertices`, no `bones` | carried through |
| Mesh `hull` | count of hull vertices | `hullLength` | Identity |
| Linked mesh | `parent`, `skin` (default "default"), `deform` (default true) | `parent`, `skin?`, `timelines` | `skin` defaults to "default"; `deform` maps to `timelines` |
| IK bend | `bendPositive` boolean (default true) | signed `bend` (+1 / -1) | true to +1, false to -1 |
| IK depth | `mix` (1), `softness` (0), `stretch`/`compress`/`uniform` (false) | same | Identity |
| Transform mixes | `rotateMix`, `translateMix`, `scaleMix`, `shearMix` (each 1) | per-axis `mixRotate`, `mixX`, `mixY`, `mixScaleX`, `mixScaleY`, `mixShearY` | translateMix drives mixX and mixY; scaleMix drives both scale mixes |
| Transform offsets | `rotation`, `x`, `y`, `scaleX`, `scaleY`, `shearY` | `offsetRotation`, `offsetX`, `offsetY`, `offsetScaleX`, `offsetScaleY`, `offsetShearY` | map by name |
| Path modes | `positionMode` fixed/percent; `spacingMode` length/fixed/percent; `rotateMode` tangent/chain/chain scale | same, plus `spacingMode` proportional; `rotateMode` chainScale | identity; "chain scale" to "chainScale" |
| Path mixes | `rotateMix`, `translateMix` | `mixRotate`, `mixX`, `mixY` | translateMix drives mixX and mixY |
| Keyframe curve | absent (linear), "stepped", or bezier as `curve` number + `c2`/`c3`/`c4` or `[cx1, cy1, cx2, cy2]` | `linear` / `stepped` / `{ type: bezier, cx1, cy1, cx2, cy2 }` | both bezier encodings supported; flat defaults cy1 0, cx2 1, cy2 1 |
| Bone tracks | `rotate` (angle), `translate`/`scale`/`shear` (x, y) | joint bone timelines | map by name; scale defaults 1, others 0 |
| Slot color track | `color` (8 hex); two-color `light` + `dark` | `color` track; two-color light to `color`, dark to `dark` track | see below |
| Deform track | per-key `offset` (floats to skip) + `vertices` deltas | full flat `offsets` of length 2 * V | deltas placed at `offset`, padded with zeros to 2 * V |
| Events | `events` object (name to definition); `int`/`float`/`string`, `audio` + `volume`/`balance` | `events` array of EventDef with nested `audio` | object to array; audio path lifts volume (1) and balance (0) |
| Skins | 4.x array of `{ name, attachments, bones, ik, transform, path }` | `{ name, attachments, bones?, constraints? }` | ik + transform + path name lists merge into `constraints` |
| Atlas | not in JSON (lives in sibling `.atlas`) | required `atlas` with resolvable region names | placeholder regions synthesized per referenced path (warning) |

Two-color detail: our format splits a Spine two-color timeline into a `color` track (from `light`) and a
`dark` track (from `dark`). A dark track requires the slot to carry a setup dark color; when the Spine
slot has none, a black opaque setup dark color is synthesized (with a `two-color-synthesized-dark`
warning) so the animation stays representable.

## Unsupported features (surfaced as warnings, never silent)

- **Physics constraints and physics timelines** (`physics-constraint`, `physics-timeline`): the physics
  JSON field layout is outside the published documentation this importer was built from, so physics is not
  converted (an empty `physicsConstraints` list and empty per-animation `physics` are emitted).
- **Draw-order timelines** (`draw-order-timeline`): reconstructing Spine's offset-shift permutation is a
  runtime algorithm not specified in the published documentation, so it is not re-encoded into our offset
  model rather than guessed.
- **Frame-sequence attachment playback** (`sequence-attachment`): the attachment `sequence` sub-block is
  outside the consulted documentation, so the attachment is imported without it.
- **Per-key event audio overrides** (`event-audio-override`): our event timeline keys carry
  int/float/string overrides only; a keyed volume/balance override is dropped (the event definition
  default still applies).
- **Weighted bounding-box and clipping polygons**: our format models these as unweighted polygons, so a
  weighted one is dropped with a note.
- **Atlas geometry** (`atlas-synthesized`): Spine JSON carries no region rectangles; placeholder regions
  are synthesized so paths resolve. Import the sibling `.atlas` through `atlas-pack` for real UVs.

Known edge: an animation whose only keyframes sit at time 0 has zero duration, which our format rejects
(`ANIM_DURATION`); such a degenerate animation fails import loudly rather than being silently altered.

## Run and test

```
pnpm --filter @marionette/import-spine build      # tsc project build
pnpm --filter @marionette/import-spine typecheck   # tsc --noEmit
pnpm --filter @marionette/import-spine test        # vitest
```

Tests use hand-authored Spine JSON fixtures written from the published documentation
(`test/fixtures/`), never downloaded or exported Spine files.

## Roadmap

Slice 1 (this package) is JSON import. Slice 2 adds the `.skel` binary reader per the published binary
format description, sharing the same conversion core so JSON and binary converge to identical documents
for equivalent content.
