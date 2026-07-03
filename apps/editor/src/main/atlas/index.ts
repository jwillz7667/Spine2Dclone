// The editor main-process atlas surface. The deterministic pack pipeline (import -> alpha-trim -> pack ->
// emit) now lives in the shared @marionette/atlas-pack package (ADR-0007) so both the editor main process
// and the headless MCP server can pack. This barrel re-exports that package unchanged and keeps rembg
// (editor-only, env-gated background removal that the pack path never calls) local. The IPC layer imports
// only from this barrel, so the extraction changed no call site.

export * from '@marionette/atlas-pack';

export { REMBG_ENV, resolveRembgConfig, requireRembgConfig, removeBackground } from './rembg';
export type { RembgConfig } from './rembg';
