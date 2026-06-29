import { symbolId } from '@marionette/format/slot';
import type { SymbolId } from '@marionette/format/slot';

// SymbolVocabulary (phase-4 WP-4.1 TASK-4.1.5, R4.10): the set of symbol ids a given math model emits.
// The `SymbolId` TYPE/brand lives in `format` (CD-1); the VALUES a model uses are ENGINE METADATA, so
// they are supplied here by `math-bridge`. The editor symbol library (WP-4.6) lists ids from a
// vocabulary and validation asserts every mapped symbol is in the vocabulary and every emitted id is
// mapped (so a scene cannot map a symbol the engine never produces, nor leave an emitted id unmapped).
export interface SymbolVocabulary {
  readonly modelId: string;
  readonly ids: ReadonlySet<SymbolId>;
}

// Build a vocabulary from a model id and its known symbol-id strings. The strings are branded here, the
// single sanctioned brand point for a model's metadata.
export function makeSymbolVocabulary(modelId: string, ids: readonly string[]): SymbolVocabulary {
  return { modelId, ids: new Set(ids.map(symbolId)) };
}

export function vocabularyHas(vocab: SymbolVocabulary, id: SymbolId): boolean {
  return vocab.ids.has(id);
}
