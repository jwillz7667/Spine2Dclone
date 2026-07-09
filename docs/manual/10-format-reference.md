# Chapter 10: Format Reference

The portable data format is the product's one durable contract (Law 3). Everything the editor
authors is saved as validated JSON documents that any conforming runtime can play back. This
chapter documents each document type, the validation model, versioning, and the binary
container.

The format lives in `packages/format`, which imports nothing project-internal. There are three
independent document formats plus project manifests, each with its own version line:

| Format | Version constant | Current |
|---|---|---|
| Skeletal (`SkeletonDocument`) | `CURRENT_FORMAT_VERSION` | `0.3.0` |
| Effects (`EffectsDocument`) | `EFFECTS_FORMAT_VERSION` | `1.0.0` |
| Slot scene (`SlotSceneDocument`) | `SLOT_SCENE_FORMAT_VERSION` | `0.1.0` |
| Shared primitives (blend modes, atlas, curves) | `FORMAT_COMMON_VERSION` | `1.0.0` |

Version strings are strict `x.y.z` semver (no pre-release or build suffixes). Documents newer
than the app refuse to load (`UNSUPPORTED_FORMAT_VERSION`); documents older than the app are
migrated forward through a tested migration chain at load time.

## 10.1 SkeletonDocument

The root object of a saved skeleton. All schemas are strict: unknown keys are a validation
error, not a warning.

```jsonc
{
  "formatVersion": "0.3.0",
  "name": "my-character",
  "hash": "…64 lowercase hex, or empty for an unhashed draft…",
  "bones": [ … ],                 // at least one bone
  "slots": [ … ],
  "skins": [ … ],                 // must include a skin named "default"
  "ikConstraints": [ … ],         // required, may be empty
  "transformConstraints": [ … ],  // required, may be empty
  "events": [ … ],                // required, may be empty (event definitions)
  "animations": { "walk": { … } },
  "atlas": { "pages": [ … ] },
  "metadata": { … }               // optional (fps, imagesPath, audioPath)
}
```

### Bone

```jsonc
{
  "name": "thigh",
  "parent": "hip",          // null for a root bone
  "length": 120,            // non-negative
  "x": 0, "y": 0,
  "rotation": 0,            // degrees
  "scaleX": 1, "scaleY": 1, // may be negative (reflection)
  "shearX": 0, "shearY": 0, // degrees
  "transformMode": "normal"
}
```

`transformMode` controls how the bone inherits from its parent: `normal`, `onlyTranslation`,
`noRotationOrReflection`, `noScale`, `noScaleOrReflection`.

The bone ordering invariant: bones are stored parents-before-children. Every non-root bone
must appear at a strictly higher index than its parent, or validation fails with
`BONE_ORDER_VIOLATION`. Runtimes rely on this to compute world transforms in a single forward
pass.

### Slot

```jsonc
{
  "name": "front-leg",
  "bone": "thigh",
  "color": { "r": 1, "g": 1, "b": 1, "a": 1 },
  "darkColor": { "r": 0, "g": 0, "b": 0, "a": 1 },  // optional two-color tint
  "attachment": "leg-image",   // setup-pose attachment, or null for hidden
  "blendMode": "normal"        // normal | additive | multiply | screen
}
```

Slots are stored in draw order (index 0 renders first, so later slots draw on top). All color
channels are validated to `[0, 1]` (`COLOR_RANGE`).

### Attachments

Attachments live inside skins, keyed by slot name then attachment name. The `type` field is a
closed discriminated union:

**region**: a textured quad.
`path` (atlas region), `x`, `y`, `rotation`, `scaleX`, `scaleY`, `width`, `height`, `color`.

**mesh**: a deformable textured polygon.
`path`, `uvs` (flat `[u0,v0,…]`), `triangles` (index triples), `hullLength` (perimeter vertex
count), `width`, `height`, `color`, optional `edges` (editor wireframe), `vertices`, optional
`bones`.

Mesh vertex encoding is the presence-of-`bones` switch:
- Unweighted: `vertices` is a flat `[x0,y0,x1,y1,…]` of length `2 * vertexCount` in the slot
  bone's local space.
- Weighted: `vertices` is a packed stream, per vertex:
  `[influenceCount, (boneIndex, vx, vy, weight) * influenceCount, …]`, where `boneIndex` is a
  GLOBAL index into the document bone array and `(vx, vy)` is the position in that bone's local
  space. `bones` is the ascending, de-duplicated set of all referenced bone indices. Weights per
  vertex must sum to 1 within `1e-4`, and at most 4 influences per vertex are allowed.

