import { describe, expect, it } from 'vitest';
import { effectsCommandRegistry } from '../src';

// Effects discovery guard (the effects mirror of discovery.guard.test.ts): glob every *.command.ts under
// effects-commands/ and assert each exported EffectCommandSpec appears exactly once in
// effectsCommandRegistry, and every registry entry has a backing file. A command file added without
// registering its spec, or a registry entry whose file vanished, fails CI. This makes "the effects harness
// auto-discovers every command" enforceable rather than aspirational.
const modules = import.meta.glob('../src/effects-commands/*.command.ts', { eager: true });

function isSpec(value: unknown): value is { readonly kind: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'fixture' in value &&
    'assertApplied' in value
  );
}

function discoveredSpecKinds(): string[] {
  const kinds: string[] = [];
  for (const mod of Object.values(modules)) {
    for (const value of Object.values(mod as Record<string, unknown>)) {
      if (isSpec(value)) kinds.push(value.kind);
    }
  }
  return kinds;
}

describe('effects command discovery guard', () => {
  it('finds an effect command file per registry entry', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it('each *.command.ts file contributes exactly one registered spec', () => {
    const fileCount = Object.keys(modules).length;
    const discovered = discoveredSpecKinds();
    expect(discovered).toHaveLength(fileCount);
    expect([...discovered].sort()).toEqual([...effectsCommandRegistry.map((s) => s.kind)].sort());
  });

  it('has no duplicate kinds in the effects registry', () => {
    const kinds = effectsCommandRegistry.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('registers the full section-10 command table (21 commands)', () => {
    // WP-3.7 section 10: 5 effect-level + 5 layer + 5 life-curve + 6 bundle commands = 21.
    expect(effectsCommandRegistry.length).toBe(21);
  });
});
