// Public value barrel for the slot authoring format (format-contract section 15, phase-4 WP-4.4).
// Available at `@marionette/format/slot`. CD-1 relocates `SymbolId` and the authored slot-scene
// sub-schemas into `packages/format`; this barrel is their one import surface. In Phase 4 WP-4.1 it
// carries only `SymbolId` (the brand `math-bridge` needs); WP-4.4 grows it with the `SlotSceneDocument`
// envelope, the `SlotScene` aggregate, the sub-schemas, the validator, and the slot content hash.
export { symbolIdSchema, symbolId } from './symbol-id';
export type { SymbolId } from './symbol-id';