**clipping**: `end` (slot name where clipping stops), `vertices` polygon, `color`.
**point**: `x`, `y`, `rotation`.
**boundingbox**: `vertices` polygon.

### Skin

```jsonc
{ "name": "default", "attachments": { "front-leg": { "leg-image": { …attachment… } } } }
```

The document must contain a skin named `default`. Named skins overlay it: at runtime an
attachment lookup checks the active named skin first, then falls back to default.

### Constraints

IK constraint: `name`, `bones` (1 or 2 bone names; a 2-bone chain must be parent then direct
child), `target` (bone name), `mix` in `[0, 1]`, `bendPositive`.

Transform constraint: `name`, `bones` (1 or more), `target`, six mix factors (`mixRotate`,
`mixX`, `mixY`, `mixScaleX`, `mixScaleY`, `mixShearY`, each `[0, 1]`) and six offsets
(`offsetRotation`, `offsetX`, `offsetY`, `offsetScaleX`, `offsetScaleY`, `offsetShearY`).

Constraint names must be unique across BOTH arrays. Solve order is fixed: all IK constraints
first, then all transform constraints, each in array order.

### Animation

```jsonc
{
  "duration": 2.0,
  "bones": {
    "thigh": {
      "rotate":    [ { "time": 0, "value": { "angle": 0 },  "curve": "linear" }, … ],
      "translate": [ { "time": 0, "value": { "x": 0, "y": 0 }, "curve": { "type": "bezier", "cx1": 0.25, "cy1": 0, "cx2": 0.75, "cy2": 1 } } ],
      "scale":     [ … ],   // value { x, y }
      "shear":     [ … ]    // value { x, y }
    }
  },
  "slots": {
    "front-leg": {
      "color":      [ { "time": 0, "value": { "color": { "r":1,"g":1,"b":1,"a":1 } }, "curve": "linear" } ],
      "attachment": [ { "time": 0.5, "name": "leg-bent" } ]   // stepped by nature, name may be null
    }
  },
  "ik":        { "leg-ik": [ { "time": 0, "value": { "mix": 1, "bendPositive": true }, "curve": "linear" } ] },
  "transform": { "follow": [ { "time": 0, "value": { "mixRotate": 0.5 }, "curve": "linear" } ] },
  "deform":    { "default": { "front-leg": { "leg-mesh": [ { "time": 0, "value": { "offsets": [dx0, dy0, …] }, "curve": "linear" } ] } } },
  "drawOrder": [ { "time": 0.5, "offsets": [ { "slot": "front-leg", "offset": 1 } ] } ],   // required, may be empty
  "events":    [ { "time": 0.5, "name": "footstep", "int": 3 } ]                            // required, may be empty
}
```

Rules the validator enforces:
- Keyframe times must be within `[0, duration]` and strictly ascending per timeline (except `events`, whose times are non-decreasing: coincident events are legal).
- `duration` must be at least the last keyframe time, and positive when any keyframes exist.
- Every timeline key must name a real bone, slot, or constraint; every `events` key must name a defined `EventDef` (`ANIM_EVENT_UNKNOWN`).
- Deform offsets must target a mesh attachment and have length `2 * vertexCount`.
- A `drawOrder` key's `offsets` describe a consistent reordering: each named slot exists, appears once, and its derived target index (setup index + offset) is unique and in range (`DRAWORDER_INCOMPLETE`).
- The `curve` on a timeline's last keyframe is ignored by the runtime (there is nothing after
  it to ease into).
- The IK `bendPositive` boolean channel is sampled stepped regardless of curve.

### Curves

Each keyframe carries its OUTGOING interpolation:
- `"linear"`
- `"stepped"` (hold until the next key)
- `{ "type": "bezier", "cx1", "cy1", "cx2", "cy2" }`: a cubic easing where the x control
  values must be in `[0, 1]` (they parameterize time) and the y control values are unbounded
  (overshoot is allowed).

### AtlasRef

```jsonc
{
  "pages": [
    {
      "file": "atlas-0.png", "width": 2048, "height": 2048,
      "regions": [
        { "name": "leg-image", "x": 0, "y": 0, "w": 128, "h": 256,
          "rotated": false, "offsetX": 2, "offsetY": 3, "originalW": 132, "originalH": 260 }
      ]
    }
  ]
}
```

Region names are unique across all pages; `offsetX/Y` and `originalW/H` restore whitespace that
was trimmed at pack time. Every attachment `path` must resolve to a region
(`ATTACHMENT_REGION_MISSING`).

## 10.2 Validation model

`validateDocument(input)` is pure and collects ALL errors rather than stopping at the first.
It runs four layers in order:

