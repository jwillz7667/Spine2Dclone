import { describe, expect, it } from 'vitest';

// R1.4 boundary guard: the edit dispatcher must be the SOLE caller of the bone setup-transform commands
// from the viewport. If a tool constructed MoveBone/RotateBone/ScaleBone directly it could mutate the
// setup pose while in animation mode, desynchronizing the playhead from the gizmo, so this is enforced by
// machine, not reviewer trust (WP-1.8 acceptance). Sources are read as raw strings through Vite's ?raw
// glob (no Node built-in import, which the sandboxed-renderer lint forbids even in tests).
const sources = import.meta.glob<string>('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// The setup-transform command constructors banned everywhere in the viewport EXCEPT the dispatcher. The
// keyframe command (SetKeyframe) is likewise constructed only by the dispatcher for auto-key; tools never
// touch a keyframe array directly. CreateBone is intentionally NOT here: bone creation is not a transform
// edit and stays the create tool's job.
const BANNED = [
  { name: 'MoveBoneCommand', re: /new\s+MoveBoneCommand\b/ },
  { name: 'RotateBoneCommand', re: /new\s+RotateBoneCommand\b/ },
  { name: 'ScaleBoneCommand', re: /new\s+ScaleBoneCommand\b/ },
  { name: 'SetBoneShearCommand', re: /new\s+SetBoneShearCommand\b/ },
] as const;

const DISPATCHER_KEY = './edit-dispatcher.ts';

function isTestFile(key: string): boolean {
  return key.includes('.test.');
}

describe('edit dispatcher is the sole caller of bone setup-transform commands (R1.4)', () => {
  it('scans the actual viewport tool sources (guard is not vacuous)', () => {
    const scanned = Object.keys(sources).filter(
      (key) => key !== DISPATCHER_KEY && !isTestFile(key),
    );
    expect(scanned).toContain('./tools/select-move-tool.ts');
    expect((sources['./tools/select-move-tool.ts'] ?? '').length).toBeGreaterThan(0);
  });

  it('constructs no setup-transform command outside the dispatcher', () => {
    for (const [key, src] of Object.entries(sources)) {
      if (key === DISPATCHER_KEY || isTestFile(key)) continue;
      for (const banned of BANNED) {
        expect(
          banned.re.test(src),
          `${key} must route bone transform edits through dispatchBoneTransform, not new ${banned.name}`,
        ).toBe(false);
      }
    }
  });

  it('keeps those constructors in the dispatcher (it is their one legitimate home)', () => {
    const dispatcher = sources[DISPATCHER_KEY];
    expect(dispatcher).toBeDefined();
    for (const banned of BANNED) {
      expect(banned.re.test(dispatcher ?? '')).toBe(true);
    }
  });
});
