// The format version gate constants (format-contract section 8.5, 10). `formatVersion` is the
// semver of THE FORMAT (LAW 3), independent of the app version. Phase 0 ships 0.1.0; a schema or
// semantic change bumps this with a tested migration (pre-1.0 breaking changes bump MINOR,
// format-contract section 10.3). WP-0.8 (save/load) reads these exact identifiers.
export const CURRENT_FORMAT_VERSION = '0.1.0';

// The MAJOR component of CURRENT_FORMAT_VERSION. Exported for tooling that wants the accepted
// MAJOR; the gate itself keys on the MIGRATION KEY (MINOR while MAJOR is 0), not on MAJOR alone.
export const SUPPORTED_FORMAT_MAJOR = 0;