1. **Version gate**: parse `formatVersion`; newer than the app fails, older runs migrations.
2. **Structural**: strict schema parse. Every issue becomes a `FormatError` with a JSON Pointer
   `path` (for example `/bones/3/rotation`).
3. **Semantic**: cross-reference checks (bone ordering, name uniqueness, dangling references,
   mesh weight integrity, animation time ordering, and so on).
4. **Hash**: an empty `hash` is a `HASH_ABSENT` warning; a non-empty mismatch is a
   `HASH_MISMATCH` error. The hash is SHA-256 over the canonical (sorted-key) JSON of the
   document with the `hash` field removed.

A `FormatError` is `{ code, path, message, detail? }` with a stable code from a closed union.
The most common codes to know:

| Code | Meaning |
|---|---|
| `SCHEMA_SHAPE` | Wrong structure, wrong type, or unknown key |
| `UNSUPPORTED_FORMAT_VERSION` | Version is newer than the app or unparseable |
| `BONE_ORDER_VIOLATION` | A child bone precedes its parent |
| `SLOT_BONE_MISSING`, `SLOT_ATTACHMENT_MISSING` | Dangling slot references |
| `SKIN_DEFAULT_MISSING` | No skin named `default` |
| `ATTACHMENT_REGION_MISSING` | Attachment path not in the atlas |
| `MESH_WEIGHT_SUM`, `MESH_WEIGHT_INFLUENCE_CAP` | Weights do not sum to 1 / more than 4 influences |
| `IK_CHAIN_DISCONTINUOUS` | 2-bone IK chain is not parent then direct child |
| `ANIM_TIME_ORDER`, `ANIM_TIME_RANGE`, `ANIM_DURATION` | Keyframe timing violations |
| `DEFORM_NOT_MESH`, `DEFORM_OFFSET_LENGTH` | Deform keys on a non-mesh / wrong offset count |
| `CURVE_BEZIER_X_RANGE` | Bezier x control point outside `[0, 1]` |
| `HASH_MISMATCH` | Content does not match the recorded hash |

The full list (50+ codes) lives in `packages/format/src/validate/errors.ts`; there is a
negative test fixture per code, so every code is provably reachable.

## 10.3 Versioning and migration

`formatVersion` is the semver of the FORMAT, independent of the app version. While the major
is 0, the MINOR digit is the compatibility key. Migrations are forward-only steps
(`fromKey`, `toKey`, `migrate`), the full contiguous chain runs and only the final document is
re-validated structurally. Examples: the `0.1.x` to `0.2.0` migration injects empty
`ikConstraints`/`transformConstraints` arrays and empty `ik`/`transform`/`deform` timeline maps;
the `0.2.x` to `0.3.0` migration (ADR-0008) injects the empty document `events` collection and
the empty per-animation `drawOrder`/`events` timelines. Each recomputes the hash if one was
present (an unhashed draft stays a draft).

Policy (see `docs/plan/cross-cutting/format-contract.md` section 10): a schema or semantic
change bumps `formatVersion` with a tested migration; a validator refactor or error-message
change does not.

## 10.4 EffectsDocument (VFX)

An effects library is its own document with its own version line:

```jsonc
{
  "effectsFormatVersion": "1.0.0",
  "name": "my-vfx",
  "hash": "…",
  "atlas": { "pages": [ … ] },          // the VFX texture pack, same AtlasRef shape
  "effects": { "coin-shower": { … } },  // map key must equal the inner name
  "bundles": { "big-win": { … } }
}
```

An **EffectConfig** is `name`, `duration` (a positive number, or `null` for endless/looping),
`deterministic` (seeded playback: same seed, same frames), `simulationDt` (fixed simulation
step, default 1/60), `blendMode`, and `layers` (drawn in array order).

Layer kinds (discriminated on `type`):

- **emitter**: the particle workhorse. `maxParticles` (hard pool cap), `spawn` (one of
  `rate { particlesPerSecond }`, `burst { count, atTime }`, `bursts { bursts: [{atTime, count}] }`),
  `shape` (`point`, `line`, `circle { radius, edgeOnly }`, `rect { width, height }`), randomized
  ranges (`lifetime`, `startSpeed`, `emissionAngle`, `startRotation`, `angularVelocity`,
  `startScale`, each a `{ min, max }` with min less than or equal to max), `gravity` and
  `acceleration` vectors, `drag`, life curves (`scaleOverLife`, `colorOverLife`,
  `alphaOverLife`), `texture` (`static { region }` or
  `animated { regions, fps, mode: loop | overLife | once }`), and an optional per-particle
  `particleTrail`.
