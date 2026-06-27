// Generates the committed Phase-0 world-transform golden fixture (phase-0-foundations.md WP-0.4,
// TASK-0.4.5). The fixture is the frozen, canonical serialized output of the world-transform pass
// over the golden rig at the setup pose, in the conformance fixture layout (conformance-and-ci.md
// appendix A.3). It is a deliberate, reviewed seed so that when Phase 1 stands up packages/conformance
// the Phase-0 solve behavior is already pinned and cannot silently change. Run: pnpm gen:golden.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeGolden, solveGolden } from '../test/golden-fixture';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'golden');
mkdirSync(goldenDir, { recursive: true });
writeFileSync(
  join(goldenDir, 'phase0-world-transform.json'),
  serializeGolden(solveGolden()),
  'utf8',
);
console.log('generated test/golden/phase0-world-transform.json');
