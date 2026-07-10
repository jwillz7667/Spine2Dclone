import type { Attachment } from '@marionette/format';
import { readColor } from '../color';
import type { Diagnostics } from '../diagnostics';
import {
  asRecord,
  ptr,
  readBoolean,
  readNumber,
  readNumberArrayField,
  readRequiredString,
  readString,
  type JsonRecord,
} from '../read';
import { deriveWeightedBones, isWeightedStream } from '../vertices';

// Convert a single Spine attachment. The attachment's NAME is the skin's inner key (an attachment has no
// `name` field of its own); it is the default for a missing `path` (Spine looks up the texture region by
// `path` when present, otherwise by the attachment name). Returns undefined when the type is unknown (a
// warning is recorded) so the caller drops it from the skin. Field defaults follow the published Spine
// documentation. Nonessential fields absent from JSON exports (width/height on meshes, editor colors)
// default to 0 / white and never fail the import.
export function convertAttachment(
  attachmentName: string,
  raw: unknown,
  base: string,
  diag: Diagnostics,
): Attachment | undefined {
  const rec = asRecord(raw, base, diag);
  if (rec === undefined) return undefined;
  const type = readString(rec, 'type', base, diag, 'region');
  const regionPath = readString(rec, 'path', base, diag, attachmentName);

  switch (type) {
    case 'region':
      warnSequence(rec, base, diag);
      return {
        type: 'region',
        path: regionPath,
        x: readNumber(rec, 'x', base, diag, 0),
        y: readNumber(rec, 'y', base, diag, 0),
        rotation: readNumber(rec, 'rotation', base, diag, 0),
        scaleX: readNumber(rec, 'scaleX', base, diag, 1),
        scaleY: readNumber(rec, 'scaleY', base, diag, 1),
        width: readNumber(rec, 'width', base, diag, 0),
        height: readNumber(rec, 'height', base, diag, 0),
        color: readColor(rec, 'color', base, diag),
      };

    case 'mesh':
      return convertMesh(rec, regionPath, base, diag);

    case 'linkedmesh': {
      const parent = readRequiredString(rec, 'parent', base, diag);
      if (parent === undefined) return undefined;
      return {
        type: 'linkedmesh',
        path: regionPath,
        parent,
        skin: readString(rec, 'skin', base, diag, 'default'),
        timelines: readBoolean(rec, 'deform', base, diag, true),
        width: readNumber(rec, 'width', base, diag, 0),
        height: readNumber(rec, 'height', base, diag, 0),
        color: readColor(rec, 'color', base, diag),
      };
    }

    case 'boundingbox':
      return convertBoundingBox(rec, base, diag);

    case 'clipping': {
      const end = readRequiredString(rec, 'end', base, diag);
      if (end === undefined) return undefined;
      const vertices = readPolygonVertices(rec, base, diag, 'clipping');
      if (vertices === undefined) return undefined;
      return { type: 'clipping', end, vertices, color: readColor(rec, 'color', base, diag) };
    }

    case 'point':
      return {
        type: 'point',
        x: readNumber(rec, 'x', base, diag, 0),
        y: readNumber(rec, 'y', base, diag, 0),
        rotation: readNumber(rec, 'rotation', base, diag, 0),
      };

    case 'path':
      return convertPath(rec, base, diag);

    default:
      diag.warn(
        'unknown-attachment-type',
        base,
        `attachment type "${type}" is not a documented kind`,
        {
          type,
        },
      );
      return undefined;
  }
}

// The frame-sequence attachment sub-block is outside the published documentation this importer was built
// from, so it is not converted; its presence is surfaced (never silently kept or dropped without note).
function warnSequence(rec: JsonRecord, base: string, diag: Diagnostics): void {
  if (rec['sequence'] !== undefined) {
    diag.warn(
      'sequence-attachment',
      ptr(base, 'sequence'),
      'frame-sequence attachment playback is not converted; the attachment is imported without it',
    );
  }
}

function convertMesh(
  rec: JsonRecord,
  regionPath: string,
  base: string,
  diag: Diagnostics,
): Attachment {
  warnSequence(rec, base, diag);
  const uvs = readNumberArrayField(rec, 'uvs', base, diag);
  const triangles = readNumberArrayField(rec, 'triangles', base, diag);
  const vertices = readNumberArrayField(rec, 'vertices', base, diag);
  const edges =
    rec['edges'] === undefined ? undefined : readNumberArrayField(rec, 'edges', base, diag);
  const vertexCount = uvs.length / 2;
  const weighted = isWeightedStream(vertices, vertexCount);
  return {
    type: 'mesh',
    path: regionPath,
    uvs,
    triangles,
    hullLength: readNumber(rec, 'hull', base, diag, 0),
    width: readNumber(rec, 'width', base, diag, 0),
    height: readNumber(rec, 'height', base, diag, 0),
    color: readColor(rec, 'color', base, diag),
    vertices,
    ...(edges === undefined ? {} : { edges }),
    ...(weighted ? { bones: deriveWeightedBones(vertices) } : {}),
  };
}

// Read a bounding/clipping polygon's vertices. Our format models these as UNWEIGHTED flat [x, y, ...]
// polygons (they carry no `bones` manifest), so a weighted Spine polygon cannot be represented; it is
// surfaced as unsupported and the attachment is dropped rather than emitting wrong geometry.
function readPolygonVertices(
  rec: JsonRecord,
  base: string,
  diag: Diagnostics,
  kind: 'boundingbox' | 'clipping',
): number[] | undefined {
  const vertices = readNumberArrayField(rec, 'vertices', base, diag);
  const vertexCount = readNumber(rec, 'vertexCount', base, diag, vertices.length / 2);
  if (isWeightedStream(vertices, vertexCount)) {
    diag.warn(
      'unknown-attachment-type',
      base,
      `weighted ${kind} polygons are not representable; the attachment is dropped`,
      { kind },
    );
    return undefined;
  }
  return vertices;
}

function convertBoundingBox(
  rec: JsonRecord,
  base: string,
  diag: Diagnostics,
): Attachment | undefined {
  const vertices = readPolygonVertices(rec, base, diag, 'boundingbox');
  if (vertices === undefined) return undefined;
  return { type: 'boundingbox', vertices };
}

function convertPath(rec: JsonRecord, base: string, diag: Diagnostics): Attachment {
  const vertices = readNumberArrayField(rec, 'vertices', base, diag);
  const vertexCount = readNumber(rec, 'vertexCount', base, diag, vertices.length / 2);
  const weighted = isWeightedStream(vertices, vertexCount);
  return {
    type: 'path',
    closed: readBoolean(rec, 'closed', base, diag, false),
    constantSpeed: readBoolean(rec, 'constantSpeed', base, diag, true),
    lengths: readNumberArrayField(rec, 'lengths', base, diag),
    vertices,
    ...(weighted ? { bones: deriveWeightedBones(vertices) } : {}),
  };
}
