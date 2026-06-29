// Real-engine configuration (phase-4 WP-4.3 TASK-4.3.4), validated at boot. Takes the environment as a
// PARAMETER (the host passes process.env) so it stays pure and testable, and so math-bridge core carries
// no direct process global. Fails fast (LAW 3 fail-loud) when the real engine is selected but its
// non-transacting resolve handle is absent, AND when a transacting endpoint is configured for preview
// (the money boundary, section 4.3): preview must never reach a transacting endpoint.

export interface RealEngineConfig {
  readonly resolveEndpoint: string;
}

export class RealEngineConfigError extends Error {
  readonly code = 'REAL_ENGINE_CONFIG';
  constructor(message: string) {
    super(message);
    this.name = 'RealEngineConfigError';
  }
}

const RESOLVE_ENV = 'MARIONETTE_ENGINE_RESOLVE_ENDPOINT';
const TRANSACTING_ENV = 'MARIONETTE_ENGINE_TRANSACTING_ENDPOINT';

// Resolve and validate the real-engine config from an env map. Throws RealEngineConfigError on a missing
// resolve handle or a present transacting endpoint.
export function resolveRealEngineConfig(
  env: Readonly<Record<string, string | undefined>>,
): RealEngineConfig {
  const resolveEndpoint = env[RESOLVE_ENV];
  if (resolveEndpoint === undefined || resolveEndpoint.length === 0) {
    throw new RealEngineConfigError(
      `${RESOLVE_ENV} is required when the active engine is "real" (the non-transacting resolve handle).`,
    );
  }
  if (env[TRANSACTING_ENV] !== undefined && env[TRANSACTING_ENV] !== '') {
    throw new RealEngineConfigError(
      `${TRANSACTING_ENV} must NOT be set for preview/acceptance: it is the money boundary (section 4.3). Preview uses the non-transacting resolve only.`,
    );
  }
  return { resolveEndpoint };
}
