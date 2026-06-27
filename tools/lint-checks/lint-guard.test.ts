// WP-0.1 boundary guard suite: proves the real flat ESLint config (eslint.config.mjs) actually
// fires each architectural ban on an injected violation, and stays quiet on the allowed cases.
// This is the machine verification behind the DoD "boundary invariants are machine-enforced".
//
// Em-dash test inputs are built from escape sequences so this source file itself stays INV-6
// clean (the linted runtime string carries the real character; the file on disk does not).

import { ESLint } from 'eslint';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../..');
let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

async function lint(relPath: string, code: string): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, {
    filePath: join(repoRoot, relPath),
    warnIgnored: false,
  });
  return result?.messages ?? [];
}

function ruleIds(messages: ESLint.LintResult['messages']): string[] {
  return messages.map((m) => m.ruleId ?? '').filter(Boolean);
}

const CORE = 'packages/runtime-core/src/__guard__.ts';
const FORMAT = 'packages/format/src/__guard__.ts';
const RENDERER = 'apps/editor/src/renderer/__guard__.ts';
const PRELOAD = 'apps/editor/src/preload/__guard__.ts';
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

describe('platform-agnostic core bans (INV-1)', () => {
  it('bans pixi.js in runtime-core', async () => {
    expect(ruleIds(await lint(CORE, "import 'pixi.js';\n"))).toContain('no-restricted-imports');
  });

  it('bans @pixi/* in runtime-core', async () => {
    expect(ruleIds(await lint(CORE, "import '@pixi/sound';\n"))).toContain('no-restricted-imports');
  });

  it('bans Node built-ins in runtime-core and format', async () => {
    expect(ruleIds(await lint(CORE, "import 'fs';\n"))).toContain('no-restricted-imports');
    expect(ruleIds(await lint(FORMAT, "import 'node:path';\n"))).toContain('no-restricted-imports');
  });

  it('bans electron in runtime-core', async () => {
    expect(ruleIds(await lint(CORE, "import 'electron';\n"))).toContain('no-restricted-imports');
  });

  it('bans DOM/browser globals in runtime-core', async () => {
    expect(ruleIds(await lint(CORE, 'export const w = window;\n'))).toContain(
      'no-restricted-globals',
    );
  });

  it('bans nondeterministic calls (Math.random, Date.now) in runtime-core', async () => {
    expect(ruleIds(await lint(CORE, 'export const r = Math.random();\n'))).toContain(
      'no-restricted-syntax',
    );
    expect(ruleIds(await lint(CORE, 'export const t = Date.now();\n'))).toContain(
      'no-restricted-syntax',
    );
  });
});

describe('format types-only boundary (INV, format WP-F.9)', () => {
  it('bans the @marionette/format value barrel in runtime-core', async () => {
    const messages = await lint(CORE, "import { validateDocument } from '@marionette/format';\n");
    expect(ruleIds(messages)).toContain('no-restricted-imports');
  });

  it('allows @marionette/format/types via import type in runtime-core', async () => {
    const messages = await lint(
      CORE,
      "import type { SkeletonDocument } from '@marionette/format/types';\nexport type Doc = SkeletonDocument;\n",
    );
    expect(ruleIds(messages)).not.toContain('no-restricted-imports');
  });
});

describe('no any / no unjustified as in format + runtime-core (INV-4)', () => {
  it('bans explicit any in format', async () => {
    expect(ruleIds(await lint(FORMAT, 'export const x: any = 1;\n'))).toContain(
      '@typescript-eslint/no-explicit-any',
    );
  });

  it('bans a non-const type assertion in runtime-core but allows as const', async () => {
    expect(ruleIds(await lint(CORE, "export const n = ('x' as string).length;\n"))).toContain(
      'no-restricted-syntax',
    );
    expect(ruleIds(await lint(CORE, 'export const t = [1, 2] as const;\n'))).not.toContain(
      'no-restricted-syntax',
    );
  });
});

describe('editor process split (phase-0 WP-0.1 matrix)', () => {
  it('bans the renderer importing main-process code', async () => {
    const ids = ruleIds(await lint(RENDERER, "import '../main/index';\n"));
    expect(ids.some((r) => r === 'no-restricted-imports' || r === 'boundaries/element-types')).toBe(
      true,
    );
  });

  it('bans the sandboxed preload importing Node built-ins', async () => {
    expect(ruleIds(await lint(PRELOAD, "import 'node:fs';\n"))).toContain('no-restricted-imports');
  });
});

describe('INV-6 dash ban (local rule)', () => {
  it('flags an em-dash in a string literal', async () => {
    const messages = await lint(CORE, `export const s = 'a${EM_DASH}b';\n`);
    expect(ruleIds(messages)).toContain('local/no-unicode-dashes');
  });

  it('flags an en-dash in a comment', async () => {
    const messages = await lint(CORE, `// range 0${EN_DASH}1\nexport const ok = 1;\n`);
    expect(ruleIds(messages)).toContain('local/no-unicode-dashes');
  });
});

describe('positive control', () => {
  it('clean core source produces no errors', async () => {
    const messages = await lint(CORE, 'export const ok = 1;\n');
    expect(messages.filter((m) => m.severity === 2)).toHaveLength(0);
  });
});
