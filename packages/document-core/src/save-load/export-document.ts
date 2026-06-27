import { computeContentHash, CURRENT_FORMAT_VERSION, validateDocument } from '@marionette/format';
import type { Bone, SkeletonDocument } from '@marionette/format/types';
import { ExportValidationError } from '../command/errors';
import type { DocumentReadModel } from '../model/read-model';

// Project the internal model to the format (command-history Section 7.1): resolve BoneId references to
// bone names, emit boneOrder as the ordered bones[], stamp CURRENT_FORMAT_VERSION, carry the preserved
// non-bone body, then set `hash` LAST via computeContentHash from packages/format (hash ownership
// lives there, never duplicated here). Finally run validateDocument on its own output, so the
// bone-ordering invariant and name uniqueness (the export-only D9 contract) are enforced here; an
// invalid projection throws ExportValidationError (LAW 3: fail loudly), never ships silently.
export function exportDocument(model: DocumentReadModel): SkeletonDocument {
  const orderedBones = model.bones(); // in boneOrder
  const idToName = new Map<string, string>();
  for (const bone of orderedBones) idToName.set(bone.id, bone.name);

  const bones: Bone[] = orderedBones.map((bone) => ({
    name: bone.name,
    parent: bone.parent === null ? null : (idToName.get(bone.parent) ?? null),
    length: bone.length,
    x: bone.x,
    y: bone.y,
    rotation: bone.rotation,
    scaleX: bone.scaleX,
    scaleY: bone.scaleY,
    shearX: bone.shearX,
    shearY: bone.shearY,
    transformMode: bone.transformMode,
  }));

  const preserved = model.preserved();
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: model.name,
    hash: '',
    bones,
    slots: [...preserved.slots],
    skins: [...preserved.skins],
    animations: { ...preserved.animations },
    atlas: preserved.atlas,
  };
  const withHash: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

  const report = validateDocument(withHash, { verifyHash: true });
  if (!report.ok || report.document === null) {
    throw new ExportValidationError(report);
  }
  return report.document;
}
