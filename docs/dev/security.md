# Security Model

Armature 2D is proprietary desktop software that opens untrusted files (documents, PNGs) and
exposes a headless control surface (MCP). This document describes the trust boundaries and the
concrete mitigations at each one. Report suspected vulnerabilities privately to the engineering
owner at Viral Ventures LLC; do not file them as public issues.

## Trust boundaries

1. **Document and asset files on disk** (may be malformed or hostile).
2. **The Electron renderer** (runs UI code; treated as the least-trusted process).
3. **IPC between renderer and main** (the only bridge to OS capabilities).
4. **The MCP client** (an external process, possibly an autonomous AI, sending tool calls).
5. **The math engine boundary** (external `SpinResult` data).

## 1. File input: validate on import, fail loudly (LAW 3)

Every document load, in the editor and in the MCP server, runs the full `@marionette/format`
validator before any object is constructed: strict Zod schemas (unknown keys rejected), semantic
graph checks, version gating, and optional SHA-256 content-hash verification (`verifyHash: true`
on the editor path). Malformed input produces a typed `FormatError` with a JSON Pointer path and
never a partially-built document. MRNT binary decoding is length-checked, magic-checked, and
CRC-verified with typed `BinaryDecodeError`s. PNG decoding uses pure-JS `pngjs` (no native codec
attack surface) and malformed pages surface as typed errors (`RENDER_MALFORMED_ATLAS_PAGE`,
`ATLAS_DECODE_FAILED`).

## 2. Electron hardening

Configured in `apps/editor/src/main/window-options.ts` (unit-tested) and `csp.ts`:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- The preload exposes a narrow typed bridge (`window.marionette`); the raw `ipcRenderer` is never
  exposed.
- One CSP source of truth, applied both as an HTTP response header and a build-time meta tag.
  Production: `script-src 'self'`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`,
  `frame-src 'none'`, no unsafe-eval, no remote origins (`worker-src 'self' blob:` for the PixiJS
  texture worker). Dev mode adds only what Vite HMR requires.
- The app makes no network requests; there is no telemetry and no auto-update endpoint. The release
  pipeline (WP-5.7 / PP-E5, `.github/workflows/release.yml` + `apps/editor/electron-builder.yml`) is
  built but ships an UNSIGNED, updateless first release: no publish or update provider is configured
  (`publish: null`), so packaging adds no network surface. Auto-update, when it lands, will be
  strictly OPT-IN and integrity-checked (feed-signed); until then the packaged app's only trust
  inputs remain the local files it opens.

## 3. IPC: allowlist + schema validation, deny by default

`apps/editor/src/shared/ipc-contract.ts` defines the frozen channel allowlist (`app:getVersion`,
`file:save`, `file:open`, `atlas:import`, plus the main-to-renderer `menu:action` push with its own
11-action allowlist). Main validates every request and response with Zod and returns typed
`IpcResult` values (`IPC_BAD_REQUEST` / `IPC_BAD_RESPONSE`), never bare throws. Documents cross the
wire as opaque payloads and are deep-validated by the format package at the main boundary before
any disk write. File paths are chosen by main-process native dialogs only; the renderer can never
supply a path (path-injection defense).

## 4. MCP server: sandboxed, structured, bounded

- **Filesystem confinement**: every client-supplied path is resolved against the configured
  project root; `..` traversal and absolute escapes are rejected with `PATH_FORBIDDEN` before any
  disk access (`packages/mcp-server/src/node-files.ts`, covered by `node-files.test.ts`).
- **Strict inputs**: every tool input schema is `.strict()` Zod; unknown or malformed arguments
  fail with `INVALID_INPUT` style typed codes.
- **No uncaught throws across the transport**: handler errors map to structured
  `{ code, message, detail }` results.
- **Bounded resources**: at most 16 concurrent document sessions (`SESSION_LIMIT`), render
  dimensions capped at 2048, particle budgets capped in the runtime
  (`DEFAULT_MAX_LIVE_PARTICLES = 2000` with eviction).
- **stdio transport only**: no listening socket, no network exposure; the host process controls
  the server's lifetime and privileges.
- The server is as powerful as the GUI by design (dual control). Grant a client a project root
  containing only what it should touch.

## 5. The math boundary (LAW 1)

`SpinResult` values are validated structurally at the boundary (`validateSpinResult`: shape,
bounds, cascade replay, rollup monotonicity) and money is never recomputed by presentation code.
The real engine client (`@marionette/math-bridge/real`) is lint-unreachable from every
presentation package, so no presentation code path can request or influence an outcome. This is an
integrity boundary as much as a product law: the certified engine remains the only authority.

## Supply chain and secrets

- Dependencies are few, pinned in `pnpm-lock.yaml`, installed with `--frozen-lockfile` in CI, and
  the load-bearing ones (`zod`, `@noble/hashes`, `pixi.js`) are pinned exact. Postinstall build
  scripts are denied by default (`pnpm-workspace.yaml`) except the sanctioned `electron` and
  `esbuild`.
- The package allowlist guard (`check:packages`) fails CI if an unsanctioned workspace appears.
- No secrets exist in this codebase: no API keys, no tokens, no env-var credentials. The only env
  var (`MARIONETTE_REMBG_BIN`) is an optional local binary path, validated before use with typed
  errors.
- All third-party licenses are inventoried in `NOTICE`; nothing is vendored, and the skeletal
  system is an original implementation (LAW 4), which is a legal-exposure control as well.

## Known gaps (tracked, not hidden)

- No code signing, notarization, or auto-update integrity chain yet: the release pipeline (WP-5.7)
  is built and packages all three platforms, but the first release is unsigned and updateless by
  design; signing/notarization steps are present in the workflow and gated on secrets.
- No GUI e2e security tests; the Electron posture is enforced by unit tests on the option and CSP
  factories.
- The MCP server trusts its host for authentication; it has no client identity model of its own
  (by design for stdio, revisit if a network transport is ever added).
