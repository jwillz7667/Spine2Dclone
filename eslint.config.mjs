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
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'location',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'performance',
  'fetch',
  'XMLHttpRequest',
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
    message:
      'Math.random() is banned in platform-agnostic core (INV-1, determinism). Inject a seed.',
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
  // math-bridge is held to the same bar (phase-4 section 5.3): it is the engine boundary contract and
  // must be as type-safe as format/runtime-core. (math-bridge is NOT a pure-core package, so the DOM /
  // determinism global bans below do not apply to it; its import boundary is the separate block at the
  // end of this file.)
  {
    files: ['packages/format/src/**/*.ts', 'packages/runtime-core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX, ...NO_NON_CONST_AS],
      'no-restricted-globals': ['error', ...PURE_CORE_RESTRICTED_GLOBALS],
    },
  },
  {
    files: ['packages/math-bridge/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': ['error', ...NO_NON_CONST_AS],
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

  // math-bridge boundary (phase-4 section 5.3): the engine OUTCOME package may import the format
  // contract (so a SpinResult cell is typed as SymbolId) and nothing else in-repo. It is PixiJS-free and
  // renderer-free; the external certified-engine client is reached ONLY from the real/** sub-path (an
  // external dependency, so it is not an @marionette/* ban target here).
  {
    files: ['packages/math-bridge/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ELECTRON_PATH],
          patterns: [
            PIXI_PATTERN,
            {
              group: [
                'react',
                'react-dom',
                '@marionette/runtime-web',
                '@marionette/runtime-web/*',
                '@marionette/runtime-core',
                '@marionette/runtime-core/*',
                '@marionette/document-core',
                '@marionette/document-core/*',
                '@marionette/mcp-server',
                '@marionette/mcp-server/*',
                '@marionette/conformance',
                '@marionette/conformance/*',
              ],
              message:
                'math-bridge imports the format contract only (CD-1, phase-4 section 5.3): no renderer, no runtime, no document-core.',
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
              message:
                'runtime-core must not import runtime-web; the dependency direction is format <- runtime-core <- runtime-web.',
            },
            {
              name: '@marionette/math-bridge',
              message:
                'runtime-core (incl. effects) must not import math-bridge or any SpinResult type (LAW 1, ' +
                'phase-3 WP-3.4): presentation is a pure function of inputs and never reads outcome.',
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
              group: [
                '@marionette/runtime-web/*',
                '@marionette/runtime-core',
                '@marionette/runtime-core/*',
              ],
              message:
                'runtime-core must not import runtime-web, and imports format types only (INV-1).',
            },
            {
              // LAW 1 (phase-3 WP-3.4 TASK-3.4.6): no runtime-core/effects module may reach math-bridge
              // or a SpinResult type. The deep-path pattern complements the bare-name path ban above so
              // an import-graph gate, not reviewer trust, enforces the math/presentation boundary.
              group: ['@marionette/math-bridge/*'],
              message:
                'runtime-core (incl. effects) must not import math-bridge or any SpinResult type (LAW 1, ' +
                'phase-3 WP-3.4): presentation never reads outcome.',
            },
          ],
        },
      ],
    },
  },

  // runtime-core/slot carve-out (phase-4 WP-4.7): the slot sequencer is the determinism boundary and is a
  // pure function OF a SpinResult (LAW 1), so it MUST import the math-bridge SpinResult VALUE TYPES
  // (@marionette/math-bridge + /types) and the format slot-config TYPES (@marionette/format/slot-types,
  // plus /types). This block REPLACES the runtime-core-wide no-restricted-imports for slot/** files (a
  // later matching flat-config block wins). It keeps every OTHER ban: electron, pixi, node built-ins, the
  // format value barrel, runtime-web, runtime-core self-imports, AND it still bans the engine client
  // @marionette/math-bridge/real (the sequencer reads SpinResult VALUE TYPES but NEVER the certified
  // engine client, LAW 1). math-bridge itself and math-bridge/types are NOT banned here (they are the
  // permitted carve-out); the runtime-core-wide block above keeps banning them everywhere else (effects).
  {
    files: ['packages/runtime-core/src/slot/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ELECTRON_PATH,
            {
              name: '@marionette/format',
              message:
                'Import format TYPES only, via `import type { ... } from "@marionette/format/types"` or ' +
                '"@marionette/format/slot-types". The value barrel @marionette/format pulls Zod into the ' +
                'platform-agnostic core (INV-1, format WP-F.9).',
            },
            {
              name: '@marionette/runtime-web',
              message:
                'runtime-core must not import runtime-web; the dependency direction is format <- runtime-core <- runtime-web.',
            },
          ],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              // Permit @marionette/format/types AND /slot-types (the authored slot-config types), ban every
              // other deep format path (the value sub-barrels pull Zod into the pure core).
              group: [
                '@marionette/format/*',
                '!@marionette/format/types',
                '!@marionette/format/slot-types',
              ],
              message:
                'runtime-core/slot may import only @marionette/format/types and ' +
                '@marionette/format/slot-types from the format package (INV-1, format WP-F.9).',
            },
            {
              group: [
                '@marionette/runtime-web/*',
                '@marionette/runtime-core',
                '@marionette/runtime-core/*',
              ],
              message:
                'runtime-core must not import runtime-web, and must not deep-import itself (INV-1).',
            },
            {
              // LAW 1: the sequencer reads the SpinResult VALUE TYPES (@marionette/math-bridge + /types,
              // permitted here) but NEVER the certified-engine client (math-bridge/real), which would be a
              // channel from presentation toward the engine. The /real sub-path stays banned.
              group: ['@marionette/math-bridge/real', '@marionette/math-bridge/real/*'],
              message:
                'runtime-core/slot reads SpinResult VALUE TYPES but never the engine client ' +
                '(@marionette/math-bridge/real): presentation has no channel back to the engine (LAW 1).',
            },
          ],
        },
      ],
    },
  },

  // document-core: renderer-agnostic command/history spine (ADR-0001). It must run identically in the
  // editor renderer, the Electron main process (headless MCP server), and Vitest, so it bans PixiJS,
  // Node built-ins, Electron, React, runtime-web, and DOM/browser globals (including `performance`, so
  // `performance.now` cannot leak in: History takes an injected clock, command-history Section 5/7.2).
  // Nondeterministic globals are banned too (IDs come from an injected counter, time from the clock).
  {
    files: ['packages/document-core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ELECTRON_PATH],
          patterns: [
            PIXI_PATTERN,
            NODE_BUILTIN_PATTERN,
            {
              group: ['react', 'react-dom', '@marionette/runtime-web', '@marionette/runtime-web/*'],
              message:
                'document-core is renderer-agnostic: no React, no PixiJS, no runtime-web (ADR-0001).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...PURE_CORE_RESTRICTED_GLOBALS],
      'no-restricted-syntax': ['error', ...DETERMINISM_SYNTAX],
    },
  },

  // mcp-server: the headless MCP control surface (WP-M.1). It drives document-core commands and reads
  // runtime-core solves, exposing them as MCP tools so an AI can fully author scenes (the same path the
  // GUI uses, LAW 2). It is renderer-free: no PixiJS, no React, no runtime-web, no DOM/browser globals.
  {
    files: ['packages/mcp-server/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PIXI_PATTERN,
            {
              group: ['react', 'react-dom', '@marionette/runtime-web', '@marionette/runtime-web/*'],
              message: 'mcp-server is renderer-free: no React, no PixiJS, no runtime-web.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...PURE_CORE_RESTRICTED_GLOBALS],
    },
  },

  // conformance: the cross-runtime behavioral-truth suite (conformance-and-ci.md A.1, WP-V.0). It may
  // import @marionette/format and @marionette/runtime-core (the behavioral source of truth), plus zod
  // and Node built-ins (the generator and the loaders touch the filesystem). It must NOT import
  // PixiJS, Electron, React, runtime-web, document-core, or mcp-server: it is renderer-free and depends
  // only on the format contract and the pure solve core, so the generator stays a pure function of
  // (rig, sample-spec, runtime-core). Node built-ins are intentionally NOT banned here (unlike the pure
  // core packages): the generator must read rigs/specs and write fixtures + the lock manifest.
  {
    files: ['packages/conformance/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ELECTRON_PATH],
          patterns: [
            PIXI_PATTERN,
            {
              group: [
                'react',
                'react-dom',
                '@marionette/runtime-web',
                '@marionette/runtime-web/*',
                '@marionette/document-core',
                '@marionette/document-core/*',
                '@marionette/mcp-server',
                '@marionette/mcp-server/*',
              ],
              message:
                'conformance is renderer-free and depends only on format + runtime-core: no PixiJS, React, runtime-web, document-core, or mcp-server (conformance-and-ci.md A.1).',
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
        // math-bridge is the engine OUTCOME boundary (phase-4 section 5.3). The core may import format
        // only; the real/** sub-path additionally imports the external engine client (not an in-repo
        // element, so element-types does not govern it). It lands in Phase 4 (WP-4.1).
        { type: 'math-bridge', pattern: 'packages/math-bridge/src/**' },
        { type: 'runtime-core', pattern: 'packages/runtime-core/src/**' },
        { type: 'runtime-web', pattern: 'packages/runtime-web/src/**' },
        { type: 'document-core', pattern: 'packages/document-core/src/**' },
        { type: 'mcp-server', pattern: 'packages/mcp-server/src/**' },
        { type: 'conformance', pattern: 'packages/conformance/src/**' },
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
            // math-bridge owns the outcome boundary; it may import the format contract (so SpinResult
            // cells are typed as SymbolId) and nothing else in-repo (CD-1 direction: format never
            // imports math-bridge). The external engine client used by real/** is not an in-repo element.
            { from: ['math-bridge'], allow: ['math-bridge', 'format'] },
            // runtime-core imports format types; the runtime-core/slot sequencer ALSO imports the
            // math-bridge SpinResult VALUE TYPES (phase-4 WP-4.7, LAW 1: presentation is a pure function
            // OF the outcome, it never reads the engine client). boundaries is coarse (it cannot see the
            // /slot sub-path or the import-type distinction), so it allows math-bridge at the package
            // level; the fine-grained ban (slot-only, never math-bridge/real, never in effects) is
            // enforced by the no-restricted-imports blocks below.
            { from: ['runtime-core'], allow: ['runtime-core', 'format', 'math-bridge'] },
            { from: ['runtime-web'], allow: ['runtime-web', 'runtime-core', 'format'] },
            // document-core is the renderer-agnostic command/history spine (ADR-0001). It consumes
            // only format (validate/hash/types) and, where a transform command needs it, runtime-core.
            { from: ['document-core'], allow: ['document-core', 'format', 'runtime-core'] },
            // mcp-server exposes document-core commands as MCP tools (WP-M.1). It drives the same
            // commands the GUI does and reads runtime-core solves; never the renderer/UI packages.
            {
              from: ['mcp-server'],
              allow: ['mcp-server', 'document-core', 'format', 'runtime-core'],
            },
            // conformance is the cross-runtime behavioral-truth suite (conformance-and-ci.md A.1). It
            // consumes the format contract and the pure solve core (runtime-core), and (phase-4 WP-4.13, the
            // slot golden-playback track) the math-bridge SpinResult VALUE TYPES + MockMathEngine outcomes:
            // the slot golden locks `sequence(result, scene)`, whose input is an engine SpinResult, so the
            // committed (SpinResult, SlotScene) pairs must validate via the math-bridge contract. The fixtures
            // stay a pure function of (spin, scene, sample-spec, core); never the renderer/UI packages.
            {
              from: ['conformance'],
              allow: ['conformance', 'format', 'runtime-core', 'math-bridge'],
            },
            // editor-main hosts the headless MCP server (WP-M.1), which drives document-core commands
            // and reads runtime-core solves; it stays off the renderer/UI packages.
            {
              from: ['editor-main'],
              allow: [
                'editor-main',
                'editor-shared',
                'mcp-server',
                'document-core',
                'format',
                'runtime-core',
              ],
            },
            { from: ['editor-preload'], allow: ['editor-preload', 'editor-shared'] },
            { from: ['editor-shared'], allow: ['editor-shared'] },
            {
              from: ['editor-renderer'],
              allow: [
                'editor-renderer',
                'editor-shared',
                'runtime-web',
                'runtime-core',
                'document-core',
                'format',
              ],
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
              message:
                'The renderer is sandboxed; reach the main process only through the preload bridge.',
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
              message:
                'The preload stays isomorphic; import format types only via @marionette/format/types.',
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
              message:
                'editor-shared imports format types only, via @marionette/format/types (zero runtime).',
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
