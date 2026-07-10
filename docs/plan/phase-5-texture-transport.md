# Phase 5 texture transport and PMA policy (WP-5.2)

This note records two load-bearing WP-5.2 decisions: the compressed-texture transport (TASK-5.2.0,
DECISION-5.2.b) and the honest availability call on a production UASTC/KTX2 encoder (DECISION-5.2.c). It
also states the FIXED premultiplied-alpha (PMA) policy (TASK-5.2.5) that the atlas pipeline and every
runtime share. It is a plan note, not a contract: the format package (`AtlasRef`/`AtlasPage`/`AtlasRegion`)
is unchanged (Law 3); everything here rides in the Export Profile (its own `exportProfileVersion`) and the
non-contract `atlas-targets.json` manifest.

## 1. Transport (TASK-5.2.0, DECISION-5.2.b): single UASTC KTX2, per-target sidecars as fallback

The default `atlasExport.textureTransport` is `uastc-ktx2`: ONE Basis Universal UASTC KTX2 file per page,
transcoded AT LOAD to the device GPU format (ASTC, BC7, or ETC2) or decoded to RGBA for the PNG-equivalent
fallback. This produces one compressed artifact per page (not three) and sidesteps most of the multi-encoder
determinism problem, since the committed artifact is a single transcodable container. The documented
FALLBACK is `per-target-sidecar`: pre-baked `<page>@astc.ktx2` + `<page>@bc7.ktx2` (+ `@etc2`) sidecars,
used only where transcode-at-load is unavailable. The canonical PNG always remains `AtlasPage.file` under
either transport.

Capability check (published-behavior level, the headless-CI portion of TASK-5.2.0):

- PixiJS v8 ships a KTX2 loader with a Basis Universal transcoder (the same transcoder three.js `KTX2Loader`
  uses) that transcodes UASTC to native ASTC/BC7/ETC2 as well as ETC1S, so the web reference consumer can
  honor `uastc-ktx2`. The variant SELECTION algorithm is landed and unit-tested
  (`packages/runtime-web/src/atlas/variant-select.ts`); the transcode itself is the GL edge.
- Unity: the pinned KTX for Unity (`com.unity.cloud.ktx` / KTX-Software `libktx`) loads KTX2 UASTC and
  transcodes per-platform `TextureFormat` at import/load. Threaded in WP-5.3 (TASK-5.3.7).
- Godot: `Image`/`CompressedTexture2D` KTX2 support loads the container; the variant loader is WP-5.4
  (TASK-5.4.6).

The final on-device confirmation (the ASTC variant actually bound on an iPhone/Android, PNG on a forced-off
run) is the WP-5.6 device layer (TASK-5.6.6), not this note. Nothing here reads frame rate or wall-clock;
selection is a pure function of the static GPU capability set (Law 1 untouched: textures are not solve
inputs).

## 2. Encoder availability (DECISION-5.2.c): defer the encoder, ship the plumbing

TASK-5.2.6 needs a real UASTC/KTX2 ENCODER to emit the compressed artifact. The honest survey:

| Candidate | Kind | Verdict |
|---|---|---|
| Basis Universal reference (`basisu`), `toktx`, `astcenc` | native C++ CLI | Forbidden: no native binaries in this pipeline (ADR-0007 determinism + supply-chain posture). |
| `basis_universal` wasm ENCODER (BinomialLLC `webgl/encoder` build) | wasm | Exists but is NOT published as a maintained, version-pinnable, license-audited npm package; shipping an unpinned wasm blob is not production-fit. |
| `ktx-parse` (Don McCurdy) | pure JS | KTX2 container read/write ONLY; it does no UASTC/ASTC/BC7 block compression, so it is not an encoder. |
| Basis Universal wasm TRANSCODER (via PixiJS/three.js) | wasm | Load-time transcoder, the CONSUMER side (section 1). Not an encoder; cannot produce the committed artifact. |

Conclusion: there is currently no maintained, version-pinnable, license-clean, production-fit pure-JS/wasm
UASTC KTX2 encoder to add as a dependency. Per the WP-5.2 directive we do NOT ship a toy encoder. Instead:

- The export-profile plumbing is complete: `textureTransport` and `compressionTargets` select the transport
  and targets; the atlas pipeline emits the variant pages and writes the `atlas-targets.json` manifest with
  the intended compressed file names (`<page>.ktx2` under `uastc-ktx2`, `<page>.<target>.ktx2` under
  `per-target-sidecar`), each page's source PNG sha256, and the encoder fingerprint slot.
- The encoder is an injectable interface (`packages/atlas-pack/src/encoder.ts`, `TextureEncoder`). The
  default `unsupportedTextureEncoder` returns a typed `ATLAS_COMPRESSION_UNSUPPORTED` diagnostic per
  requested target (never a throw), so the canonical PNG + variant pipeline always succeeds and the manifest
  is honest about what was NOT produced. The manifest records the diagnostics under each page.

### Criteria to wire a real encoder (revisit)

Integrate a UASTC/KTX2 encoder behind the profile flag, with golden-hash tests, when ALL hold:

1. A maintained wasm encoder is published to npm with an exact pinnable version and a permissive,
   audited license (Basis Universal is Apache-2.0; a clean wasm build of it qualifies).
2. It runs headlessly (Node, no GL context) so it is CI-exercisable, and single-threaded with fixed
   settings so the compressed artifact is byte-reproducible (WP-5.2 R4 primary rule), or at minimum
   content-hash-equivalent under the fallback rule.
3. The KTX2 container is written with non-deterministic fields (writer string, timestamps) stripped or
   normalized, and the encoder fingerprint is `<encoder>@<version>+<settings-hash>`.

At that point the drop-in is a single `TextureEncoder` implementation passed to `runAtlasExport`; no
pipeline or manifest reshape is needed, and the `ATLAS_COMPRESSION_UNSUPPORTED` diagnostics disappear from
the manifest as the `compressed` entries populate.

## 3. FIXED premultiplied-alpha policy (TASK-5.2.5)

Atlas pages are emitted PREMULTIPLIED by default (`atlasExport.premultipliedAlpha`, default true). The
policy is FIXED and recorded in `atlas-targets.json` (`premultipliedAlpha`) so every runtime picks the same
blend equations and additive/screen blends (particles) match across web, Unity, and Godot. The premultiply
transform is pure and pinned: `out_c = round(c * a / 255)` (round-half-up), alpha unchanged; downscale
variants are box-filtered in premultiplied space (premultiply THEN downsample) to avoid dark fringes. The
per-8-bit round-trip is lossy at low alpha (unavoidable), which is why the decode checks in TASK-5.2.6 /
5.2.8 use a PMA-aware texture epsilon rather than exact equality.

The blend factor table each runtime honors is documented in the runtime READMEs
(`packages/runtime-web/README.md`, `runtimes/unity/README.md`, `runtimes/godot/README.md`) next to their
blend-mode setup.
