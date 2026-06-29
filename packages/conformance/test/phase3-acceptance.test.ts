import { describe, expect, it } from 'vitest';
import { loadMegaWinArtifact, runPhase3Acceptance } from '../src/phase3-acceptance';

// WP-3.11: the Phase 3 Definition-of-Done acceptance gate (phase-3-vfx-particles.md section 12.2/12.3).
// It runs the in-TS acceptance harness over the committed megaWin artifact and asserts EVERY check
// passes (schema validation, by-name bundle expansion + timing, caps, determinism, the bone-anchor path,
// the additive-blend intent, and the solve-perf budget), plus a NEGATIVE test that a corrupted artifact
// fails the schema-validate check loudly (fail-loud, Law 3). The cross-runtime determinism guarantee is
// carried by the WP-3.10 fixtures and proven against native Unity/Godot in Phase 5; this gate proves the
// editor and runtime-web embeddings of the SAME runtime-core solve agree and the milestone bundle plays.

describe('WP-3.11 Phase 3 DoD acceptance', () => {
  it('every acceptance check passes for the committed megaWin artifact', () => {
    const report = runPhase3Acceptance(loadMegaWinArtifact());
    // Surface the failing checks by name so a regression points at the exact step.
    const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
    expect(failed).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('reports each milestone check by name', () => {
    const report = runPhase3Acceptance(loadMegaWinArtifact());
    const names = report.checks.map((c) => c.name);
    for (const required of [
      'schema-validate',
      'bundle-present',
      'bundle-expansion',
      'bundle-refs-resolve',
      'trigger-instance-count',
      'caps',
      'determinism',
      'bone-anchor-ribbon',
      'additive-blend-intent',
      'screen-flash-resets',
      'solve-perf',
    ]) {
      expect(names, `check ${required} present`).toContain(required);
    }
  });

  it('fails loudly on a corrupted artifact (negative test, Law 3)', () => {
    // Strip the required atlas: the WP-3.0 schema must reject it, so schema-validate fails and the run
    // short-circuits with ok === false (a corrupted export does not silently "pass").
    const raw = loadMegaWinArtifact() as Record<string, unknown>;
    delete raw.atlas;
    const report = runPhase3Acceptance(raw);
    expect(report.ok).toBe(false);
    const validate = report.checks.find((c) => c.name === 'schema-validate');
    expect(validate).toBeDefined();
    expect(validate!.ok).toBe(false);
  });
});
