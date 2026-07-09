import { describe, expect, it } from 'vitest';
import {
  EmptySequenceError,
  InvalidFpsError,
  InvalidFrameRangeError,
  InvalidViewportError,
  UnknownAnimationError,
  renderFrame,
  renderSequence,
  type RenderSequenceOptions,
} from '@marionette/render-preview';
import { makeAnimationState, setAnimation } from '@marionette/runtime-core';
import { bytesEqual, collectFramePngs, decode, pixelAt } from './helpers';
import {
  CLIP_FIT,
  CLIP_FPS,
  CLIP_SIZE,
  clipAtlas,
  clipSequenceOptions,
  spinDocument,
} from './media-scenarios';
import { meshAtlas, meshLimbDocument } from './scenarios';
import { sparkScenario } from './effect-scenarios';

describe('renderSequence range and metadata', () => {
  it('reports frame count, fps and duration from the range without solving', () => {
    const seq = renderSequence(clipSequenceOptions());

    expect(seq.frameCount).toBe(6);
    expect(seq.fps).toBe(CLIP_FPS);
    expect(seq.width).toBe(CLIP_SIZE);
    expect(seq.height).toBe(CLIP_SIZE);
    expect(seq.durationSeconds).toBeCloseTo(0.6, 10);
  });

  it('infers the range from the animation duration when `to` is omitted', () => {
    const options: RenderSequenceOptions = {
      document: spinDocument(),
      animation: 'spin',
      atlas: clipAtlas(),
      viewport: { width: CLIP_SIZE, height: CLIP_SIZE, fit: CLIP_FIT },
      fps: 10,
    };

    // 'spin' has duration 1s, so 10 fps yields 10 frames.
    expect(renderSequence(options).frameCount).toBe(10);
  });

  it('samples each frame at (from + index) / fps', () => {
    const seq = renderSequence({ ...clipSequenceOptions(), from: { frame: 1 } });

    const times = [...seq.frames()].map((frame) => frame.timeSeconds);

    expect(times).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('each frame with a fixed fit rect matches renderFrame at the same time', () => {
    const pngs = collectFramePngs(renderSequence(clipSequenceOptions()));

    for (let i = 0; i < pngs.length; i += 1) {
      const single = renderFrame({
        document: spinDocument(),
        animation: 'spin',
        time: i / CLIP_FPS,
        atlas: clipAtlas(),
        viewport: { width: CLIP_SIZE, height: CLIP_SIZE, fit: CLIP_FIT },
        background: { r: 0, g: 0, b: 0, a: 0 },
      });
      expect(bytesEqual(pngs[i]!, single.png)).toBe(true);
    }
  });
});

describe('renderSequence determinism and streaming', () => {
  it('renders byte-identical PNGs on repeated passes', () => {
    const seq = renderSequence(clipSequenceOptions());

    const passA = collectFramePngs(seq);
    const passB = collectFramePngs(seq);

    expect(passA.length).toBe(6);
    for (let i = 0; i < passA.length; i += 1) {
      expect(bytesEqual(passA[i]!, passB[i]!)).toBe(true);
    }
  });

  it('reuses one RGBA scratch buffer across frames (no per-frame accumulation)', () => {
    const seq = renderSequence(clipSequenceOptions());

    const buffers = new Set<Uint8Array>();
    let count = 0;
    for (const frame of seq.frames()) {
      buffers.add(frame.rgba);
      count += 1;
    }

    expect(count).toBe(6);
    // Every iteration yields the SAME underlying buffer: the clip never holds all frames at once.
    expect(buffers.size).toBe(1);
  });

  it('renders distinct frames as the bone rotates under the fixed camera', () => {
    const pngs = collectFramePngs(renderSequence(clipSequenceOptions()));

    const anyDifferent = pngs.some((png) => !bytesEqual(png, pngs[0]!));
    expect(anyDifferent).toBe(true);
  });

  it('exposes a callback form (forEach) that visits every frame in order', () => {
    const indices: number[] = [];
    renderSequence(clipSequenceOptions()).forEach((frame) => indices.push(frame.index));

    expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('renderSequence AnimationState source', () => {
  const buildState = (): RenderSequenceOptions => ({
    document: meshLimbDocument(),
    animationState: (document) => {
      const state = makeAnimationState(document);
      setAnimation(state, 0, 'wave', false);
      return state;
    },
    atlas: meshAtlas(),
    viewport: { width: 64, height: 64, fit: 'content' },
    background: { r: 0, g: 0, b: 0, a: 0 },
    fps: 10,
    to: { frame: 6 },
  });

  it('renders a track-0 animation deterministically with visible content', () => {
    const passA = collectFramePngs(renderSequence(buildState()));
    const passB = collectFramePngs(renderSequence(buildState()));

    expect(passA.length).toBe(6);
    for (let i = 0; i < passA.length; i += 1) expect(bytesEqual(passA[i]!, passB[i]!)).toBe(true);

    const img = decode(passA[3]!);
    let opaque = 0;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) if (pixelAt(img, x, y).a > 0) opaque += 1;
    }
    expect(opaque).toBeGreaterThan(0);
  });

  it('requires an explicit `to` for an AnimationState clip', () => {
    expect(() =>
      renderSequence({
        document: meshLimbDocument(),
        animationState: (document) => {
          const state = makeAnimationState(document);
          setAnimation(state, 0, 'wave', false);
          return state;
        },
        atlas: meshAtlas(),
        viewport: { width: 64, height: 64, fit: 'content' },
        fps: 10,
      }),
    ).toThrowError(InvalidFrameRangeError);
  });
});

describe('renderSequence composed effect overlay', () => {
  const withEffect = (): RenderSequenceOptions => {
    const spark = sparkScenario();
    return {
      ...clipSequenceOptions(),
      effect: {
        effectsDocument: spark.effectsDocument,
        trigger: spark.trigger,
        atlas: spark.atlas,
      },
    };
  };

  it('composites the effect on top of the skeleton deterministically', () => {
    const composedA = collectFramePngs(renderSequence(withEffect()));
    const composedB = collectFramePngs(renderSequence(withEffect()));
    const skeletonOnly = collectFramePngs(renderSequence(clipSequenceOptions()));

    expect(composedA.length).toBe(6);
    for (let i = 0; i < composedA.length; i += 1) {
      expect(bytesEqual(composedA[i]!, composedB[i]!)).toBe(true);
    }
    // The overlay changes pixels: at least one frame differs from the skeleton-only render.
    const anyChanged = composedA.some((png, i) => !bytesEqual(png, skeletonOnly[i]!));
    expect(anyChanged).toBe(true);
  });
});

describe('renderSequence validation', () => {
  const base = (): RenderSequenceOptions => clipSequenceOptions();

  it('rejects a non-integer or out-of-range fps with INVALID_FPS', () => {
    expect(() => renderSequence({ ...base(), fps: 0 })).toThrowError(InvalidFpsError);
    expect(() => renderSequence({ ...base(), fps: 240 })).toThrowError(InvalidFpsError);
    expect(() => renderSequence({ ...base(), fps: 12.5 })).toThrowError(InvalidFpsError);
    try {
      renderSequence({ ...base(), fps: 0 });
    } catch (error) {
      expect((error as InvalidFpsError).code).toBe('INVALID_FPS');
    }
  });

  it('rejects a negative or non-integer frame bound with INVALID_FRAME_RANGE', () => {
    expect(() => renderSequence({ ...base(), from: { frame: -1 } })).toThrowError(
      InvalidFrameRangeError,
    );
    expect(() => renderSequence({ ...base(), to: { frame: 2.5 } })).toThrowError(
      InvalidFrameRangeError,
    );
  });

  it('rejects an empty range with EMPTY_SEQUENCE', () => {
    expect(() => renderSequence({ ...base(), from: { frame: 3 }, to: { frame: 3 } })).toThrowError(
      EmptySequenceError,
    );
    try {
      renderSequence({ ...base(), from: { frame: 4 }, to: { frame: 2 } });
    } catch (error) {
      expect((error as EmptySequenceError).code).toBe('EMPTY_SEQUENCE');
    }
  });

  it('rejects a bad viewport up front with INVALID_VIEWPORT', () => {
    expect(() =>
      renderSequence({ ...base(), viewport: { width: 0, height: CLIP_SIZE, fit: CLIP_FIT } }),
    ).toThrowError(InvalidViewportError);
  });

  it('rejects an unknown animation with UNKNOWN_ANIMATION', () => {
    expect(() => renderSequence({ ...base(), animation: 'nope' })).toThrowError(
      UnknownAnimationError,
    );
  });
});
