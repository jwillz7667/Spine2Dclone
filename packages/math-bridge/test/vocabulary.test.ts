import { describe, expect, it } from 'vitest';
import { symbolId } from '@marionette/format/slot';
import { makeSymbolVocabulary, vocabularyHas } from '../src/vocabulary';

// WP-4.1 TASK-4.1.5: the SymbolVocabulary is the math model's known id set (engine metadata), the list
// the symbol library (WP-4.6) validates a scene against (R4.10).
describe('SymbolVocabulary (WP-4.1)', () => {
  it('builds a set of branded ids and answers membership', () => {
    const vocab = makeSymbolVocabulary('gates-class', ['H1', 'H2', 'scatter', 'wild']);
    expect(vocab.modelId).toBe('gates-class');
    expect(vocab.ids.size).toBe(4);
    expect(vocabularyHas(vocab, symbolId('scatter'))).toBe(true);
    expect(vocabularyHas(vocab, symbolId('not-a-symbol'))).toBe(false);
  });
});
