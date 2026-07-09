import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeApng, encodeGif, renderSequence } from '@marionette/render-preview';
import { bytesEqual } from './helpers';
import { clipSequenceOptions } from './media-scenarios';

// Byte-exact goldens for the rendered-media encoders, locked exactly like the still-frame PNG goldens.
// Regenerate with `pnpm -C packages/render-preview gen:golden` on the pinned Node when the clip or an
// encoder deliberately changes.
function goldenBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./goldens/${name}`, import.meta.url))));
}

describe('rendered-media byte goldens', () => {
  it('matches the committed animated GIF', () => {
    const gif = encodeGif(renderSequence(clipSequenceOptions()));

    expect(bytesEqual(gif, goldenBytes('clip.gif'))).toBe(true);
  });

  it('matches the committed APNG', () => {
    const apng = encodeApng(renderSequence(clipSequenceOptions()));

    expect(bytesEqual(apng, goldenBytes('clip.apng'))).toBe(true);
  });
});
