import { describe, expect, it } from 'vitest';
import {
  MalformedAtlasPageError,
  RenderPreviewError,
  renderFrame,
  RotatedRegionUnsupportedError,
  UnknownAnimationError,
} from '@marionette/render-preview';
import { regionDocument, tintedRegionScenario } from './scenarios';

describe('typed render errors', () => {
  it('throws UnknownAnimationError with code for an undefined animation', () => {
    try {
      renderFrame({ ...tintedRegionScenario(), animation: 'nope' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownAnimationError);
      expect((error as RenderPreviewError).code).toBe('UNKNOWN_ANIMATION');
    }
  });

  it('throws MalformedAtlasPageError when page pixels have the wrong length', () => {
    expect(() =>
      renderFrame({
        ...tintedRegionScenario(),
        atlas: {
          pages: new Map([['page.png', { width: 8, height: 8, rgba: new Uint8Array(10) }]]),
        },
      }),
    ).toThrow(MalformedAtlasPageError);
  });

  it('throws RotatedRegionUnsupportedError for a rotated atlas region', () => {
    const base = regionDocument({
      boneRotation: 0,
      regionWidth: 20,
      regionHeight: 20,
      regionColor: { r: 1, g: 1, b: 1, a: 1 },
      slotColor: { r: 1, g: 1, b: 1, a: 1 },
      blendMode: 'normal',
    });
    const rotated = JSON.parse(JSON.stringify(base));
    rotated.atlas.pages[0].regions[0].rotated = true;

    expect(() =>
      renderFrame({
        document: rotated,
        atlas: {
          pages: new Map([['page.png', { width: 8, height: 8, rgba: new Uint8Array(8 * 8 * 4) }]]),
        },
        viewport: { width: 32, height: 32, fit: 'content' },
      }),
    ).toThrow(RotatedRegionUnsupportedError);
  });
});
