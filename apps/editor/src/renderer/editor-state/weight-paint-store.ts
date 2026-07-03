import { create } from 'zustand';
import type { PaintMode } from '../document';

// Ephemeral weight-brush state (WP-2.4): the radius, strength, and mode of the weight-paint brush plus the
// current hover position that draws the brush cursor. NEVER undoable, NEVER serialized, and never read by a
// command (the document/editor wall, LAW 1): a stroke's actual weight change is a PaintWeightStrokeCommand,
// but the brush shape that decides WHICH vertices it touches is chrome. `mode` is the document-core PaintMode
// so it feeds both the pure brush (brushDab) and the command (beginWeightStroke) without a second type.
// `hoverWorld` is a world-space point (the overlay draws in the camera-transformed world container); it is
// set on pointer-down and pointer-move so the brush circle tracks the cursor during a gesture.
interface WeightPaintStore {
  readonly radiusPx: number;
  readonly strength: number; // 0..1, the maximum weight delta at the brush center
  readonly mode: PaintMode;
  readonly hoverWorld: readonly [number, number] | null;
  setRadiusPx(radiusPx: number): void;
  setStrength(strength: number): void;
  setMode(mode: PaintMode): void;
  setHoverWorld(hoverWorld: readonly [number, number] | null): void;
}

export const useWeightPaintStore = create<WeightPaintStore>((set) => ({
  radiusPx: 40,
  strength: 0.5,
  mode: 'add',
  hoverWorld: null,
  setRadiusPx: (radiusPx) => set({ radiusPx }),
  setStrength: (strength) => set({ strength }),
  setMode: (mode) => set({ mode }),
  setHoverWorld: (hoverWorld) => set({ hoverWorld }),
}));
