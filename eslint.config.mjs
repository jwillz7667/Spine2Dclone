// Marionette flat ESLint config.
//
// Owns the Phase-0 slice of conformance-and-ci.md WP-V.10 (boundary / commands-only /
// platform-agnostic-core lint) plus the phase-0-foundations.md editor process-split matrix.
// All rules below are errors (build-failing), not warnings.
//
// Enforcement summary:
//   - INV-1: packages/runtime-core and packages/format are platform-agnostic and
//     dependency-light. No PixiJS, no Electron, no Node built-ins, no DOM/browser globals,
//     no nondeterministic globals (Date.now / new Date / Math.random).
//   - runtime-core may import format TYPES ONLY via @marionette/format/types (import type);
//     the value barrel @marionette/format and all other deep paths are banned.
//   - INV-4: no `any`, no non-const `as` in format + runtime-core.
//   - INV-6: no em-dash / en-dash anywhere (local plugin, plus the CI grep guard).
//   - Editor process split: renderer / main / preload / shared may import only along the
//     phase-0-foundations.md matrix (enforced by eslint-plugin-boundaries plus import bans).
//
// Type-aware (type-checked) lint rules are intentionally NOT enabled in Phase 0: the
// placeholder packages carry no substantive source, every ban here is syntactic or
// resolution-based (so the WP-0.1 guard tests can prove each ban fires via lintText without
// a tsconfig project), and `no unjustified as` is enforced syntactically below. Type-aware
// rules are layered in once real source exists.

import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import localRules from './tools/eslint-rules/index.mjs';

const NODE_BUILTINS = [
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'crypto',
  'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
];

const DOM_GLOBALS = [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location',
  'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'fetch', 'XMLHttpRequest',
];

const DETERMINISM_SYNTAX = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message: 'Date.now() is banned in platform-agnostic core (INV-1, determinism). Inject a clock.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'new Date() is banned in platform-agnostic core (INV-1, determinism). Inject a clock.',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message: 'Math.random() is banned in platform-agnostic core (INV-1, determinism). Inject a seed.',
  },
];

const NO_NON_CONST_AS = [
  {
    selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
    message:
      'Type assertions (as) are banned in format and runtime-core except `as const` (INV-4). ' +
      'Justify a required assertion with an inline eslint-disable and a comment.',
  },
];

const PURE_CORE_RESTRICTED_GLOBALS = DOM_GLOBALS.map((name) => ({
  name,
  message: `${name} is banned in platform-agnostic core (INV-1). Core has no DOM or browser context.`,
}));

const PIXI_PATTERN = {
  group: ['pixi.js', '@pixi/*'],
  message: 'PixiJS is banned in platform-agnostic core and the format package (INV-1).',
};

const NODE_BUILTIN_PATTERN = {
  group: ['node:*', ...NODE_BUILTINS],
  message: 'Node built-ins are banned in platform-agnostic core and the format package (INV-1).',
};

const ELECTRON_PATH = {
  name: 'electron',
  message: 'Electron is banned in platform-agnostic core and the format package (INV-1).',
};

