import { create } from 'zustand';
import type { AnimationId, KeyframeId } from '../document';
import type { CopiedKeyframe } from '../dopesheet/clipboard';
import { DEFAULT_VIEW, type DopesheetView, type WorkingFps } from '../dopesheet/timeline-math';
import { advance, clampPlaybackSpeed } from '../dopesheet/transport';

export type PlaybackMode = 'setup' | 'animation';

// Ephemeral transport + dopesheet editor state (section 6, WP-1.6). NONE of this is in the DocumentModel
// and NONE of it is undoable (the document/editor wall): scrubbing, play/pause, selection, clipboard, and
// view pan/zoom never touch History. All keying is by branded id (AnimationId / KeyframeId), never by
// name or array index, so it survives renames, reorders, and keyframe insert/delete. `autoKey` is held
// here for WP-1.8; its delta-capture BEHAVIOR is NOT implemented in WP-1.6.
interface PlaybackStore {
  readonly mode: PlaybackMode;
  readonly activeAnimation: AnimationId | null;
  readonly playhead: number; // seconds
  readonly isPlaying: boolean;
  readonly loop: boolean;
  readonly workingFps: WorkingFps;
  readonly playbackSpeed: number; // clock multiplier in [0.1, 2]; 1 is real time (PP-D2)
  readonly autoKey: boolean;
  readonly keySelection: readonly KeyframeId[];
  readonly keyClipboard: readonly CopiedKeyframe[];
  readonly dopesheetView: DopesheetView;

  setMode(mode: PlaybackMode): void;
  // Switching animations resets the playhead and clears the (now-foreign) key selection. This is editor
  // state, never a document mutation (TASK-1.9.2 anticipated; here it just keeps the panel coherent).
  setActiveAnimation(id: AnimationId | null): void;
  setPlayhead(seconds: number): void;
  play(): void;
  pause(): void;
  setLoop(loop: boolean): void;
  setWorkingFps(fps: WorkingFps): void;
  // Set the playback-speed multiplier; the value is clamped to [0.1, 2] (clampPlaybackSpeed), so an
  // out-of-range or non-finite request can never install a stalled or reversed clock.
  setPlaybackSpeed(speed: number): void;
  setAutoKey(autoKey: boolean): void;

  selectKeys(ids: readonly KeyframeId[]): void;
  addKeys(ids: readonly KeyframeId[]): void;
  toggleKey(id: KeyframeId): void;
  clearKeySelection(): void;

  setClipboard(records: readonly CopiedKeyframe[]): void;
  setDopesheetView(view: DopesheetView): void;

  // Advance the playhead from a monotonic clock delta. Pure transport: it never writes the document and
  // never touches History (LAW 1, the document/editor wall). Auto-stops at the tail when not looping.
  tick(deltaSeconds: number, duration: number): void;
}

export const usePlaybackStore = create<PlaybackStore>((set) => ({
  mode: 'animation',
  activeAnimation: null,
  playhead: 0,
  isPlaying: false,
  loop: true,
  workingFps: 30,
  playbackSpeed: 1,
  autoKey: true,
  keySelection: [],
  keyClipboard: [],
  dopesheetView: DEFAULT_VIEW,

  setMode: (mode) => set({ mode }),
  setActiveAnimation: (activeAnimation) =>
    set({ activeAnimation, playhead: 0, isPlaying: false, keySelection: [] }),
  setPlayhead: (playhead) => set({ playhead }),
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  setLoop: (loop) => set({ loop }),
  setWorkingFps: (workingFps) => set({ workingFps }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: clampPlaybackSpeed(speed) }),
  setAutoKey: (autoKey) => set({ autoKey }),

  selectKeys: (ids) => set({ keySelection: [...ids] }),
  addKeys: (ids) =>
    set((state) => {
      const next = new Set(state.keySelection);
      for (const id of ids) next.add(id);
      return { keySelection: [...next] };
    }),
  toggleKey: (id) =>
    set((state) => {
      const next = new Set(state.keySelection);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { keySelection: [...next] };
    }),
  clearKeySelection: () => set({ keySelection: [] }),

  setClipboard: (records) => set({ keyClipboard: [...records] }),
  setDopesheetView: (dopesheetView) => set({ dopesheetView }),

  tick: (deltaSeconds, duration) =>
    set((state) => {
      if (!state.isPlaying) return state;
      // Scale the real-clock delta by the playback-speed multiplier (PP-D2). This is the single point
      // both transport clocks (the dopesheet rAF loop and the viewport ticker) route through, so speed
      // applies uniformly without either caller knowing about it.
      const result = advance(
        state.playhead,
        deltaSeconds * state.playbackSpeed,
        duration,
        state.loop,
      );
      return result.reachedEnd
        ? { playhead: result.playhead, isPlaying: false }
        : { playhead: result.playhead };
    }),
}));
