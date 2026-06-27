import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Plugin } from 'vite';
import { cspForMode, type BuildMode } from './src/main/csp';

const dir = fileURLToPath(new URL('.', import.meta.url));

// Inject the mode-correct CSP meta into index.html. Single-sourced from the same cspForMode used by
// the authoritative onHeadersReceived header, so dev (HMR websocket allowed) and prod (strict) never
// diverge, and the meta covers the prod file:// load where the header may not fire.
function cspPlugin(mode: BuildMode): Plugin {
  return {
    name: 'marionette-inject-csp',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${cspForMode(mode)}" />`;
      return html.replace('<!--%CSP%-->', meta);
    },
  };
}

export default defineConfig(({ command }) => {
  const mode: BuildMode = command === 'serve' ? 'dev' : 'prod';
  return {
    main: {
      // Externalize real npm deps, but BUNDLE the workspace @marionette/* packages. They are consumed as
      // TypeScript source (their package exports point at ./src/index.ts so Vite/Vitest compile them on the
      // fly); the Electron main process runs under Node, which cannot load a .ts file, so an externalized
      // import would throw ERR_UNKNOWN_FILE_EXTENSION at startup. Bundling lets Vite compile them in. Only
      // packages the main process actually imports are listed; runtime-web (PixiJS) is renderer-only and
      // must never be pulled into main. Add a workspace package here when the main process starts importing
      // it. The transitive @noble/hashes is not a listed editor dependency, so it bundles automatically; zod
      // is a direct editor dependency and stays external (Node resolves it).
      plugins: [externalizeDepsPlugin({ exclude: ['@marionette/format'] })],
      build: {
        rollupOptions: {
          input: { main: resolve(dir, 'src/main/main.ts') },
          output: { entryFileNames: '[name].js' },
        },
      },
    },
    preload: {
      // No externalizeDepsPlugin: Zod must be bundled into the sandboxed preload (it cannot require
      // external modules at runtime). Electron itself stays external (electron-vite handles that).
      build: {
        rollupOptions: {
          input: { preload: resolve(dir, 'src/preload/preload.ts') },
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },
    renderer: {
      root: dir,
      build: {
        rollupOptions: {
          input: { index: resolve(dir, 'index.html') },
        },
      },
      plugins: [react(), cspPlugin(mode)],
    },
  };
});
