import { describe, expect, it } from 'vitest';
import { exportProfileSchema } from '../../shared';
import {
  defaultExportProfile,
  defaultMediaDraft,
  isVideoFormat,
  resolveFrameRange,
  toggleCompressionTarget,
  toMediaExportOptions,
  validateExportProfile,
  validateMediaDraft,
  type AnimationChoice,
  type MediaDraft,
} from './export-options';

const animations: AnimationChoice[] = [
  { name: 'idle', duration: 2 },
  { name: 'run', duration: 0.5 },
];

function draft(overrides: Partial<MediaDraft> = {}): MediaDraft {
  return { ...defaultMediaDraft(animations), ...overrides };
}

describe('media draft defaults + range', () => {
  it('defaults to the first animation with a full range covering its duration', () => {
    const d = defaultMediaDraft(animations);

    expect(d.animation).toBe('idle');
    expect(d.useFullRange).toBe(true);
    const range = resolveFrameRange(d, animations);
    // 2s at 30fps => 60 frames.
    expect(range).toEqual({ startFrame: 0, endFrame: 60, frameCount: 60 });
  });

  it('resolves an explicit range when full range is off', () => {
    const range = resolveFrameRange(
      draft({ useFullRange: false, startFrame: 5, endFrame: 20 }),
      animations,
    );
    expect(range).toEqual({ startFrame: 5, endFrame: 20, frameCount: 15 });
  });

  it('classifies video vs raster formats', () => {
    expect(isVideoFormat('webm')).toBe(true);
    expect(isVideoFormat('mp4')).toBe(true);
    expect(isVideoFormat('gif')).toBe(false);
    expect(isVideoFormat('png-sequence')).toBe(false);
  });
});

describe('validateMediaDraft', () => {
  it('accepts a valid default draft', () => {
    expect(validateMediaDraft(defaultMediaDraft(animations), animations)).toEqual([]);
  });

  it('rejects an out-of-range fps', () => {
    expect(validateMediaDraft(draft({ fps: 0 }), animations).length).toBeGreaterThan(0);
    expect(validateMediaDraft(draft({ fps: 240 }), animations).length).toBeGreaterThan(0);
    expect(validateMediaDraft(draft({ fps: 24.5 }), animations).length).toBeGreaterThan(0);
  });

  it('rejects zero or oversized dimensions', () => {
    expect(validateMediaDraft(draft({ width: 0 }), animations).length).toBeGreaterThan(0);
    expect(validateMediaDraft(draft({ height: 5000 }), animations).length).toBeGreaterThan(0);
  });

  it('rejects a full-range setup-pose export (no duration to infer)', () => {
    const errors = validateMediaDraft(draft({ animation: null, useFullRange: true }), animations);
    expect(errors.some((e) => e.includes('setup pose'))).toBe(true);
  });

  it('accepts a setup-pose export with an explicit range', () => {
    const errors = validateMediaDraft(
      draft({ animation: null, useFullRange: false, startFrame: 0, endFrame: 10 }),
      animations,
    );
    expect(errors).toEqual([]);
  });

  it('rejects an empty frame range', () => {
    const errors = validateMediaDraft(
      draft({ useFullRange: false, startFrame: 10, endFrame: 10 }),
      animations,
    );
    expect(errors.some((e) => e.includes('at least one frame'))).toBe(true);
  });

  it('rejects an unknown animation name', () => {
    const errors = validateMediaDraft(draft({ animation: 'missing' }), animations);
    expect(errors.some((e) => e.includes('missing'))).toBe(true);
  });
});

describe('toMediaExportOptions', () => {
  it('projects a GIF draft with palette + loop + threshold', () => {
    const options = toMediaExportOptions(
      draft({ format: 'gif', loopForever: false, gifPalette: 'per-frame', alphaThreshold: 0.25 }),
      animations,
    );
    expect(options.medium).toBe('gif');
    expect(options.animation).toBe('idle');
    expect(options.from).toEqual({ frame: 0 });
    expect(options.to).toEqual({ frame: 60 });
    expect(options.gif).toEqual({ palette: 'per-frame', loopCount: 1, alphaThreshold: 0.25 });
    expect(options.apng).toBeUndefined();
  });

  it('projects an APNG draft with only the apng block, transparent background', () => {
    const options = toMediaExportOptions(
      draft({ format: 'apng', transparent: true, loopForever: true }),
      animations,
    );
    expect(options.medium).toBe('apng');
    expect(options.background).toBeNull();
    expect(options.apng).toEqual({ loopCount: 0 });
    expect(options.gif).toBeUndefined();
  });

  it('carries an opaque background when transparency is off', () => {
    const options = toMediaExportOptions(
      draft({ format: 'png-sequence', transparent: false, background: { r: 1, g: 0, b: 0, a: 1 } }),
      animations,
    );
    expect(options.background).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });
});

describe('export profile helpers', () => {
  it('produces a default profile that satisfies the authoritative schema', () => {
    expect(exportProfileSchema.safeParse(defaultExportProfile()).success).toBe(true);
  });

  it('validates a good profile and rejects a malformed one with path-qualified errors', () => {
    const good = validateExportProfile(defaultExportProfile());
    expect(good.ok).toBe(true);

    const bad = validateExportProfile({ ...defaultExportProfile(), exportProfileVersion: 'x' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((e) => e.startsWith('exportProfileVersion'))).toBe(true);
  });

  it('toggles a compression target off and on, keeping at least one', () => {
    const base = defaultExportProfile();

    const withoutBc7 = toggleCompressionTarget(base, 'bc7');
    expect(withoutBc7.atlasExport.compressionTargets).not.toContain('bc7');

    const readded = toggleCompressionTarget(withoutBc7, 'bc7');
    expect(readded.atlasExport.compressionTargets).toContain('bc7');

    // Removing every target is refused: the last one stays (schema nonempty invariant).
    let single = base;
    for (const target of ['bc7', 'etc2'] as const) single = toggleCompressionTarget(single, target);
    const stillOne = toggleCompressionTarget(single, 'astc6x6');
    expect(stillOne.atlasExport.compressionTargets).toEqual(['astc6x6']);
  });
});
