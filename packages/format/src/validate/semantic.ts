import type { SkeletonDocument } from '../schema/document';
import { checkConstraints } from './constraints';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { checkMeshes } from './mesh';
import { jsonPointer } from './structural';

// Semantic (graph) layer: referential integrity and the invariants Zod cannot express
// (format-contract section 8.4), Phase-0 subset (phase-0-foundations.md WP-0.3): the BONE, SLOT,
// SKIN, and ATLAS families plus the simple animation timeline-key resolution and time ordering for
// the idle fixture. The mesh, constraint, and full animation/deform/event families land with their
// validators in later phases (LAW 5). Each family is independent (collect-all) except the bone
// graph, which short-circuits per section 5.4 so a single broken document yields a single bone code.

// Check a list of timeline frames for in-duration range and (for value timelines) strict-ascending
// time order, returning the maximum frame time seen (for the duration check). Range applies to every
// timeline (format-contract section 4.8); strict order applies to the interpolated VALUE timelines
// the contract enumerates as strict (bone rotate/translate/scale/shear, slot color). The attachment
// (swap) timeline is contract-silent on order, so it passes strictOrder=false and is range-checked
// only, to avoid rejecting a document the contract permits.
function checkFrameTimes(
  frames: ReadonlyArray<{ readonly time: number }>,
  basePath: ReadonlyArray<string | number>,
  duration: number,
  strictOrder: boolean,
  errors: FormatError[],
): number {
  let maxTime = 0;
  let previous: number | null = null;
  for (const [index, frame] of frames.entries()) {
    const time = frame.time;
    if (time > maxTime) maxTime = time;
    if (time < 0 || time > duration) {
      errors.push(
        formatError(
          'ANIM_TIME_RANGE',
          jsonPointer([...basePath, index, 'time']),
          `keyframe time ${time} is outside the animation range [0, ${duration}]`,
          { time, duration },
        ),
      );
    }
    if (strictOrder && previous !== null && time <= previous) {
      errors.push(
        formatError(
          'ANIM_TIME_ORDER',
          jsonPointer([...basePath, index, 'time']),
          `keyframe times must strictly ascend, ${time} does not follow ${previous}`,
          { time, previous },
        ),
      );
    }
    previous = time;
  }
  return maxTime;
}

// BONE family (format-contract section 5.4): names unique, then parents resolve, then parents
// precede children. Short-circuits at the first failing step so only one bone code is emitted.
function checkBones(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const indexByName = new Map<string, number>();
  for (const [index, bone] of doc.bones.entries()) {
    if (indexByName.has(bone.name)) {
      errors.push(
        formatError(
          'BONE_NAME_DUPLICATE',
          jsonPointer(['bones', index, 'name']),
          `bone name "${bone.name}" is not unique`,
          { name: bone.name },
        ),
      );
    } else {
      indexByName.set(bone.name, index);
    }
  }
  if (errors.length > 0) return errors;

  for (const [index, bone] of doc.bones.entries()) {
    if (bone.parent !== null && !indexByName.has(bone.parent)) {
      errors.push(
        formatError(
          'BONE_PARENT_MISSING',
          jsonPointer(['bones', index, 'parent']),
          `bone "${bone.name}" names parent "${bone.parent}", which does not exist`,
          { parent: bone.parent },
        ),
      );
    }
  }
  if (errors.length > 0) return errors;

  for (const [index, bone] of doc.bones.entries()) {
    if (bone.parent === null) continue;
    const parentIndex = indexByName.get(bone.parent);
    if (parentIndex === undefined || parentIndex >= index) {
      errors.push(
        formatError(
          'BONE_ORDER_VIOLATION',
          jsonPointer(['bones', index, 'parent']),
          `bone "${bone.name}" must appear after its parent "${bone.parent}" (parents precede children)`,
          { parent: bone.parent },
        ),
      );
    }
  }
  return errors;
}

