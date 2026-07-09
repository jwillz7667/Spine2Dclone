import type { Sequence } from '@marionette/format/types';

// Sequence-attachment region naming (ADR-0009 section 3). A region or mesh attachment with a `sequence`
// block plays a numbered run of atlas regions over time. runtime-core (sampleSlotSequenceFrame) resolves the
// discrete FRAME INDEX `i` in [0, count); turning that index into an atlas region NAME is a RENDERER concern
// (the format carries only the numbers, ADR-0009 section 3). The rule, quoted verbatim: "the region NAME of
// frame `i` is the attachment `path` with the zero-padded integer `start + i` appended to `digits` places".
//
// So the region name is `path` concatenated (no separator) with (start + i) rendered in base 10 and LEFT-
// padded with '0' to at least `digits` characters. A number already wider than `digits` is not truncated
// (String.padStart only pads). This is the single definition both renderers use (its twin lives in
// runtime-web scene/sequence-region.ts, character-for-character identical) so the preview and the shipped
// renderer select the same frame region.
export function sequenceRegionName(path: string, sequence: Sequence, frameIndex: number): string {
  const value = sequence.start + frameIndex;
  return path + String(value).padStart(sequence.digits, '0');
}
