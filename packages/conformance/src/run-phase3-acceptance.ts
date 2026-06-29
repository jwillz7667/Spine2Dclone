import { loadMegaWinArtifact, runPhase3Acceptance } from './phase3-acceptance';

// CLI entry for `pnpm phase3:acceptance` (phase-3-vfx-particles.md section 12.2). Runs the Phase 3 DoD
// acceptance harness over the committed megaWin artifact and prints a per-check report, exiting non-zero
// if any check fails so it gates CI. The same harness backs phase3-acceptance.test.ts; this wrapper just
// adds human-readable output + a process exit code.

const report = runPhase3Acceptance(loadMegaWinArtifact());
for (const check of report.checks) {
  const mark = check.ok ? 'PASS' : 'FAIL';
  process.stdout.write(`[${mark}] ${check.name}: ${check.detail}\n`);
}
process.stdout.write(report.ok ? '\nphase3:acceptance PASSED\n' : '\nphase3:acceptance FAILED\n');
process.exit(report.ok ? 0 : 1);
