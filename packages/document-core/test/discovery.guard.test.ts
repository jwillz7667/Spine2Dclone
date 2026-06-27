import { describe, expect, it } from 'vitest';
import { commandRegistry } from '../src';

// Discovery guard (command-history Section 10.2): glob every *.command.ts and assert each exported
// CommandSpec appears exactly once in commandRegistry, and every registry entry has a backing file. A
// command file added without registering its spec, or a registry entry whose file vanished, fails CI.
// This makes "the harness auto-discovers every command" enforceable rather than aspirational.
const modules = import.meta.glob('../src/commands/*.command.ts', { eager: true });

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

describe('command discovery guard', () => {
  it('finds at least one command file', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it('each *.command.ts file contributes exactly one registered spec', () => {
    const fileCount = Object.keys(modules).length;
    const discovered = discoveredSpecKinds();
    // One spec per command file, no more, no fewer.
    expect(discovered).toHaveLength(fileCount);
    // The discovered set equals the registry set, exactly.
    expect([...discovered].sort()).toEqual([...commandRegistry.map((s) => s.kind)].sort());
  });

  it('has no duplicate kinds in the registry', () => {
    const kinds = commandRegistry.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
