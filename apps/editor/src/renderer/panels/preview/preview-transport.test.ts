import { describe, expect, it } from 'vitest';
import {
  advancePreview,
  cyclePreviewBackground,
  makePreviewTransport,
  pausePreview,
  playPreview,
  PREVIEW_BACKGROUNDS,
  restartPreview,
  seekPreview,
  setPreviewBackground,
  togglePreviewPlay,
} from './preview-transport';

describe('preview transport', () => {
  it('starts playing at time zero on the dark backdrop', () => {
    const transport = makePreviewTransport();

    expect(transport).toEqual({ isPlaying: true, elapsedMs: 0, background: 'dark' });
  });

  it('applies overrides without a second constructor', () => {
    const transport = makePreviewTransport({ isPlaying: false, background: 'checker' });

    expect(transport).toEqual({ isPlaying: false, elapsedMs: 0, background: 'checker' });
  });

  it('advances the clock only while playing and only for a positive delta', () => {
    const playing = makePreviewTransport();

    expect(advancePreview(playing, 16).elapsedMs).toBe(16);
    expect(advancePreview(advancePreview(playing, 16), 16).elapsedMs).toBe(32);
    expect(advancePreview(playing, 0)).toBe(playing);
    expect(advancePreview(playing, -5)).toBe(playing);
    expect(advancePreview(pausePreview(playing), 16).elapsedMs).toBe(0);
  });

  it('toggles play and is idempotent on play/pause', () => {
    const transport = makePreviewTransport();

    expect(togglePreviewPlay(transport).isPlaying).toBe(false);
    expect(pausePreview(transport).isPlaying).toBe(false);
    expect(playPreview(transport)).toBe(transport);
    expect(pausePreview(pausePreview(transport)).isPlaying).toBe(false);
  });

  it('restart rewinds to zero and resumes playing', () => {
    const paused = pausePreview(advancePreview(makePreviewTransport(), 500));

    const restarted = restartPreview(paused);

    expect(restarted.elapsedMs).toBe(0);
    expect(restarted.isPlaying).toBe(true);
  });

  it('seek clamps at zero and leaves play state untouched', () => {
    const paused = pausePreview(makePreviewTransport());

    expect(seekPreview(paused, 250).elapsedMs).toBe(250);
    expect(seekPreview(paused, -10).elapsedMs).toBe(0);
    expect(seekPreview(paused, 250).isPlaying).toBe(false);
  });

  it('cycles the backdrop dark -> light -> checker -> dark', () => {
    let transport = makePreviewTransport();

    transport = cyclePreviewBackground(transport);
    expect(transport.background).toBe('light');
    transport = cyclePreviewBackground(transport);
    expect(transport.background).toBe('checker');
    transport = cyclePreviewBackground(transport);
    expect(transport.background).toBe('dark');
  });

  it('cycle visits every declared backdrop exactly once per lap', () => {
    let transport = makePreviewTransport();
    const seen = new Set<string>();

    for (let i = 0; i < PREVIEW_BACKGROUNDS.length; i += 1) {
      seen.add(transport.background);
      transport = cyclePreviewBackground(transport);
    }

    expect(seen).toEqual(new Set(PREVIEW_BACKGROUNDS));
  });

  it('setPreviewBackground returns the same reference when unchanged', () => {
    const transport = makePreviewTransport();

    expect(setPreviewBackground(transport, 'dark')).toBe(transport);
    expect(setPreviewBackground(transport, 'checker').background).toBe('checker');
  });
});