// SLOT family: names unique, bone resolves, setup attachment resolves in the default skin. The
// attachment check only runs when a default skin exists, so a missing default skin surfaces solely
// as the SKIN family code, not as a cascade of SLOT_ATTACHMENT_MISSING.
function checkSlots(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneNames = new Set(doc.bones.map((bone) => bone.name));
  const defaultSkin = doc.skins.find((skin) => skin.name === 'default');
  const seen = new Set<string>();
  for (const [index, slot] of doc.slots.entries()) {
    if (seen.has(slot.name)) {
      errors.push(
        formatError(
          'SLOT_NAME_DUPLICATE',
          jsonPointer(['slots', index, 'name']),
          `slot name "${slot.name}" is not unique`,
          { name: slot.name },
        ),
      );
    } else {
      seen.add(slot.name);
    }
    if (!boneNames.has(slot.bone)) {
      errors.push(
        formatError(
          'SLOT_BONE_MISSING',
          jsonPointer(['slots', index, 'bone']),
          `slot "${slot.name}" rides on bone "${slot.bone}", which does not exist`,
          { bone: slot.bone },
        ),
      );
    }
    if (slot.attachment !== null && defaultSkin !== undefined) {
      const slotAttachments = defaultSkin.attachments[slot.name];
      if (slotAttachments === undefined || !(slot.attachment in slotAttachments)) {
        errors.push(
          formatError(
            'SLOT_ATTACHMENT_MISSING',
            jsonPointer(['slots', index, 'attachment']),
            `slot "${slot.name}" sets attachment "${slot.attachment}", which the default skin does not define`,
            { attachment: slot.attachment, slot: slot.name },
          ),
        );
      }
    }
  }
  return errors;
}

// SKIN family: the default skin must exist; every top-level attachment key is a valid slot name.
function checkSkins(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  if (!doc.skins.some((skin) => skin.name === 'default')) {
    errors.push(
      formatError(
        'SKIN_DEFAULT_MISSING',
        jsonPointer(['skins']),
        'the document must contain a skin named "default"',
      ),
    );
  }
  const slotNames = new Set(doc.slots.map((slot) => slot.name));
  for (const [index, skin] of doc.skins.entries()) {
    for (const slotName of Object.keys(skin.attachments)) {
      if (!slotNames.has(slotName)) {
        errors.push(
          formatError(
            'SKIN_SLOT_UNKNOWN',
            jsonPointer(['skins', index, 'attachments', slotName]),
            `skin "${skin.name}" carries attachments for slot "${slotName}", which does not exist`,
            { slot: slotName, skin: skin.name },
          ),
        );
      }
    }
  }
  return errors;
}

// ATLAS family: region names unique across all pages; every region/mesh attachment path resolves.
function checkAtlas(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const regionNames = new Set<string>();
  for (const [pageIndex, page] of doc.atlas.pages.entries()) {
    for (const [regionIndex, region] of page.regions.entries()) {
      if (regionNames.has(region.name)) {
        errors.push(
          formatError(
            'ATLAS_REGION_DUPLICATE',
            jsonPointer(['atlas', 'pages', pageIndex, 'regions', regionIndex, 'name']),
            `atlas region name "${region.name}" is not unique across pages`,
            { name: region.name },
          ),
        );
      } else {
        regionNames.add(region.name);
      }
    }
  }
  for (const [skinIndex, skin] of doc.skins.entries()) {
    for (const [slotName, slotAttachments] of Object.entries(skin.attachments)) {
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (
          (attachment.type === 'region' || attachment.type === 'mesh') &&
          !regionNames.has(attachment.path)
        ) {
          errors.push(
            formatError(
              'ATTACHMENT_REGION_MISSING',
              jsonPointer(['skins', skinIndex, 'attachments', slotName, attachmentName, 'path']),
              `attachment "${attachmentName}" references atlas region "${attachment.path}", which does not exist`,
              { path: attachment.path },
            ),
          );
        }
      }
    }
  }
  return errors;
}

// Resolve the mesh logical-vertex count (uvs.length / 2) for a deform attachment, or null when the
// attachment does not exist or is not a mesh (the caller emits DEFORM_ATTACHMENT_UNKNOWN /
// DEFORM_NOT_MESH). Deform offsets must be exactly 2 * V per keyframe (format-contract section 4.9).
function meshVertexCount(
  doc: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): number | null {
  const skin = doc.skins.find((s) => s.name === skinName);
  const attachment = skin?.attachments[slotName]?.[attachmentName];
  if (attachment === undefined || attachment.type !== 'mesh') return null;
  return attachment.uvs.length / 2;
}

