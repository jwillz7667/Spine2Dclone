// Public value barrel for the effects sibling format (phase-3-vfx-particles.md WP-3.0). Available at
// `@marionette/format/effects`. This is the one import surface for effects validators and hashing;
// deep imports into `effects/*` from outside are lint-rejected. Effects TYPES are at
// `@marionette/format/effects-types` (zero runtime), mirroring `@marionette/format/types`.

export { validateEffectsDocument, parseEffectsDocument } from './validate';
export type { ValidateEffectsOptions } from './validate';
export { validateProjectManifest, parseProjectManifest } from './validate/manifest';
export type { ResolvedMemberHashes } from './validate/manifest';
export {
  EffectsValidationError,
  EFFECTS_ERROR_CODES,
  EFFECTS_WARNING_CODES,
} from './validate/errors';
export type {
  EffectsError,
  EffectsErrorCode,
  EffectsWarning,
  EffectsWarningCode,
  EffectsValidationReport,
  ManifestValidationReport,
} from './validate/errors';
export { computeEffectsContentHash, verifyEffectsContentHash } from './hash/hash';
export { EFFECTS_FORMAT_VERSION, FORMAT_COMMON_VERSION } from '../version/constants';

// The type-only contract surface (zero runtime); also available directly at
// @marionette/format/effects-types.
export type * from './types';
