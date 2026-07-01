import type { MarionetteApi } from '../shared';

// window.marionette is the sandboxed preload bridge (env.d.ts types it as always-present). At RUNTIME it
// is only defined if the preload actually loaded; if the preload failed, it is undefined and calling
// through it throws an opaque `TypeError: Cannot read properties of undefined`. bridge() makes that
// failure explicit and actionable so callers surface a real message (and the main process also logs a
// preload-error), instead of Save/Open/Import silently doing nothing.
export function bridge(): MarionetteApi {
  // The global is typed non-optional, so read it through a widening view to check presence at runtime.
  const api = (window as Window & { marionette?: MarionetteApi }).marionette;
  if (api === undefined) {
    throw new Error(
      'The desktop bridge is unavailable: the preload script did not load. Restart Armature 2D; ' +
        'if this persists, rebuild the editor (pnpm --filter editor build).',
    );
  }
  return api;
}
