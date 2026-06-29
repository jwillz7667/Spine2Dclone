// Type-only contract surface for the slot authoring format (zero runtime), mirroring
// `@marionette/format/types` and `@marionette/format/effects-types`. Available at
// `@marionette/format/slot-types`. CD-1: `SymbolId` and the authored slot-scene types live in `format`
// so `math-bridge` can import the type without pulling in any validator runtime. WP-4.4 extends this
// with `SlotScene`, `SlotSceneDocument`, `GridConfig`, etc.
export type { SymbolId } from './symbol-id';
