import { z } from 'zod';
import { RealEngineConfigError } from './config';

// Validated configuration for the HTTP resolve transport (WP-5.8). A malformed config fails fast at
// construction with a typed RealEngineConfigError (LAW 3), before any request is attempted. `baseUrl` is
// the NON-TRANSACTING resolve endpoint (the money boundary, section 4.3): the transport has no transacting
// method, and env-level wiring (resolveRealEngineConfig) additionally refuses a transacting endpoint, so a
// preview build cannot reach one. The retry policy applies to idempotent resolves only (see errors.ts).

const retryPolicySchema = z
  .object({
    // Retries AFTER the first attempt. 0 disables retry (a single attempt). Bounded so a run of transient
    // failures cannot fan out unboundedly (backpressure).
    maxRetries: z.number().int().nonnegative().max(10).default(3),
    // Base backoff in ms; the nth retry waits up to min(maxDelayMs, baseDelayMs * 2^n) with full jitter.
    baseDelayMs: z.number().int().positive().max(60_000).default(200),
    maxDelayMs: z.number().int().positive().max(120_000).default(5_000),
  })
  .refine((r) => r.maxDelayMs >= r.baseDelayMs, {
    message: 'maxDelayMs must be >= baseDelayMs',
    path: ['maxDelayMs'],
  });

export const httpTransportConfigSchema = z.object({
  // The absolute non-transacting resolve URL. Must be a syntactically valid URL (http/https enforced
  // below); a relative path or garbage fails fast.
  baseUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'baseUrl must be an http(s) URL',
    }),
  // Optional bearer/API-key header applied to every request. Kept as a name/value pair so a secret is
  // passed in from the host env, never embedded here.
  authHeader: z.object({ name: z.string().min(1), value: z.string().min(1) }).optional(),
  // Per-attempt wall-clock budget. Each attempt (not the whole retry sequence) is bounded by this.
  timeoutMs: z.number().int().positive().max(120_000).default(10_000),
  retry: retryPolicySchema.default({}),
});

export type HttpTransportConfig = z.infer<typeof httpTransportConfigSchema>;

// Parse and validate a raw config object, throwing a typed RealEngineConfigError on any violation (LAW 3
// fail-loud). The error path points at the offending field so a misconfiguration is actionable.
export function parseHttpTransportConfig(raw: unknown): HttpTransportConfig {
  const parsed = httpTransportConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined ? '' : `/${issue.path.join('/')}`;
    const message = issue === undefined ? 'unknown validation error' : issue.message;
    throw new RealEngineConfigError(`invalid HTTP transport config at ${path}: ${message}`);
  }
  return parsed.data;
}
