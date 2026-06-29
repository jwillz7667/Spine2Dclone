// The format version gate constants (format-contract section 8.5, 10). `formatVersion` is the
// semver of THE FORMAT (LAW 3), independent of the app version. Phase 0 ships 0.1.0; a schema or
// semantic change bumps this with a tested migration (pre-1.0 breaking changes bump MINOR,
// format-contract section 10.3). WP-0.8 (save/load) reads these exact identifiers.
export const CURRENT_FORMAT_VERSION = '0.2.0';

// The MAJOR component of CURRENT_FORMAT_VERSION. Exported for tooling that wants the accepted
// MAJOR; the gate itself keys on the MIGRATION KEY (MINOR while MAJOR is 0), not on MAJOR alone.
export const SUPPORTED_FORMAT_MAJOR = 0;

// The semver of the sibling EFFECTS format (phase-3-vfx-particles.md section 5.3, 8.1). The
// `EffectsDocument` version line moves INDEPENDENTLY of `CURRENT_FORMAT_VERSION` for everything
// except the shared `common` primitives (see FORMAT_COMMON_VERSION). Introduced at 1.0.0 in Phase 3.
export const EFFECTS_FORMAT_VERSION = '1.0.0';

// The semver of the frozen shared primitive sub-contract (`packages/format/src/common`:
// `BlendMode`, `AtlasRef`, `CurveType`). A breaking change to any of these DUAL-bumps both
// `CURRENT_FORMAT_VERSION` and `EFFECTS_FORMAT_VERSION` in the same PR (section 8.1). This is the one
// bounded coupling between the two otherwise-independent document version lines.
export const FORMAT_COMMON_VERSION = '1.0.0';