// DEFORM family (format-contract section 4.9): every skin/slot/attachment key resolves, the attachment
// is a mesh, each keyframe's offsets are 2 * V long, and frame times ascend in range.
function checkDeform(
  doc: SkeletonDocument,
  animName: string,
  deform: SkeletonDocument['animations'][string]['deform'],
  duration: number,
  recordFrames: (frames: ReadonlyArray<{ readonly time: number }>) => void,
  errors: FormatError[],
): number {
  let maxTime = 0;
  const slotNames = new Set(doc.slots.map((slot) => slot.name));
  for (const [skinName, bySlot] of Object.entries(deform)) {
    const skinExists = doc.skins.some((s) => s.name === skinName);
    const skinPath = ['animations', animName, 'deform', skinName];
    if (!skinExists) {
      errors.push(
        formatError(
          'DEFORM_SKIN_UNKNOWN',
          jsonPointer(skinPath),
          `animation "${animName}" deforms skin "${skinName}", which does not exist`,
          { skin: skinName, animation: animName },
        ),
      );
    }
    for (const [slotName, byAttachment] of Object.entries(bySlot)) {
      const slotPath = [...skinPath, slotName];
      if (!slotNames.has(slotName)) {
        errors.push(
          formatError(
            'DEFORM_SLOT_UNKNOWN',
            jsonPointer(slotPath),
            `animation "${animName}" deforms slot "${slotName}", which does not exist`,
            { slot: slotName, animation: animName },
          ),
        );
      }
      for (const [attachmentName, frames] of Object.entries(byAttachment)) {
        const attachmentPath = [...slotPath, attachmentName];
        const vertexCount = skinExists
          ? meshVertexCount(doc, skinName, slotName, attachmentName)
          : null;
        const skin = doc.skins.find((s) => s.name === skinName);
        const attachment = skin?.attachments[slotName]?.[attachmentName];
        if (skinExists && attachment === undefined) {
          errors.push(
            formatError(
              'DEFORM_ATTACHMENT_UNKNOWN',
              jsonPointer(attachmentPath),
              `animation "${animName}" deforms attachment "${attachmentName}", which the skin does not define on that slot`,
              { attachment: attachmentName, animation: animName },
            ),
          );
        } else if (skinExists && attachment !== undefined && attachment.type !== 'mesh') {
          errors.push(
            formatError(
              'DEFORM_NOT_MESH',
              jsonPointer(attachmentPath),
              `animation "${animName}" deforms attachment "${attachmentName}", which is a ${attachment.type}, not a mesh`,
              { attachment: attachmentName, type: attachment.type },
            ),
          );
        }
        recordFrames(frames);
        maxTime = Math.max(
          maxTime,
          checkFrameTimes(frames, attachmentPath, duration, true, errors),
        );
        if (vertexCount !== null) {
          for (const [frameIndex, frame] of frames.entries()) {
            if (frame.value.offsets.length !== 2 * vertexCount) {
              errors.push(
                formatError(
                  'DEFORM_OFFSET_LENGTH',
                  jsonPointer([...attachmentPath, frameIndex, 'value', 'offsets']),
                  `deform offsets length ${frame.value.offsets.length} must equal 2 * V (${2 * vertexCount})`,
                  { length: frame.value.offsets.length, expected: 2 * vertexCount },
                ),
              );
            }
          }
        }
      }
    }
  }
  return maxTime;
}

