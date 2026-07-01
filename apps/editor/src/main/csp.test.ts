import { describe, expect, it } from 'vitest';
import { cspForMode } from './csp';

// Regression guard (R0-6): the dev relaxation must never leak into the prod policy.
describe('cspForMode', () => {
  it('prod carries no unsafe-eval and no remote (ws/http) origin', () => {
    const prod = cspForMode('prod');
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain('ws:');
    expect(prod).not.toContain('http:');
    expect(prod).toContain("default-src 'self'");
    expect(prod).toContain("object-src 'none'");
  });

  it('permits the PixiJS blob: worker (texture upload path) without loosening script-src', () => {
    for (const mode of ['dev', 'prod'] as const) {
      const policy = cspForMode(mode);
      expect(policy).toContain("worker-src 'self' blob:");
      // The blob: allowance is scoped to workers only; the script directive stays blob-free.
      const scriptDirective = policy.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
      expect(scriptDirective).not.toContain('blob:');
    }
  });

  it('dev permits the HMR websocket and dev-server origins', () => {
    const dev = cspForMode('dev');
    expect(dev).toContain('ws://localhost:*');
    expect(dev).toContain('http://localhost:*');
  });
});
