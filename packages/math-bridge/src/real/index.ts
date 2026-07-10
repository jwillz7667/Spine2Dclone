// Barrel for the real-engine adapter sub-path (@marionette/math-bridge/real, phase-4 WP-4.3). This is
// deliberately NOT re-exported from the math-bridge main barrel: it is reached only by editor-host /
// runtime-host wiring, and runtime-core must NEVER import it (the boundary lint bans
// @marionette/math-bridge/* from runtime-core). The adapter binds to the engine's NON-TRANSACTING resolve
// only (the money boundary, section 4.3).
export { RealEngineAdapter, RealEngineMappingError } from './adapter';
export type { RealAdapterErrorCode, SymbolMap } from './adapter';
export { resolveRealEngineConfig, RealEngineConfigError } from './config';
export type { RealEngineConfig } from './config';
export type { NonTransactingResolveClient, RealResolveOptions } from './client';
export type { NativeResolveOutput, NativeCascade } from './native';
export { nativeResolveOutputSchema } from './native-schema';

// The concrete HTTP transport for the non-transacting resolve (WP-5.8).
export {
  HttpResolveClient,
  createGlobalResolveFetch,
  createRealHttpEngine,
} from './http-transport';
export type {
  HttpResolveDeps,
  HttpResolveRequest,
  HttpResolveResponse,
  ResolveFetch,
  CreateRealHttpEngineParams,
} from './http-transport';
export { httpTransportConfigSchema, parseHttpTransportConfig } from './http-config';
export type { HttpTransportConfig } from './http-config';
export { RealEngineTransportError, isRetryableTransportError } from './errors';
export type { RealEngineTransportErrorCode, RealEngineTransportErrorOptions } from './errors';