- **spriteAnimator**: a single animated sprite (`region`, `anchorSpace: world | screen`,
  `rotationDegPerSec`, life curves, `loop`, `layerDuration`).
- **ribbonTrail**: a ribbon that follows an anchor (`anchorRef`, `maxSegments`,
  `segmentSpacing`, `widthOverLength`, `colorOverLength`, `alphaOverLength`).

**Life curves** are gradient-style stop lists: at least two stops, first at `t = 0`, last at
`t = 1`, strictly ascending, each stop carrying a scalar or `{ r, g, b }` value and an easing
(the same curve type as skeletal keyframes).

**Bundles** compose effects into playlists: each item is
`{ effect, startOffset, anchorRole, seedSalt }`. Anchor roles are logical names ("reel-3-top",
"grid-center") resolved by the host at play time.

Effects have their own error namespace (`EFFECT_SCHEMA_SHAPE`, `EFFECT_RANGE_MIN_GT_MAX`,
`EFFECT_BURST_TIME_ORDER`, `EFFECT_LIFECURVE_STOP_ORDER`, `EFFECT_REGION_MISSING`,
`BUNDLE_EFFECT_MISSING`, and so on).

## 10.5 SlotSceneDocument (composition)

The slot composition layer is a third document kind:

```jsonc
{
  "slotSceneFormatVersion": "0.1.0",
  "name": "my-game",
  "hash": "…",
  "scene": {
    "grid": { … },            // topology, cols/rows, cell size, stagger, gravity, anticipation
    "symbols": { "WILD": { "skeletonRef": "wild", "idle": "idle", "land": "land", "win": "win" } },
    "winSequencer": { "sequences": { … }, "thresholds": { "big": 10, "mega": 25, "epic": 50 }, "defaultSequence": "…" },
    "featureFlows": { "states": { "base": {} }, "transitions": [ … ], "entry": "base" },
    "tumble": { "explodeMs": 0, "dropMs": 0, "dropEasing": "easeOutQuad", … }
  },
  "refs": { "skeletons": [ { "name": "wild", "hash": "…" } ], "vfxPresets": [ … ] }
}
```

Notable invariants:
- There is NO symbol-placement field anywhere. The board is driven at runtime by a
  `SpinResult` from the certified math engine; the scene document only maps symbols to
  presentation (Law 1).
- Grid topology rules are semantic: `reelStrip` allows 2 to 6 rows, `scatterPay` 5 to 7
  columns, `cluster` must be square.
- The flow graph's entry state must be `base` and must exist; transitions must not dangle.
- `refs` pins the exact skeleton and VFX documents by name AND content hash; a hash mismatch
  at load is an error (`refHashMismatch`), so a scene can never silently play against edited
  assets.
- Rollup and drop easings use a small named enum (`linear`, `easeInQuad`, `easeOutQuad`,
  `easeInOutCubic`), distinct from skeletal bezier curves.

## 10.6 Project manifests

A project manifest lists member documents with kind (`skeleton`, `effects`, `slotScene`) and a
required 64-hex content hash per member, so a multi-document project is integrity-checked as a
set.

## 10.7 MRNT binary container

MRNT is a compact, deterministic, lossless second serialization of the exact same logical
document (JSON stays the editing/save format; MRNT is the shipping format). Layout:

```
[ "MRNT" magic (4 bytes) ]
[ containerVersion (1 byte, currently 1) ]
[ flags (1 byte; bit 0 = lossless float64, others reserved) ]
[ formatVersion string ]
[ string table: all keys and string values, pooled ]
[ body: tagged value tree ]
[ CRC-32 over everything above (4 bytes, LE) ]
```

The body is a one-byte-tag tree (`null`, `false`, `true`, `float64`, `varint uint`,
`varint negative int`, `string-table index`, `array`, `object`). Object keys are visited
sorted, and the string table is built in first-encounter order, so encoding is byte-for-byte
deterministic: encoding the same document twice produces identical bytes, and
`encode(decode(bytes))` reproduces the input exactly. Numbers that are safe integers use
varints; everything else is IEEE-754 float64, so round-trips are exact rather than
epsilon-close.

Decoding checks, in order: length, magic, CRC (integrity before structure), container version,
flags, format version (major must be supported), string table, body, header/body version
agreement, and no trailing bytes. Failures throw a typed `BinaryDecodeError` with a stable code
(`badMagic`, `crcMismatch`, `truncated`, `unsupportedContainerVersion`,
`unsupportedFormatMajor`, `malformed`). A decoded document then passes through the SAME
`validateDocument` as JSON, so the binary path can never admit a document the JSON path would
reject.
