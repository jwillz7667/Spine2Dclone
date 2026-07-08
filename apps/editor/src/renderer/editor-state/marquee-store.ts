import { create } from 'zustand';

// The in-flight marquee rectangle in WORLD coordinates (PP-D1), or null when no marquee is active.
// Ephemeral editor state (the document/editor wall, LAW 1): it drives the viewport overlay only and is
// never serialized. World coordinates (not screen) so the rectangle lives naturally in the world-
// transformed overlay layer and its bone-origin hit test is a plain world-space comparison. Stored as the
// two drag corners; the consumer derives min/max so a right-to-left or upward drag needs no pre-sort.
export interface MarqueeRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

interface MarqueeStore {
  readonly rect: MarqueeRect | null;
  setRect(rect: MarqueeRect): void;
  clear(): void;
}

export const useMarqueeStore = create<MarqueeStore>((set) => ({
  rect: null,
  setRect: (rect) => set({ rect }),
  clear: () => set({ rect: null }),
}));
