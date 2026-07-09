import type { Sequence } from '@marionette/format/types';

// Sequence-attachment region naming (ADR-0009 section 3). The twin of render-preview's sequence-region.ts,
// character-for-character identical so the preview and the shipped renderer select the same frame region.
// runtime-core (sampleSlotSequenceFrame) resolves the discrete FRAME INDEX `i` in [0, count); this turns it
// into the atlas region NAME: the attachment `path` with the zero-padded integer `start + i` appended to
// `digits` places (no separator; a number already wider than `digits` is not truncated). The renderer then
// binds that region's texture through its resolver.
export function sequenceRegionName(path: string, sequence: Sequence, frameIndex: number): string {
  const value = sequence.start + frameIndex;
  return path + String(value).padStart(sequence.digits, '0');
}
