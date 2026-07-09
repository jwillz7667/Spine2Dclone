import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  encodeApng,
  encodeGif,
  renderComposedFrame,
  renderEffectFrame,
  renderFrame,
  renderSequence,
} from '@marionette/render-preview';
import { goldenScenarios } from '../test/scenarios';
import { composedGoldenScenarios, effectGoldenScenarios } from '../test/effect-scenarios';
import { clipSequenceOptions } from '../test/media-scenarios';

// Regenerate the committed goldens (still-frame PNGs, and the animated GIF/APNG clip) from the current
// renderer. Run via `pnpm -C packages/render-preview gen:golden` after an INTENTIONAL, reviewed rendering
// or encoder change (a deliberate act, like a conformance-fixture regeneration). Run on the pinned Node so
// the pngjs deflate bytes match CI. The golden byte-equality tests compare against these.
const goldensDir = fileURLToPath(new URL('../test/goldens/', import.meta.url));
mkdirSync(goldensDir, { recursive: true });

function writeBytes(name: string, bytes: Uint8Array): void {
  const file = fileURLToPath(new URL(`../test/goldens/${name}`, import.meta.url));
  writeFileSync(file, bytes);
  console.log(`wrote ${name} (${bytes.byteLength} bytes)`);
}

for (const { name, options } of goldenScenarios()) {
  writeBytes(`${name}.png`, renderFrame(options).png);
}

for (const { name, options } of effectGoldenScenarios()) {
  writeBytes(`${name}.png`, renderEffectFrame(options).png);
}

for (const { name, options } of composedGoldenScenarios()) {
  writeBytes(`${name}.png`, renderComposedFrame(options).png);
}

// Rendered-media goldens (PP-C10): the rotating-bar clip encoded as an animated GIF and APNG.
writeBytes('clip.gif', encodeGif(renderSequence(clipSequenceOptions())));
writeBytes('clip.apng', encodeApng(renderSequence(clipSequenceOptions())));
