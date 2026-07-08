// Repo-wide em-dash / en-dash grep guard (INV-6, phase-0-foundations.md section 7).
// Backs the lint-level rule (tools/eslint-rules) by covering Markdown and other non-linted
// text under docs/ plus authored source and config. Scope matches the exit gate ("docs/,
// comments, UI copy"); the imported reference specs at the repo root (MARIONETTE_HANDOFF.md,
// CLAUDE.md) predate this guard and are intentionally out of scope.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DASH = /[\u2014\u2013]/;
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.cs',
  '.gd',
  '.csproj',
]);
const SCAN_DIRS = ['docs', 'packages', 'apps', 'tools', '.github', 'runtimes'];
const SCAN_ROOT_FILES = ['README.md'];
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.turbo', '.git']);
const EXCLUDE_FILES = new Set(['pnpm-lock.yaml', 'MARIONETTE_HANDOFF.md', 'CLAUDE.md']);

/**
 * @param {string} root
 * @returns {{ file: string, line: number, text: string }[]}
 */
export function findDashes(root) {
  const hits = [];
  const visit = (abs) => {
    const name = basename(abs);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
      return;
    }
    if (EXCLUDE_FILES.has(name)) return;
    if (!TEXT_EXT.has(extname(abs))) return;
    const lines = readFileSync(abs, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (DASH.test(text)) hits.push({ file: relative(root, abs), line: i + 1, text: text.trim() });
    });
  };
  for (const dir of SCAN_DIRS) {
    const abs = join(root, dir);
    if (existsSync(abs)) visit(abs);
  }
  for (const f of SCAN_ROOT_FILES) {
    const abs = join(root, f);
    if (existsSync(abs)) visit(abs);
  }
  return hits;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const root = process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..');
  const hits = findDashes(root);
  if (hits.length > 0) {
    console.error('em-dash guard FAILED: em-dash (U+2014) or en-dash (U+2013) found (INV-6):');
    for (const h of hits) console.error(`  ${h.file}:${h.line}  ${h.text}`);
    console.error('\nUse commas, parentheses, or separate sentences.');
    process.exit(1);
  }
  console.log('em-dash guard OK: no em-dash or en-dash in scanned files.');
}
