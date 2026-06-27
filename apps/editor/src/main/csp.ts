// PURE Content-Security-Policy builder, split by build mode (R0-6). The dev relaxation (the Vite
// HMR websocket and dev server origins, plus unsafe-eval that the dev bundler needs) must NEVER
// reach prod. A unit test asserts the prod string carries no remote origin and no unsafe-eval.
// PixiJS v8 runs from bundled assets, so prod needs no CDN origin.

export type BuildMode = 'dev' | 'prod';

const BASE_DIRECTIVES = (mode: BuildMode): readonly string[] => {
  const scriptSrc = mode === 'dev' ? "script-src 'self' 'unsafe-eval'" : "script-src 'self'";
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
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ];
};

export function cspForMode(mode: BuildMode): string {
  return BASE_DIRECTIVES(mode).join('; ') + ';';
}
