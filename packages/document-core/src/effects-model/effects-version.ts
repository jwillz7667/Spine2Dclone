// The supported effects-format version, re-exported from the format contract so the import/export seam and
// the empty-state constructor stamp the same value the validator gates on. document-core does not own this
// version (LAW 3: the format is the contract); it mirrors it from @marionette/format/effects.
export { EFFECTS_FORMAT_VERSION } from '@marionette/format/effects';
