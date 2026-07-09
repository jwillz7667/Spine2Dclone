import { beforeEach, describe, expect, it } from 'vitest';
import type { KeyframeId } from '../document';
import { DEFAULT_VIEW } from '../dopesheet/timeline-math';
import {
  addAnimation,
  addBone,
  createEmptyDocument,
  setRotateKeys,
} from '../dopesheet/seed-document';
import { usePlaybackStore } from './playback-store';

const kid = (s: string): KeyframeId => s as KeyframeId;

function resetStore(): void {
  usePlaybackStore.setState({
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
  });
}

beforeEach(resetStore);

describe('playback store', () => {
  it('tick advances while playing and auto-stops at the tail when not looping', () => {
    const store = usePlaybackStore.getState();
    store.setLoop(false);
    store.play();

    usePlaybackStore.getState().tick(0.5, 1.2);
    expect(usePlaybackStore.getState().playhead).toBeCloseTo(0.5, 12);
    expect(usePlaybackStore.getState().isPlaying).toBe(true);

    usePlaybackStore.getState().tick(1.0, 1.2);
    expect(usePlaybackStore.getState().playhead).toBeCloseTo(1.2, 12);
    expect(usePlaybackStore.getState().isPlaying).toBe(false); // reached the end
  });

  it('tick folds through the loop map when looping', () => {
    const store = usePlaybackStore.getState();
    store.setLoop(true);
    store.setPlayhead(1.1);
    store.play();

    usePlaybackStore.getState().tick(0.25, 1.2);
    expect(usePlaybackStore.getState().playhead).toBeCloseTo(0.15, 12);
    expect(usePlaybackStore.getState().isPlaying).toBe(true);
  });

  it('does not advance while paused', () => {
    usePlaybackStore.getState().tick(0.5, 1.2);
    expect(usePlaybackStore.getState().playhead).toBe(0);
  });

  it('scales the clock delta by the playback speed and clamps the speed to [0.1, 2]', () => {
    const store = usePlaybackStore.getState();
    store.setLoop(false);
    store.play();

    store.setPlaybackSpeed(0.5);
    usePlaybackStore.getState().tick(0.4, 10);
    expect(usePlaybackStore.getState().playhead).toBeCloseTo(0.2, 12); // half speed

    usePlaybackStore.getState().setPlaybackSpeed(2);
    usePlaybackStore.getState().tick(0.4, 10);
    expect(usePlaybackStore.getState().playhead).toBeCloseTo(1.0, 12); // 0.2 + 0.4 * 2

    usePlaybackStore.getState().setPlaybackSpeed(99);
    expect(usePlaybackStore.getState().playbackSpeed).toBe(2); // clamped to the max

    usePlaybackStore.getState().setPlaybackSpeed(0);
    expect(usePlaybackStore.getState().playbackSpeed).toBe(0.1); // clamped to the min
  });

  it('manages the key selection by branded id', () => {
    const store = usePlaybackStore.getState();
    store.selectKeys([kid('a'), kid('b')]);
    expect(usePlaybackStore.getState().keySelection).toEqual([kid('a'), kid('b')]);

    store.addKeys([kid('b'), kid('c')]); // union, no duplicate
    expect(usePlaybackStore.getState().keySelection).toEqual([kid('a'), kid('b'), kid('c')]);

    store.toggleKey(kid('b')); // remove
    expect(usePlaybackStore.getState().keySelection).toEqual([kid('a'), kid('c')]);

    store.clearKeySelection();
    expect(usePlaybackStore.getState().keySelection).toEqual([]);
  });

  it('switching the active animation resets the playhead and clears foreign selection', () => {
    const store = usePlaybackStore.getState();
    store.setPlayhead(0.8);
    store.selectKeys([kid('a')]);

    usePlaybackStore.getState().setActiveAnimation(null);
    expect(usePlaybackStore.getState().playhead).toBe(0);
    expect(usePlaybackStore.getState().keySelection).toEqual([]);
  });

  it('scrubbing and playback never write the document history (the document/editor wall)', () => {
    const doc = createEmptyDocument();
    const bone = addBone(doc, 'root');
    const anim = addAnimation(doc, 'idle', 1.2);
    setRotateKeys(doc, anim, bone, [{ time: 0, value: { angle: 0 } }]);
    expect(doc.history.canUndo).toBe(true);

    let commits = 0;
    const unsubscribe = doc.history.subscribe(() => {
      commits += 1;
    });

    const store = usePlaybackStore.getState();
    store.play();
    for (let i = 0; i < 100; i += 1) {
      store.setPlayhead(i / 100);
      usePlaybackStore.getState().tick(0.016, 1.2);
    }
    store.pause();
    unsubscribe();

    expect(commits).toBe(0); // no transport action touched History
    expect(doc.history.canUndo).toBe(true);
  });
});
