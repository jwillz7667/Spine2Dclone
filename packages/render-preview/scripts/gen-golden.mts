import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderComposedFrame, renderEffectFrame, renderFrame } from '@marionette/render-preview';
import { goldenScenarios } from '../test/scenarios';
import { composedGoldenScenarios, effectGoldenScenarios } from '../test/effect-scenarios';

// Regenerate the committed golden PNGs from the current renderer. Run via `pnpm -C packages/render-preview
// gen:golden` after an INTENTIONAL, reviewed rendering change (a preview-shading change is a deliberate
// act, like a conformance-fixture regeneration). The golden byte-equality tests compare against these.
const goldensDir = fileURLToPath(new URL('../test/goldens/', import.meta.url));
mkdirSync(goldensDir, { recursive: true });

function write(name: string, png: Uint8Array): void {
  const file = fileURLToPath(new URL(`../test/goldens/${name}.png`, import.meta.url));
  writeFileSync(file, png);
  console.log(`wrote ${name}.png (${png.byteLength} bytes)`);
}

for (const { name, options } of goldenScenarios()) {
  write(name, renderFrame(options).png);
}

for (const { name, options } of effectGoldenScenarios()) {
  write(name, renderEffectFrame(options).png);
}

for (const { name, options } of composedGoldenScenarios()) {
  write(name, renderComposedFrame(options).png);
}