// ANIM family: bone/slot/ik/transform/deform timeline keys resolve, frame times strictly ascend and
// stay in range, and duration is at least the maximum keyframe time across all timelines.
function checkAnimations(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneNames = new Set(doc.bones.map((bone) => bone.name));
  const slotNames = new Set(doc.slots.map((slot) => slot.name));
  const ikNames = new Set(doc.ikConstraints.map((c) => c.name));
  const transformNames = new Set(doc.transformConstraints.map((c) => c.name));
  for (const [animName, animation] of Object.entries(doc.animations)) {
    const duration = animation.duration;
    let maxTime = 0;
    let hasKeyframes = false;
    const recordFrames = (frames: ReadonlyArray<{ readonly time: number }>): void => {
      if (frames.length > 0) hasKeyframes = true;
    };
    for (const [boneName, timelines] of Object.entries(animation.bones)) {
      const basePath = ['animations', animName, 'bones', boneName];
      if (!boneNames.has(boneName)) {
        errors.push(
          formatError(
            'ANIM_BONE_UNKNOWN',
            jsonPointer(basePath),
            `animation "${animName}" keys a timeline on bone "${boneName}", which does not exist`,
            { bone: boneName, animation: animName },
          ),
        );
      }
      for (const channel of ['rotate', 'translate', 'scale', 'shear'] as const) {
        const frames = timelines[channel];
        if (frames !== undefined) {
          recordFrames(frames);
          maxTime = Math.max(
            maxTime,
            checkFrameTimes(frames, [...basePath, channel], duration, true, errors),
          );
        }
      }
    }
    for (const [slotName, timelines] of Object.entries(animation.slots)) {
      const basePath = ['animations', animName, 'slots', slotName];
      if (!slotNames.has(slotName)) {
        errors.push(
          formatError(
            'ANIM_SLOT_UNKNOWN',
            jsonPointer(basePath),
            `animation "${animName}" keys a timeline on slot "${slotName}", which does not exist`,
            { slot: slotName, animation: animName },
          ),
        );
      }
      if (timelines.attachment !== undefined) {
        recordFrames(timelines.attachment);
        maxTime = Math.max(
          maxTime,
          checkFrameTimes(
            timelines.attachment,
            [...basePath, 'attachment'],
            duration,
            false,
            errors,
          ),
        );
      }
      if (timelines.color !== undefined) {
        recordFrames(timelines.color);
        maxTime = Math.max(
          maxTime,
          checkFrameTimes(timelines.color, [...basePath, 'color'], duration, true, errors),
        );
      }
    }
    for (const [constraintName, frames] of Object.entries(animation.ik)) {
      const basePath = ['animations', animName, 'ik', constraintName];
      if (!ikNames.has(constraintName)) {
        errors.push(
          formatError(
            'ANIM_IK_UNKNOWN',
            jsonPointer(basePath),
            `animation "${animName}" keys an ik timeline on constraint "${constraintName}", which does not exist`,
            { constraint: constraintName, animation: animName },
          ),
        );
      }
      recordFrames(frames);
      maxTime = Math.max(maxTime, checkFrameTimes(frames, basePath, duration, true, errors));
    }
    for (const [constraintName, frames] of Object.entries(animation.transform)) {
      const basePath = ['animations', animName, 'transform', constraintName];
      if (!transformNames.has(constraintName)) {
        errors.push(
          formatError(
            'ANIM_TRANSFORM_UNKNOWN',
            jsonPointer(basePath),
            `animation "${animName}" keys a transform timeline on constraint "${constraintName}", which does not exist`,
            { constraint: constraintName, animation: animName },
          ),
        );
      }
      recordFrames(frames);
      maxTime = Math.max(maxTime, checkFrameTimes(frames, basePath, duration, true, errors));
    }
    maxTime = Math.max(
      maxTime,
      checkDeform(doc, animName, animation.deform, duration, recordFrames, errors),
    );

    // ANIM_DURATION (format-contract section 4.8): duration must be >= the maximum keyframe time and
    // strictly positive when the animation has any keyframes. Both faults are one code in one family.
    const tooShort = duration < maxTime;
    const nonPositive = hasKeyframes && duration <= 0;
    if (tooShort || nonPositive) {
      const reason = tooShort
        ? `is below its maximum keyframe time ${maxTime}`
        : 'must be greater than zero when the animation has keyframes';
      errors.push(
        formatError(
          'ANIM_DURATION',
          jsonPointer(['animations', animName, 'duration']),
          `animation "${animName}" duration ${duration} ${reason}`,
          { duration, maxKeyframeTime: maxTime },
        ),
      );
    }
  }
  return errors;
}

// Run every semantic family over a structurally valid document and collect all errors. Phase 2
// (ADR-0004) adds the MESH and CONSTRAINT families and extends ANIM with ik/transform/deform.
export function validateSemantic(doc: SkeletonDocument): FormatError[] {
  return [
    ...checkBones(doc),
    ...checkSlots(doc),
    ...checkSkins(doc),
    ...checkAtlas(doc),
    ...checkMeshes(doc),
    ...checkConstraints(doc),
    ...checkAnimations(doc),
  ];
}
