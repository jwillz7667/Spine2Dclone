import type { SkeletonDocument } from '../schema/document';
import { checkConstraints } from './constraints';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { checkMeshes } from './mesh';
import { jsonPointer } from './structural';

// Semantic (graph) layer: referential integrity and the invariants Zod cannot express
// (format-contract section 8.4): the BONE, SLOT, SKIN, ATLAS, MESH, CONSTRAINT, DEFORM, EVENT, and
// ANIM families. Stage F1 (ADR-0008) adds the EVENT family (event-def name uniqueness) and extends
// ANIM with the draw-order timeline (consistency of per-key offsets) and the event timeline (event
// reference and non-decreasing order). Each family is independent (collect-all) except the bone
// graph, which short-circuits per section 5.4 so a single broken document yields a single bone code.

// The time-ordering rule for a timeline (format-contract section 4.8): interpolated VALUE timelines and
// the draw-order timeline are STRICT (no two keys share a time, because interpolation or a discrete
// swap between coincident keys is undefined); the event timeline is NON-DECREASING (two events may fire
// at the same time, only a strictly decreasing pair is a fault); the attachment (swap) timeline is
// contract-silent on order, so it is range-checked only (NONE).
type TimeOrder = 'strict' | 'nondecreasing' | 'none';

// Check a list of timeline frames for in-duration range and time order, returning the maximum frame
// time seen (for the duration check). Range applies to every timeline; the order rule is per timeline
// kind (see TimeOrder). An order fault is ANIM_TIME_ORDER at the offending keyframe.
function checkFrameTimes(
  frames: ReadonlyArray<{ readonly time: number }>,
  basePath: ReadonlyArray<string | number>,
  duration: number,
  order: TimeOrder,
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
    if (previous !== null) {
      const outOfOrder =
        (order === 'strict' && time <= previous) || (order === 'nondecreasing' && time < previous);
      if (outOfOrder) {
        const rule = order === 'strict' ? 'strictly ascend' : 'not decrease';
        errors.push(
          formatError(
            'ANIM_TIME_ORDER',
            jsonPointer([...basePath, index, 'time']),
            `keyframe times must ${rule}, ${time} does not follow ${previous}`,
            { time, previous },
          ),
        );
      }
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
          checkFrameTimes(frames, attachmentPath, duration, 'strict', errors),
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

// EVENT family: EventDef names are unique across the document (format-contract sections 4.2, 4.10).
// `events` is an array (not a Record) precisely so this uniqueness fault surfaces as a typed error.
function checkEvents(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const seen = new Set<string>();
  for (const [index, event] of doc.events.entries()) {
    if (seen.has(event.name)) {
      errors.push(
        formatError(
          'EVENT_NAME_DUPLICATE',
          jsonPointer(['events', index, 'name']),
          `event name "${event.name}" is not unique`,
          { name: event.name },
        ),
      );
    } else {
      seen.add(event.name);
    }
  }
  return errors;
}

// Draw-order timeline (ADR-0008 section 3): strict-ascending key times, and per-key offset
// consistency. An unlisted slot cannot be checked here (it is the runtime's fill), but each LISTED
// entry must (a) name an existing slot (ANIM_SLOT_UNKNOWN), (b) appear at most once in the key, (c)
// resolve to a target index (setup index + offset) inside [0, slotCount), and (d) not collide with
// another listed entry's target. Faults (b) to (d) are DRAWORDER_INCOMPLETE: the key does not describe
// a consistent reordering. The full order derivation is a solve concern owned by runtime-core.
function checkDrawOrder(
  doc: SkeletonDocument,
  animName: string,
  drawOrder: SkeletonDocument['animations'][string]['drawOrder'],
  duration: number,
  slotIndexByName: ReadonlyMap<string, number>,
  recordFrames: (frames: ReadonlyArray<{ readonly time: number }>) => void,
  errors: FormatError[],
): number {
  recordFrames(drawOrder);
  const basePath = ['animations', animName, 'drawOrder'];
  const maxTime = checkFrameTimes(drawOrder, basePath, duration, 'strict', errors);
  const slotCount = doc.slots.length;
  for (const [keyIndex, key] of drawOrder.entries()) {
    const seenSlots = new Set<string>();
    const targetIndices = new Set<number>();
    for (const [entryIndex, entry] of key.offsets.entries()) {
      const entryPath = [...basePath, keyIndex, 'offsets', entryIndex];
      const setupIndex = slotIndexByName.get(entry.slot);
      if (setupIndex === undefined) {
        errors.push(
          formatError(
            'ANIM_SLOT_UNKNOWN',
            jsonPointer([...entryPath, 'slot']),
            `animation "${animName}" draw-order key offsets slot "${entry.slot}", which does not exist`,
            { slot: entry.slot, animation: animName },
          ),
        );
        continue;
      }
      if (seenSlots.has(entry.slot)) {
        errors.push(
          formatError(
            'DRAWORDER_INCOMPLETE',
            jsonPointer([...entryPath, 'slot']),
            `slot "${entry.slot}" appears more than once in one draw-order key`,
            { slot: entry.slot },
          ),
        );
        continue;
      }
      seenSlots.add(entry.slot);
      const target = setupIndex + entry.offset;
      if (target < 0 || target >= slotCount) {
        errors.push(
          formatError(
            'DRAWORDER_INCOMPLETE',
            jsonPointer([...entryPath, 'offset']),
            `slot "${entry.slot}" offset ${entry.offset} moves it to index ${target}, outside [0, ${slotCount})`,
            { slot: entry.slot, offset: entry.offset, target, slotCount },
          ),
        );
        continue;
      }
      if (targetIndices.has(target)) {
        errors.push(
          formatError(
            'DRAWORDER_INCOMPLETE',
            jsonPointer([...entryPath, 'offset']),
            `two slots resolve to the same draw-order index ${target} in one key`,
            { slot: entry.slot, target },
          ),
        );
        continue;
      }
      targetIndices.add(target);
    }
  }
  return maxTime;
}

// Event timeline (ADR-0008 section 2): each key references a defined event (ANIM_EVENT_UNKNOWN), key
// times are NON-DECREASING (coincident events legal), and times are in range. Returns the max time.
function checkAnimationEvents(
  animName: string,
  events: SkeletonDocument['animations'][string]['events'],
  duration: number,
  eventNames: ReadonlySet<string>,
  recordFrames: (frames: ReadonlyArray<{ readonly time: number }>) => void,
  errors: FormatError[],
): number {
  recordFrames(events);
  const basePath = ['animations', animName, 'events'];
  for (const [keyIndex, key] of events.entries()) {
    if (!eventNames.has(key.name)) {
      errors.push(
        formatError(
          'ANIM_EVENT_UNKNOWN',
          jsonPointer([...basePath, keyIndex, 'name']),
          `animation "${animName}" fires event "${key.name}", which is not defined on the document`,
          { event: key.name, animation: animName },
        ),
      );
    }
  }
  return checkFrameTimes(events, basePath, duration, 'nondecreasing', errors);
}

// ANIM family: bone/slot/ik/transform/deform timeline keys resolve, frame times strictly ascend and
// stay in range, draw-order keys describe consistent reorderings, event keys reference defined events,
// and duration is at least the maximum keyframe time across all timelines.
function checkAnimations(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneNames = new Set(doc.bones.map((bone) => bone.name));
  const slotNames = new Set(doc.slots.map((slot) => slot.name));
  const slotIndexByName = new Map(doc.slots.map((slot, index) => [slot.name, index]));
  const ikNames = new Set(doc.ikConstraints.map((c) => c.name));
  const transformNames = new Set(doc.transformConstraints.map((c) => c.name));
  const eventNames = new Set(doc.events.map((event) => event.name));
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
            checkFrameTimes(frames, [...basePath, channel], duration, 'strict', errors),
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
            'none',
            errors,
          ),
        );
      }
      if (timelines.color !== undefined) {
        recordFrames(timelines.color);
        maxTime = Math.max(
          maxTime,
          checkFrameTimes(timelines.color, [...basePath, 'color'], duration, 'strict', errors),
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
      maxTime = Math.max(maxTime, checkFrameTimes(frames, basePath, duration, 'strict', errors));
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
      maxTime = Math.max(maxTime, checkFrameTimes(frames, basePath, duration, 'strict', errors));
    }
    maxTime = Math.max(
      maxTime,
      checkDeform(doc, animName, animation.deform, duration, recordFrames, errors),
    );
    maxTime = Math.max(
      maxTime,
      checkDrawOrder(
        doc,
        animName,
        animation.drawOrder,
        duration,
        slotIndexByName,
        recordFrames,
        errors,
      ),
    );
    maxTime = Math.max(
      maxTime,
      checkAnimationEvents(animName, animation.events, duration, eventNames, recordFrames, errors),
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
    ...checkEvents(doc),
    ...checkAnimations(doc),
  ];
}
