import { describe, expect, it } from 'vitest';
import {
  MalformedAtlasPageError,
  RenderPreviewError,
  renderFrame,
  UnknownAnimationError,
} from '@marionette/render-preview';
import { tintedRegionScenario } from './scenarios';

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
});
