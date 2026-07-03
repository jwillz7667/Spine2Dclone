import { describe, expect, it } from 'vitest';
import {
  CONTENT_PAD_FRACTION,
  InvalidViewportError,
  renderFrame,
  ZeroContentFitError,
} from '@marionette/render-preview';
import { regionDocument, tintedRegionScenario } from './scenarios';

// A valid document whose only slot shows no attachment (attachment null), so nothing draws: the fit:
// content framer then has no world geometry to bound. Built from the region document so it passes the
// format's referential validation (the default skin and bone still resolve).
function noVisibleContentDocument(): unknown {
  const doc = JSON.parse(
    JSON.stringify(
      regionDocument({
        boneRotation: 0,
        regionWidth: 20,
        regionHeight: 20,
        regionColor: { r: 1, g: 1, b: 1, a: 1 },
        slotColor: { r: 1, g: 1, b: 1, a: 1 },
        blendMode: 'normal',
      }),
    ),
  );
  doc.slots[0].attachment = null;
  return doc;
}

describe('viewport framing', () => {
  it('pins the fit:content padding fraction', () => {
    expect(CONTENT_PAD_FRACTION).toBe(0.05);
  });

  it('throws ZeroContentFitError when fit:content has nothing to frame', () => {
    expect(() =>
      renderFrame({
        document: noVisibleContentDocument(),
        atlas: { pages: new Map() },
        viewport: { width: 32, height: 32, fit: 'content' },
      }),
    ).toThrow(ZeroContentFitError);
  });

  it('throws InvalidViewportError for a non-positive viewport size', () => {
    expect(() =>
      renderFrame({
        ...tintedRegionScenario(),
        viewport: { width: 0, height: 64, fit: 'content' },
      }),
    ).toThrow(InvalidViewportError);
  });

  it('centers content and preserves aspect for a non-square viewport', () => {
    // A wide viewport over square content letterboxes horizontally; the frame renders without throwing
    // and reports the requested dimensions.
    const result = renderFrame({
      ...tintedRegionScenario(),
      viewport: { width: 128, height: 64, fit: 'content' },
    });

    expect(result.width).toBe(128);
    expect(result.height).toBe(64);
  });
});
