// The pure transport state machine shared by the effects and slot panel GL previews (PP-D8). It is the
// non-GL heart of both previews: play/pause/restart plus a background toggle, held as an immutable value
// and advanced by an explicit frame delta (no clock lives here, mirroring runtime-core's dt discipline).
// The GL view owns one of these, mutates it through these pure functions on a toolbar command or a frame
// tick, and reports it back to the React panel for button state. Keeping it pure means the whole transport
// contract is unit-tested in the node env with no PixiJS or DOM (the viewport pattern: logic in tested
// modules, GL in untested view files). The preview NEVER mutates the document (LAW 2): this state is
// ephemeral editor state, exactly like the viewport camera and playhead.

// The three preview backdrops the toggle cycles through. `checker` is the standard transparency checker so
// additive/alpha particles read against a neutral field; dark/light frame the content on a flat fill.
export const PREVIEW_BACKGROUNDS = ['dark', 'light', 'checker'] as const;
export type PreviewBackground = (typeof PREVIEW_BACKGROUNDS)[number];

export interface PreviewTransport {
  // Whether the preview clock is advancing. A paused preview holds its last rendered frame.
  readonly isPlaying: boolean;
  // Milliseconds elapsed since the last restart while playing. The effects preview steps its EffectSystem
  // by the frame delta directly; the slot preview uses this as the timeline clock (see slot-preview-model).
  readonly elapsedMs: number;
  readonly background: PreviewBackground;
}

// A fresh transport: playing, at time zero, on the dark backdrop. Overrides let a caller start paused or on
// a different backdrop without a second constructor.
export function makePreviewTransport(overrides?: Partial<PreviewTransport>): PreviewTransport {
  return { isPlaying: true, elapsedMs: 0, background: 'dark', ...overrides };
}

export function playPreview(transport: PreviewTransport): PreviewTransport {
  return transport.isPlaying ? transport : { ...transport, isPlaying: true };
}

export function pausePreview(transport: PreviewTransport): PreviewTransport {
  return transport.isPlaying ? { ...transport, isPlaying: false } : transport;
}

export function togglePreviewPlay(transport: PreviewTransport): PreviewTransport {
  return { ...transport, isPlaying: !transport.isPlaying };
}

// Restart: rewind to time zero and resume playing (the effects preview re-triggers its effect, the slot
// preview replays its timeline from the start). Restart always plays, so it doubles as a resume from paused.
export function restartPreview(transport: PreviewTransport): PreviewTransport {
  return { ...transport, isPlaying: true, elapsedMs: 0 };
}

// Advance the clock by a frame delta. A non-positive delta or a paused transport is a no-op (a stalled or
// backgrounded tick must not move time). Never advances while paused, so the last frame holds.
export function advancePreview(transport: PreviewTransport, deltaMs: number): PreviewTransport {
  if (!transport.isPlaying || deltaMs <= 0) return transport;
  return { ...transport, elapsedMs: transport.elapsedMs + deltaMs };
}

// Seek to an absolute time (clamped at zero). Used when a caller drives the clock externally; leaves
// isPlaying untouched.
export function seekPreview(transport: PreviewTransport, elapsedMs: number): PreviewTransport {
  const clamped = elapsedMs < 0 ? 0 : elapsedMs;
  return clamped === transport.elapsedMs ? transport : { ...transport, elapsedMs: clamped };
}

// Cycle the backdrop dark -> light -> checker -> dark. Wraps at the end of PREVIEW_BACKGROUNDS.
export function cyclePreviewBackground(transport: PreviewTransport): PreviewTransport {
  const index = PREVIEW_BACKGROUNDS.indexOf(transport.background);
  const next = PREVIEW_BACKGROUNDS[(index + 1) % PREVIEW_BACKGROUNDS.length]!;
  return { ...transport, background: next };
}

export function setPreviewBackground(
  transport: PreviewTransport,
  background: PreviewBackground,
): PreviewTransport {
  return background === transport.background ? transport : { ...transport, background };
}
