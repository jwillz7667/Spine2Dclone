import { create } from 'zustand';
import { centerWorldOn, panBy, zoomAt, type Camera } from '../viewport/camera';

// Ephemeral viewport camera state (handoff 8.2). This is EDITOR state, not document state: it is
// never written into the DocumentModel, never serialized into the format, and resetting it is not an
// undoable command. Mixing the camera into the document is the classic mistake called out in the
// handoff; the WP-0.1 boundary lint and this separate Zustand store keep them apart. Actions delegate
// to the pure camera math in ../viewport/camera so the transform logic stays unit-testable.
interface CameraStore extends Camera {
  panBy(deltaScreenX: number, deltaScreenY: number): void;
  zoomAt(anchorX: number, anchorY: number, factor: number): void;
  // Frame the world origin at a screen point (used once when the viewport first sizes).
  centerOrigin(screenX: number, screenY: number): void;
  reset(): void;
}

const INITIAL: Camera = { x: 0, y: 0, zoom: 1 };

export const useCameraStore = create<CameraStore>((set) => ({
  ...INITIAL,
  panBy: (deltaScreenX, deltaScreenY) => set((state) => panBy(state, deltaScreenX, deltaScreenY)),
  zoomAt: (anchorX, anchorY, factor) => set((state) => zoomAt(state, anchorX, anchorY, factor)),
  centerOrigin: (screenX, screenY) =>
    set((state) => centerWorldOn(0, 0, screenX, screenY, state.zoom)),
  reset: () => set({ ...INITIAL }),
}));