export default tseslint.config(
  // Global ignores (no `files` sibling key allowed on an ignores-only object).
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.d.ts',
      'pnpm-lock.yaml',
    ],
  },

  // typescript-eslint recommended (non-type-checked). Registers the @typescript-eslint
  // plugin and parser for TS files; includes no-explicit-any as an error.
  ...tseslint.configs.recommended,

  // Repo-wide: INV-6 dash ban across every linted source file (TS, TSX, and JS/MJS tooling).
  {
    files: ['**/*.{ts,tsx,mts,cts,mjs,cjs,js}'],
    plugins: { local: localRules },
    rules: {
      'local/no-unicode-dashes': 'error',
    },
  },

  // Align no-unused-vars with tsc's noUnusedParameters: an underscore prefix marks an
  // intentionally unused binding (e.g. a required-by-signature React/dockview panel prop).
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // INV-4: no-explicit-any is an explicit error in the contract packages (redundant with
  // recommended, stated here so the guarantee is local to the packages that must hold it).
  {
    files: ['packages/format/src/**/*.ts', 'packages/runtime-core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX, ...NO_NON_CONST_AS],
      'no-restricted-globals': ['error', ...PURE_CORE_RESTRICTED_GLOBALS],
    },
  },

  // INV-1: packages/format is a leaf of the dependency graph. It imports nothing in-repo and
  // no platform packages. Its only external dependency is zod (enforced by the A.8 allowlist).
  {
    files: ['packages/format/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ELECTRON_PATH],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              group: ['@marionette/*'],
              message: 'packages/format is a dependency-graph leaf and imports nothing in-repo.',
            },
          ],
        },
      ],
    },
  },

  // INV-1 + format types-only boundary: runtime-core imports @marionette/format/types ONLY
  // (with `import type`, enforced by verbatimModuleSyntax at compile time). The value barrel
  // @marionette/format and any other deep path or in-repo package are banned.
  {
    files: ['packages/runtime-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ELECTRON_PATH,
            {
              name: '@marionette/format',
              message:
                'Import format TYPES only, via `import type { ... } from "@marionette/format/types"`. ' +
                'The value barrel @marionette/format pulls Zod into the platform-agnostic core (INV-1, format WP-F.9).',
            },
            {
              name: '@marionette/runtime-web',
              message: 'runtime-core must not import runtime-web; the dependency direction is format <- runtime-core <- runtime-web.',
            },
          ],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              // Narrowed to @marionette/format/* (not @marionette/*) so the negation re-includes
              // /types: gitignore semantics forbid re-including a path under an excluded parent,
              // and @marionette/format/* does not exclude the @marionette/format parent itself.
              group: ['@marionette/format/*', '!@marionette/format/types'],
              message:
                'runtime-core may import only @marionette/format/types from the format package (INV-1, format WP-F.9).',
            },
            {
              group: ['@marionette/runtime-web/*', '@marionette/runtime-core', '@marionette/runtime-core/*'],
              message: 'runtime-core must not import runtime-web, and imports format types only (INV-1).',
            },
          ],
        },
      ],
    },
  },

  // Editor process split (phase-0-foundations.md WP-0.1 matrix). eslint-plugin-boundaries
  // enforces the element-to-element edges; the per-element no-restricted-imports below add the
  // package-name and Node-built-in bans that boundaries (which classifies by file path) cannot.
  {
    files: ['packages/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['packages/**/*', 'apps/**/*'],
      'boundaries/elements': [
        { type: 'format', pattern: 'packages/format/src/**' },
        { type: 'runtime-core', pattern: 'packages/runtime-core/src/**' },
        { type: 'runtime-web', pattern: 'packages/runtime-web/src/**' },
        { type: 'editor-main', pattern: 'apps/editor/src/main/**' },
        { type: 'editor-preload', pattern: 'apps/editor/src/preload/**' },
        { type: 'editor-shared', pattern: 'apps/editor/src/shared/**' },
        { type: 'editor-renderer', pattern: 'apps/editor/src/renderer/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: ['format'], allow: ['format'] },
            { from: ['runtime-core'], allow: ['runtime-core', 'format'] },
            { from: ['runtime-web'], allow: ['runtime-web', 'runtime-core', 'format'] },
            { from: ['editor-main'], allow: ['editor-main', 'editor-shared'] },
            { from: ['editor-preload'], allow: ['editor-preload', 'editor-shared'] },
            { from: ['editor-shared'], allow: ['editor-shared'] },
            {
              from: ['editor-renderer'],
              allow: ['editor-renderer', 'editor-shared', 'runtime-web', 'runtime-core', 'format'],
            },
          ],
        },
      ],
    },
  },

  // editor-renderer: sandboxed. No Node built-ins, no Electron (it uses the preload bridge),
  // and no reaching into the main or preload process code (the process split).
  {
    files: ['apps/editor/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'The renderer is sandboxed; reach the main process only through the preload bridge.',
            },
          ],
          patterns: [
            NODE_BUILTIN_PATTERN,
            {
              group: ['**/main', '**/main/**', '**/preload', '**/preload/**'],
              message: 'Process split: the renderer must not import main or preload code.',
            },
          ],
        },
      ],
    },
  },

  // editor-preload: sandboxed isolated world. Only electron (contextBridge / ipcRenderer) and
  // editor-shared. No Node built-ins (a sandboxed preload importing fs fails at runtime), no
  // PixiJS, no React, no format value barrel, no other processes.
  {
    files: ['apps/editor/src/preload/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@marionette/format',
              message: 'The preload stays isomorphic; import format types only via @marionette/format/types.',
            },
          ],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              group: ['react', 'react-dom', '@marionette/runtime-*'],
              message: 'The sandboxed preload must not import UI, renderer, or runtime packages.',
            },
            {
              group: ['**/main', '**/main/**', '**/renderer', '**/renderer/**'],
              message: 'Process split: the preload must not import main or renderer code.',
            },
          ],
        },
      ],
    },
  },

  // editor-shared: must stay isomorphic so it cannot poison the sandboxed preload or renderer.
  // Only zod and @marionette/format/types (zero runtime). No Node, no Electron, no PixiJS, no React.
  {
    files: ['apps/editor/src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ELECTRON_PATH,
            {
              name: '@marionette/format',
              message: 'editor-shared imports format types only, via @marionette/format/types (zero runtime).',
            },
          ],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              group: ['react', 'react-dom', '@marionette/runtime-*'],
              message: 'editor-shared must stay isomorphic: no UI or runtime imports.',
            },
          ],
        },
      ],
    },
  },

  // Tooling scripts and config files: allow Node built-ins and console.
  {
    files: ['tools/**/*.{mjs,cjs,js,ts}', '*.{mjs,cjs,js}', '**/*.config.{mjs,cjs,js,ts}'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
    },
  },

  // Disable stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
);
