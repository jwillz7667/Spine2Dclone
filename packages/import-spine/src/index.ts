// Public barrel for @marionette/import-spine (PP-A5): the import-only, strictly clean-room Spine project
// importer. Consumers (the editor import flow, the MCP server) import ONLY from this barrel. The package
// PRODUCES a validated @marionette/format document and never writes or exports any Spine format.

export { importSpineJson } from './import-json';
export { importSpineSkel } from './import-skel';

export type {
  SpineImportResult,
  SpineImportOptions,
  SpineImportError,
  SpineImportErrorCode,
  SpineImportWarning,
  SpineImportWarningFeature,
  SpineDiagnosticDetail,
} from './types';
export {
  SPINE_IMPORT_ERROR_CODES,
  SPINE_IMPORT_WARNING_FEATURES,
  DEFAULT_SKELETON_NAME,
} from './types';
