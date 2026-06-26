// PURE factory for the BrowserWindow security posture. Extracted so the single most
// security-sensitive decision in Phase 0 is unit-testable without launching Electron (R0-2).
// The four hardening flags are asserted by a regression test that fails if any one flips.

import type { BrowserWindowConstructorOptions } from 'electron';

export interface WindowOptionsInput {
  /** Absolute path to the built preload script. */
  readonly preloadPath: string;
}

export function createWindowOptions(input: WindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}
