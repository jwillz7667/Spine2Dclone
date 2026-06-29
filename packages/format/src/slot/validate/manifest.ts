import { jsonPointer } from '../../validate/structural';
import type { SlotProjectManifest } from '../manifest';
import { slotSceneError, SlotSceneValidationError } from './errors';
import type { SlotSceneError, SlotManifestValidationReport } from './errors';
import { validateSlotManifestStructure } from './structural';

// SlotProjectManifest validation (format-contract section 15.4 / phase-4 section 6.2, WP-4.4
// TASK-4.4.5). Structural (Zod) shape, then integrity: each listed member must be PRESENT and its
// recomputed content hash must MATCH the listed `hash`. The format package imports no Node built-ins,
// so it cannot read the filesystem itself; the integrity step is parameterized by a `resolved` map the
// caller (which has FS access) supplies: member path -> the artifact's recomputed content hash, or null
// when the artifact is absent or unreadable. This keeps the validator a pure function and the FS at the
// boundary, exactly as the effects manifest validator does.
//
// `projectMemberMissing` is a dangling member (listed but resolves to null); `projectMemberHashMismatch`
// is a present member whose content hash has drifted from the manifest. Both carry the JSON path of the
// offending member entry.
export type ResolvedMemberHashes = Readonly<Record<string, string | null>>;

function checkIntegrity(
  manifest: SlotProjectManifest,
  resolved: ResolvedMemberHashes,
): SlotSceneError[] {
  const errors: SlotSceneError[] = [];
  manifest.members.forEach((member, index) => {
    const actual = resolved[member.path];
    if (actual === undefined || actual === null) {
      errors.push(
        slotSceneError(
          'projectMemberMissing',
          jsonPointer(['members', index, 'path']),
          `manifest member "${member.path}" is listed but could not be resolved`,
          { path: member.path },
        ),
      );
      return;
    }
    if (actual !== member.hash) {
      errors.push(
        slotSceneError(
          'projectMemberHashMismatch',
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
  errors: readonly SlotSceneError[],
  manifest: SlotProjectManifest | null,
): SlotManifestValidationReport {
  const ok = errors.length === 0;
  return Object.freeze({
    ok,
    manifest: ok ? manifest : null,
    errors: Object.freeze([...errors]),
  });
}

// Validate a SlotProjectManifest. When `resolved` is supplied the integrity checks run; when omitted
// only the structural shape is validated (useful for a quick shape gate before the artifacts are
// loaded).
export function validateSlotProjectManifest(
  input: unknown,
  resolved?: ResolvedMemberHashes,
): SlotManifestValidationReport {
  const structural = validateSlotManifestStructure(input);
  if (!structural.ok || structural.manifest === null) {
    return makeReport(structural.errors, null);
  }
  const manifest = structural.manifest;
  const errors = resolved === undefined ? [] : checkIntegrity(manifest, resolved);
  return makeReport(errors, manifest);
}

// Throwing wrapper for call sites that prefer exceptions.
export function parseSlotProjectManifest(
  input: unknown,
  resolved?: ResolvedMemberHashes,
): SlotProjectManifest {
  const report = validateSlotProjectManifest(input, resolved);
  if (!report.ok || report.manifest === null) {
    throw new SlotSceneValidationError({
      ok: false,
      document: null,
      errors: report.errors,
      warnings: [],
    });
  }
  return report.manifest;
}
