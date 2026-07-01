// PURE Content-Security-Policy builder, split by build mode (R0-6). The dev relaxation (the Vite
// HMR websocket and dev server origins, plus unsafe-eval that the dev bundler needs) must NEVER
// reach prod. A unit test asserts the prod string carries no remote origin and no unsafe-eval.
// PixiJS v8 runs from bundled assets, so prod needs no CDN origin.

export type BuildMode = 'dev' | 'prod';

const BASE_DIRECTIVES = (mode: BuildMode): readonly string[] => {
  // DEV needs 'unsafe-inline' AND 'unsafe-eval': the Vite dev server + React Fast Refresh inject an
  // INLINE bootstrap/preamble script, and without 'unsafe-inline' the Electron window (which gets this
  // policy as an HTTP header) blocks it and renders BLANK, even though a plain browser hitting the dev
  // server still paints. Both relaxations are DEV-ONLY and never reach the prod policy (asserted by the
  // csp test): prod ships strict 'self'-only scripts from the bundled assets.
  const scriptSrc =
    mode === 'dev' ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'";
  const connectSrc =
    mode === 'dev'
      ? "connect-src 'self' ws://localhost:* http://localhost:*"
      : "connect-src 'self'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    connectSrc,
    // PixiJS v8 uploads textures on a background Worker it spins up from a blob: URL (the
    // WorkerManager / texture-prepare path). Under default-src 'self' with no worker-src, that Worker is
    // CSP-blocked, which breaks textured rendering in the viewport (bone Graphics still draw, but atlas
    // sprites do not). worker-src 'self' blob: permits our own bundled workers and Pixi's blob worker
    // WITHOUT loosening script-src (scripts stay 'self'-only, and 'unsafe-eval' remains dev-only).
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ];
};

export function cspForMode(mode: BuildMode): string {
  return BASE_DIRECTIVES(mode).join('; ') + ';';
}
