import type { PathAttachment } from '../schema/attachment';
import type { Slot } from '../schema/slot';
import type { SkeletonDocument } from '../schema/document';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { jsonPointer } from './structural';
import { checkWeightedVertexStream } from './vertex-stream';

// PATH family (ADR-0011 section 1.3) and the path-constraint referential checks (ADR-0011 section 2). A
// path attachment is a piecewise cubic Bezier spline; its control points use the shared weighted-vertex
// codec (validate/vertex-stream.ts, reusing the MESH_* codes), and its openness plus arc-length table are
// checked here. A path constraint distributes bones along the path carried by a target SLOT; its target,
// bones, and (where statically decidable) target-kind references are checked here. Name uniqueness and the
// dense-order permutation span all three constraint arrays and live in validate/constraints.ts.

// Derive the cubic-spline curve count from the control-point count V and the closed flag (ADR-0011
// geometry). A closed spline of C curves stores V = 3C control points (the last curve wraps to the first
// anchor); an open spline stores V = 3C + 1. A count that fits neither layout has no valid curve count.
function curveCountOf(vertexCount: number, closed: boolean): number | null {
  if (closed) {
    return vertexCount >= 3 && vertexCount % 3 === 0 ? vertexCount / 3 : null;
  }
  return vertexCount >= 4 && (vertexCount - 1) % 3 === 0 ? (vertexCount - 1) / 3 : null;
}

// Resolve a path attachment's logical control-point count V from its vertex stream, emitting the shared
// codec faults. Unweighted: V = vertices.length / 2 (an odd length cannot form control-point pairs,
// MESH_VERTEX_LENGTH). Weighted: V is the decoded logical-vertex count (or null on a decode failure).
function controlPointCount(
  path: PathAttachment,
  basePath: ReadonlyArray<string | number>,
  boneCount: number,
  errors: FormatError[],
): number | null {
  if (path.bones === undefined) {
    if (path.vertices.length % 2 !== 0) {
      errors.push(
        formatError(
          'MESH_VERTEX_LENGTH',
          jsonPointer([...basePath, 'vertices']),
          `unweighted path vertices length ${path.vertices.length} must be even (two components per control point)`,
          { length: path.vertices.length },
        ),
      );
      return null;
    }
    return path.vertices.length / 2;
  }
  return checkWeightedVertexStream(
    path.vertices,
    path.bones,
    jsonPointer([...basePath, 'vertices']),
    jsonPointer([...basePath, 'bones']),
    boneCount,
    errors,
  );
}

// Validate one path attachment: the vertex stream (shared codec), the control-point-count-vs-openness rule,
// and the arc-length table shape (one non-negative non-decreasing entry per curve).
function checkPath(
  path: PathAttachment,
  basePath: ReadonlyArray<string | number>,
  boneCount: number,
  errors: FormatError[],
): void {
  const vertexCount = controlPointCount(path, basePath, boneCount, errors);
  if (vertexCount === null) return; // the stream did not decode; the curve count is undefined.

  const curveCount = curveCountOf(vertexCount, path.closed);
  if (curveCount === null) {
    errors.push(
      formatError(
        'PATH_VERTEX_COUNT',
        jsonPointer([...basePath, 'vertices']),
        `path has ${vertexCount} control points, which is not valid for a ${path.closed ? 'closed' : 'open'} cubic spline`,
        { vertexCount, closed: path.closed },
      ),
    );
    return; // curveCount is undefined, so the lengths checks would be noise.
  }

  if (path.lengths.length !== curveCount) {
    errors.push(
      formatError(
        'PATH_LENGTHS_COUNT',
        jsonPointer([...basePath, 'lengths']),
        `path lengths table has ${path.lengths.length} entries, expected ${curveCount} (one cumulative arc length per curve)`,
        { length: path.lengths.length, expected: curveCount },
      ),
    );
  }

  let previous = 0;
  for (const [index, value] of path.lengths.entries()) {
    if (value < previous) {
      errors.push(
        formatError(
          'PATH_LENGTHS_ORDER',
          jsonPointer([...basePath, 'lengths', index]),
          `path lengths must be a non-negative, non-decreasing cumulative table; ${value} follows ${previous}`,
          { value, previous },
        ),
      );
      break; // one order fault per table is enough to reject it.
    }
    previous = value;
  }
}

// PATH family (ADR-0011 section 1): validate every path attachment across all skins.
export function checkPaths(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneCount = doc.bones.length;
  for (const [skinIndex, skin] of doc.skins.entries()) {
    for (const [slotName, slotAttachments] of Object.entries(skin.attachments)) {
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (attachment.type !== 'path') continue;
        checkPath(
          attachment,
          ['skins', skinIndex, 'attachments', slotName, attachmentName],
          boneCount,
          errors,
        );
      }
    }
  }
  return errors;
}

// CONSTRAINT family (ADR-0011 section 2): path-constraint references. The target must name an existing
// SLOT (PATH_TARGET_MISSING), and where statically decidable (the slot's setup attachment resolves in the
// default skin) that attachment must be a path (PATH_TARGET_NOT_PATH). Every driven bone must resolve
// (PATH_BONE_MISSING); the non-empty rule is structural (PATH_BONES_EMPTY). Name uniqueness and order
// density are checked in validate/constraints.ts across all three constraint arrays.
export function checkPathConstraints(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneNames = new Set(doc.bones.map((bone) => bone.name));
  const slotByName = new Map<string, Slot>(doc.slots.map((slot) => [slot.name, slot]));
  const defaultSkin = doc.skins.find((skin) => skin.name === 'default');

  for (const [index, pc] of doc.pathConstraints.entries()) {
    const targetSlot = slotByName.get(pc.target);
    if (targetSlot === undefined) {
      errors.push(
        formatError(
          'PATH_TARGET_MISSING',
          jsonPointer(['pathConstraints', index, 'target']),
          `path constraint "${pc.name}" targets slot "${pc.target}", which does not exist`,
          { target: pc.target, constraint: pc.name },
        ),
      );
    } else if (targetSlot.attachment !== null && defaultSkin !== undefined) {
      const attachment = defaultSkin.attachments[targetSlot.name]?.[targetSlot.attachment];
      if (attachment !== undefined && attachment.type !== 'path') {
        errors.push(
          formatError(
            'PATH_TARGET_NOT_PATH',
            jsonPointer(['pathConstraints', index, 'target']),
            `path constraint "${pc.name}" targets slot "${pc.target}", whose setup attachment "${targetSlot.attachment}" is a ${attachment.type}, not a path`,
            { target: pc.target, type: attachment.type, constraint: pc.name },
          ),
        );
      }
    }

    for (const [boneIdx, boneName] of pc.bones.entries()) {
      if (!boneNames.has(boneName)) {
        errors.push(
          formatError(
            'PATH_BONE_MISSING',
            jsonPointer(['pathConstraints', index, 'bones', boneIdx]),
            `path constraint "${pc.name}" drives bone "${boneName}", which does not exist`,
            { bone: boneName, constraint: pc.name },
          ),
        );
      }
    }
  }
  return errors;
}
