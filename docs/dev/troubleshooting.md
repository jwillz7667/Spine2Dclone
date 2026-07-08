# Troubleshooting

Known failure modes and their fixes, ordered by how often they bite.

## Install / toolchain

**`pnpm install` behaves differently than CI or refuses the lockfile.**
Check `pnpm --version` is 11.8.0 (`corepack enable` makes the `packageManager` pin authoritative)
and Node is >= 22.13.0. pnpm 11 denies dependency build scripts by default; this repo sanctions
only `electron` and `esbuild` in `pnpm-workspace.yaml`. If a new dependency needs a postinstall
step, that is a deliberate allowlist change, not something to work around locally.

**Electron fails to launch after install.**
The `electron` postinstall (binary download) may have been skipped. Run
`pnpm rebuild electron`, and confirm it is in the `onlyBuiltDependencies` allowlist.

## Tests and CI

**The conformance drift gate fails but I did not touch the solve.**
Two causes. If you are not on Node 22.13.1, the byte-exact regeneration differs; use the pin
(`nvm use "$(cat .node-version)"`). If you are on the pin, you actually changed solve behavior
somewhere upstream (format defaults, curve tables, ordering); find it, do not regenerate to make
it pass.

**The drift gate fails and the change IS intentional.**
Regenerate on the pinned Node (`pnpm --filter @marionette/conformance generate` plus the
`generate:effects` / `generate:anim-state` / `generate:slot` variants as applicable), commit the
fixtures and lock files in the same PR, apply the `behavior-change` label, and update the ADR or
CHANGELOG. Never hand-edit a fixture or loosen a tolerance.

**`check:format-semver` fails.**
You touched `packages/format/src` without touching `src/version/constants.ts`. Either your change
is schema/semantic (bump the right constant with a migration and CHANGELOG entry) or it is not
(then it should not alter any constant; check what you actually changed; refactors of the
validator are fine but must leave versions untouched, and the job compares against the merge
base, so a stale branch can also trip it: rebase).

**`check:dashes` fails.**
An em-dash (U+2014) or en-dash (U+2013) crept into docs, code, or UI copy (INV-6). Replace with a
hyphen, comma, or separate sentences. The guard covers docs/, packages/, apps/, tools/, .github/,
and the root README; `CLAUDE.md` and `MARIONETTE_HANDOFF.md` are the only exclusions.

**`check:packages` fails.**
A directory exists under `packages/`, `apps/`, or `runtimes/` that is not in the phase allowlist
(LAW 5). New packages enter through the plan of record, which updates
`tools/check-packages.mjs` in the same PR.

**The round-trip harness fails for my new command.**
The harness asserts do-then-undo is bit-exact against every applicable seed. The usual causes:
the undo path rebuilds state instead of restoring the captured memento, the command mutates its
captured `before` data (capture must deep-copy or use immutable snapshots), or `coalesceWith`
merges across different targets. Also confirm the discovery guard passes: one registry entry per
`*.command.ts` file.

**Vitest passes locally, CI disagrees.**
Confirm the Node minor matches CI (22.13.x), reinstall from the lockfile
(`pnpm install --frozen-lockfile`), and re-run through Turbo (`pnpm test`) rather than a bare
vitest invocation, since Turbo builds dependencies first (`typecheck`/`build` depend on
`^build`).

## Editor

**Blank window or CSP violations in dev tools.**
Dev and prod CSP differ by design (`apps/editor/src/main/csp.ts`). In dev, `pnpm --filter editor
dev` must be the entry point (it sets `ELECTRON_RENDERER_URL`); loading the built renderer with
the dev main process (or vice versa) produces exactly this symptom.

**Attachments render as white rectangles.**
That is the placeholder texture: the document has atlas regions but no textures are loaded (or the
file was just opened, which intentionally clears the texture store). Re-import the atlas so the
texture resolver has pages again. Headless `render_frame` reports the same condition as
`placeholders: true`.

**Undo does one giant step or many tiny ones.**
Drags and paint strokes are supposed to be one step (interaction sessions / the 250 ms window).
Many tiny steps means the tool is not bracketing with `beginInteraction`/`endInteraction`; one
giant step spanning distinct edits means something merged across targets, which the same-target
rule in `coalesceWith` should prevent. Both are bugs; file with the exact gesture.

**Background removal does nothing on import.**
`MARIONETTE_REMBG_BIN` is unset (the feature is optional and off by default) or points at a
non-executable path (typed `ATLAS_REMBG_*` errors in the main-process log).

## MCP

**`PATH_FORBIDDEN` on save/open/atlas/render.**
The path escapes the project root the server was started with. Pass paths relative to that root;
start the server with the root you intend (`node dist/cli.js <projectRoot>`).

**`SESSION_LIMIT` errors.**
The registry caps at 16 open documents; `document.close` finished sessions.

**Two consecutive tool calls did not coalesce into one undo step.**
Intentional: the server clock advances 1000 ms per call, past the 250 ms window. Bracket the
gesture with `history.beginInteraction` / `history.endInteraction`.

**stdout corruption / client cannot parse the stream.**
Something wrote to stdout in-process. The server reserves stdout for the MCP transport and logs to
stderr; keep it that way in any code you add.
