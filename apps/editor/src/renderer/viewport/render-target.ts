import type { PlaybackMode } from '../editor-state/playback-store';

// What the viewport renders this frame, decided PURELY from the ephemeral transport state (LAW 1: this
// reads no document and writes no History). The setup variant carries no playhead, so a frame parked in
// setup mode resolves identically as the idle clock ticks and never re-renders; the animated variant
// carries the sampled time, so the change detector re-renders whenever the playhead moves (scrub or
// playback).
export type RenderTarget =
  | { readonly kind: 'setup' }
  | { readonly kind: 'animated'; readonly animation: string; readonly time: number };

// The setup decision is playhead-independent, so every setup frame resolves to this SAME reference. That
// both states the invariant (two playheads => identical setup target) and keeps the dominant idle state
// (parked in setup mode) allocation-free: the ticker reuses the singleton and the change detector sees no
// change.
const SETUP_TARGET: RenderTarget = { kind: 'setup' };

// Render animated ONLY when in animation mode AND an active animation NAME resolves; otherwise setup.
// `animation` is the resolved animation NAME (the key the exported SkeletonDocument is keyed by, which is
// what runtime-web samples by), not the branded id. A null name (no active animation, or one that does
// not resolve in the current document) falls back to setup.
export function resolveRenderTarget(
  mode: PlaybackMode,
  animation: string | null,
  playhead: number,
): RenderTarget {
  if (mode !== 'animation' || animation === null) return SETUP_TARGET;
  return { kind: 'animated', animation, time: playhead };
}

// Value equality for the ticker's re-render gate. Setup targets are always equal (playhead-independent);
// animated targets match only when the animation name AND the sampled time agree, so a scrub or a playback
// advance forces a re-render while a held animation frame does not.
export function renderTargetsEqual(a: RenderTarget, b: RenderTarget): boolean {
  if (a.kind === 'setup') return b.kind === 'setup';
  return b.kind === 'animated' && a.animation === b.animation && a.time === b.time;
}
