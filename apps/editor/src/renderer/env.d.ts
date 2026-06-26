/// <reference types="vite/client" />

// Types the window.marionette bridge surface for the renderer, sourced from editor-shared (the
// isomorphic contract), never from the preload module. Keeps the process split intact.
import type { MarionetteApi } from '../shared';

declare global {
  interface Window {
    readonly marionette: MarionetteApi;
  }
}

export {};
