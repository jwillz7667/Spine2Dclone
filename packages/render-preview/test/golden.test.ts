import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderFrame } from '@marionette/render-preview';
import { goldenScenarios, meshScenario, tintedRegionScenario } from './scenarios';
import { bytesEqual } from './helpers';

function goldenBytes(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./goldens/${name}.png`, import.meta.url))),
  );
}

describe('golden PNG byte-equality', () => {
  for (const { name, options } of goldenScenarios()) {
    it(`matches the committed golden for ${name}`, () => {
      const { png } = renderFrame(options);

      expect(bytesEqual(png, goldenBytes(name))).toBe(true);
    });
  }
});

describe('determinism', () => {
  it('renders a static region byte-identically on repeated calls', () => {
    const options = tintedRegionScenario();

    const first = renderFrame(options).png;
    const second = renderFrame(options).png;

    expect(bytesEqual(first, second)).toBe(true);
  });

  it('renders an animated mesh frame byte-identically on repeated calls', () => {
    const options = meshScenario();

    const first = renderFrame(options).png;
    const second = renderFrame(options).png;

    expect(bytesEqual(first, second)).toBe(true);
  });
});
