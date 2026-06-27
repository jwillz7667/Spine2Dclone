// Minimal semver parsing and comparison that drives the version gate (format-contract section 8.3
// step 1, 8.5). Internal: not part of the public surface. The full migration framework (semver
// chain, migrate.ts, migrations registry) is the deferred WP-F.8; Phase 0 needs only the gate
// primitives, since there is no pre-0.1.0 version to migrate from.

export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

// Parse an exact `x.y.z` (non-negative integers, no leading zeros per strict semver). Returns null
// for anything else, including pre-release/build suffixes (which the format does not use) and
// non-canonical strings like `00.1.0`, so those fall through to UNSUPPORTED_FORMAT_VERSION.
export function parseSemVer(value: string): SemVer | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (match === null) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return null;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

// Full semver ordering: -1 if a < b, 0 if equal, 1 if a > b.
export function compareFormatVersion(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

// The migration key is the digit that increments on a breaking change: MINOR while MAJOR is 0
// (pre-1.0), MAJOR from 1.0 on (format-contract section 8.5, 10.3).
export function migrationKeyOf(version: SemVer): number {
  return version.major === 0 ? version.minor : version.major;
}
