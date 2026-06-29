import { jsonPointer } from '../../validate/structural';
import type { ProjectManifest } from '../schema/manifest';
import { effectsError, EffectsValidationError } from './errors';
import type { EffectsError, ManifestValidationReport } from './errors';
import { validateManifestStructure } from './structural';

// ProjectManifest validation (phase-3-vfx-particles.md section 5.2, WP-3.0 TASK-3.0.6). Structural
// (Zod) shape, then integrity: each listed member must be PRESENT and its recomputed content hash
// must MATCH the listed `hash`. The format package imports no Node built-ins, so it cannot read the
// filesystem itself; the integrity step is therefore parameterized by a `resolved` map the caller
// (which has FS access) supplies: member path -> the artifact's recomputed content hash, or null when
// the artifact is absent or unreadable. This keeps the validator a pure function and the FS at the
// boundary.
//
// `PROJECT_MEMBER_MISSING` is a dangling member (listed but resolves to null); `PROJECT_MEMBER_HASH_MISMATCH`
// is a present member whose content hash has drifted from the manifest. Both carry the JSON path of
// the offending member entry.
export type ResolvedMemberHashes = Readonly<Record<string, string | null>>;

function checkIntegrity(manifest: ProjectManifest, resolved: ResolvedMemberHashes): EffectsError[] {
  const errors: EffectsError[] = [];
  manifest.members.forEach((member, index) => {
    const actual = resolved[member.path];
    if (actual === undefined || actual === null) {
      errors.push(
        effectsError(
          'PROJECT_MEMBER_MISSING',
          jsonPointer(['members', index, 'path']),
          `manifest member "${member.path}" is listed but could not be resolved`,
          { path: member.path },
        ),
      );
      return;
    }
    if (actual !== member.hash) {
      errors.push(
        effectsError(
          'PROJECT_MEMBER_HASH_MISMATCH',
          jsonPointer(['members', index, 'hash']),
          `manifest member "${member.path}" content hash does not match the listed hash`,
          { path: member.path, listed: member.hash, actual },
        ),
      );
    }
  });
  return errors;
}

function makeReport(
  errors: readonly EffectsError[],
  manifest: ProjectManifest | null,
): ManifestValidationReport {
  const ok = errors.length === 0;
  return Object.freeze({
    ok,
    manifest: ok ? manifest : null,
    errors: Object.freeze([...errors]),
  });
}

// Validate a ProjectManifest. When `resolved` is supplied the integrity checks run; when omitted only
// the structural shape is validated (useful for a quick shape gate before the artifacts are loaded).
export function validateProjectManifest(
  input: unknown,
  resolved?: ResolvedMemberHashes,
): ManifestValidationReport {
  const structural = validateManifestStructure(input);
  if (!structural.ok || structural.manifest === null) {
    return makeReport(structural.errors, null);
  }
  const manifest = structural.manifest;
  const errors = resolved === undefined ? [] : checkIntegrity(manifest, resolved);
  return makeReport(errors, manifest);
}

// Throwing wrapper for call sites that prefer exceptions.
export function parseProjectManifest(
  input: unknown,
  resolved?: ResolvedMemberHashes,
): ProjectManifest {
  const report = validateProjectManifest(input, resolved);
  if (!report.ok || report.manifest === null) {
    // Reuse EffectsValidationError's report shape would require an EffectsDocument; instead surface a
    // dedicated manifest report via a thin adapter. The error carries the same typed error list.
    throw new EffectsValidationError({
      ok: false,
      document: null,
      errors: report.errors,
      warnings: [],
    });
  }
  return report.manifest;
}
