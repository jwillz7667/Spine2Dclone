import { describe, expect, it } from 'vitest';
import { createWindowOptions } from './window-options';

// Security guard (R0-2): a regression test that fails if any of the four hardening flags flips.
describe('createWindowOptions security posture', () => {
  const webPreferences = createWindowOptions({
    preloadPath: '/abs/path/preload.cjs',
  }).webPreferences;

  it('enables contextIsolation', () => {
    expect(webPreferences?.contextIsolation).toBe(true);
  });

  it('disables nodeIntegration', () => {
    expect(webPreferences?.nodeIntegration).toBe(false);
  });

  it('enables sandbox', () => {
    expect(webPreferences?.sandbox).toBe(true);
  });

  it('enables webSecurity', () => {
    expect(webPreferences?.webSecurity).toBe(true);
  });

  it('wires the provided preload path', () => {
    expect(webPreferences?.preload).toBe('/abs/path/preload.cjs');
  });
});
