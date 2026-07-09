import type { Attachment, MeshAttachment } from '../schema/attachment';
import type { SkeletonDocument } from '../schema/document';
import { MAX_BONE_INFLUENCES, WEIGHT_SUM_EPSILON } from '../mesh/weighted';
import { formatError } from './errors';
import type { FormatError } from './errors';
import { jsonPointer } from './structural';

// MESH family (format-contract section 6, ADR-0002). Validates every mesh attachment's topology and
// vertex encoding on import. The codec (mesh/weighted.ts) assumes validated input; THIS is the
// boundary that earns that assumption, so it walks the weighted stream defensively and emits typed
// errors instead of throwing. Phase 2 first authors meshes; the codes are pre-reserved in errors.ts.

// Defensive walk of one mesh attachment. `basePath` addresses the attachment node; `boneCount` is the
// document's bone count (for global boneIndex range checks). Collects all faults it can reach without
// losing stream alignment; a boneCount it cannot trust stops the weighted walk (further bytes are
// unaligned), which is itself reported.
function checkMesh(
  mesh: MeshAttachment,
  basePath: ReadonlyArray<string | number>,
  boneCount: number,
  errors: FormatError[],
): void {
  if (mesh.uvs.length % 2 !== 0) {
    errors.push(
      formatError(
        'MESH_UV_LENGTH',
        jsonPointer([...basePath, 'uvs']),
        `mesh uvs length ${mesh.uvs.length} must be even (two components per vertex)`,
        { length: mesh.uvs.length },
      ),
    );
    return; // V is undefined with an odd uv length; downstream length checks would be noise.
  }
  const vertexCount = mesh.uvs.length / 2;

  if (mesh.triangles.length % 3 !== 0) {
    errors.push(
      formatError(
        'MESH_TRIANGLE_LENGTH',
        jsonPointer([...basePath, 'triangles']),
        `mesh triangles length ${mesh.triangles.length} must be a multiple of 3`,
        { length: mesh.triangles.length },
      ),
    );
  }
  for (const [index, vi] of mesh.triangles.entries()) {
    if (!Number.isInteger(vi) || vi < 0 || vi >= vertexCount) {
      errors.push(
        formatError(
          'MESH_TRIANGLE_INDEX_RANGE',
          jsonPointer([...basePath, 'triangles', index]),
          `mesh triangle index ${vi} is out of range [0, ${vertexCount})`,
          { index: vi, vertexCount },
        ),
      );
    }
  }

  if (!Number.isInteger(mesh.hullLength) || mesh.hullLength < 0 || mesh.hullLength > vertexCount) {
    errors.push(
      formatError(
        'MESH_HULL_RANGE',
        jsonPointer([...basePath, 'hullLength']),
        `mesh hullLength ${mesh.hullLength} must be an integer in [0, ${vertexCount}]`,
        { hullLength: mesh.hullLength, vertexCount },
      ),
    );
  }

  if (mesh.edges !== undefined) {
    if (mesh.edges.length % 2 !== 0) {
      errors.push(
        formatError(
          'MESH_EDGE_INVALID',
          jsonPointer([...basePath, 'edges']),
          `mesh edges length ${mesh.edges.length} must be even (vertex-index pairs)`,
          { length: mesh.edges.length },
        ),
      );
    }
    for (const [index, vi] of mesh.edges.entries()) {
      if (!Number.isInteger(vi) || vi < 0 || vi >= vertexCount) {
        errors.push(
          formatError(
            'MESH_EDGE_INVALID',
            jsonPointer([...basePath, 'edges', index]),
            `mesh edge index ${vi} is out of range [0, ${vertexCount})`,
            { index: vi, vertexCount },
          ),
        );
      }
    }
  }

  if (mesh.bones === undefined) {
    checkUnweighted(mesh, basePath, vertexCount, errors);
  } else {
    checkWeighted(mesh, basePath, vertexCount, boneCount, errors);
  }
}

// Unweighted: vertices is a flat [x,y,...] of exactly 2 * V numbers (format-contract section 6.1).
function checkUnweighted(
  mesh: MeshAttachment,
  basePath: ReadonlyArray<string | number>,
  vertexCount: number,
  errors: FormatError[],
): void {
  if (mesh.vertices.length !== 2 * vertexCount) {
    errors.push(
      formatError(
        'MESH_VERTEX_LENGTH',
        jsonPointer([...basePath, 'vertices']),
        `unweighted mesh vertices length ${mesh.vertices.length} must equal 2 * V (${2 * vertexCount})`,
        { length: mesh.vertices.length, expected: 2 * vertexCount },
      ),
    );
  }
}

// Weighted: walk the self-delimiting stream, checking influence cap, bone range, weight sum, exact
// consumption to V logical vertices, and the `bones` manifest equality (format-contract section 6.2,
// 6.3). An untrustworthy boneCount stops the walk (downstream bytes are unaligned) as MESH_WEIGHT_DECODE.
function checkWeighted(
  mesh: MeshAttachment,
  basePath: ReadonlyArray<string | number>,
  vertexCount: number,
  boneCount: number,
  errors: FormatError[],
): void {
  const manifest = mesh.bones ?? [];
  const stream = mesh.vertices;
  const verticesPath = jsonPointer([...basePath, 'vertices']);
  const referenced = new Set<number>();
  let cursor = 0;
  let logicalVertices = 0;
  let decodeFailed = false;

  while (cursor < stream.length) {
    const influenceCount = stream[cursor];
    cursor += 1;
    if (influenceCount === undefined || !Number.isInteger(influenceCount) || influenceCount < 1) {
      errors.push(
        formatError(
          'MESH_WEIGHT_DECODE',
          verticesPath,
          `weighted mesh has an invalid influence count ${influenceCount ?? 'undefined'} at stream index ${cursor - 1}`,
          { index: cursor - 1 },
        ),
      );
      decodeFailed = true;
      break;
    }
    if (influenceCount > MAX_BONE_INFLUENCES) {
      errors.push(
        formatError(
          'MESH_WEIGHT_INFLUENCE_CAP',
          verticesPath,
          `weighted vertex ${logicalVertices} has ${influenceCount} influences, exceeding the cap of ${MAX_BONE_INFLUENCES}`,
          { vertex: logicalVertices, influences: influenceCount, cap: MAX_BONE_INFLUENCES },
        ),
      );
    }
    let weightSum = 0;
    for (let i = 0; i < influenceCount; i += 1) {
      const boneIndex = stream[cursor];
      const weight = stream[cursor + 3];
      if (boneIndex === undefined || stream[cursor + 1] === undefined || weight === undefined) {
        errors.push(
          formatError('MESH_WEIGHT_DECODE', verticesPath, 'weighted mesh stream is truncated', {
            index: cursor,
          }),
        );
        decodeFailed = true;
        break;
      }
      if (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= boneCount) {
        errors.push(
          formatError(
            'MESH_WEIGHT_BONE_RANGE',
            verticesPath,
            `weighted vertex ${logicalVertices} references bone index ${boneIndex}, out of range [0, ${boneCount})`,
            { vertex: logicalVertices, boneIndex, boneCount },
          ),
        );
      } else {
        referenced.add(boneIndex);
      }
      weightSum += weight;
      cursor += 4;
    }
    if (decodeFailed) break;
    if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
      errors.push(
        formatError(
          'MESH_WEIGHT_SUM',
          verticesPath,
          `weighted vertex ${logicalVertices} weights sum to ${weightSum}, not 1 (epsilon ${WEIGHT_SUM_EPSILON})`,
          { vertex: logicalVertices, sum: weightSum },
        ),
      );
    }
    logicalVertices += 1;
  }

  if (decodeFailed) return;

  if (logicalVertices !== vertexCount || cursor !== stream.length) {
    errors.push(
      formatError(
        'MESH_WEIGHT_DECODE',
        verticesPath,
        `weighted mesh decoded ${logicalVertices} vertices consuming ${cursor} of ${stream.length} numbers; expected ${vertexCount} vertices consuming all`,
        { decodedVertices: logicalVertices, expectedVertices: vertexCount, consumed: cursor },
      ),
    );
    return;
  }

  const manifestSet = new Set(manifest);
  const ascendingUnique =
    manifest.length === manifestSet.size &&
    manifest.every((v, i) => i === 0 || v > manifest[i - 1]!);
  const sameMembers =
    manifestSet.size === referenced.size && [...referenced].every((v) => manifestSet.has(v));
  if (!ascendingUnique || !sameMembers) {
    errors.push(
      formatError(
        'MESH_WEIGHT_BONES_MANIFEST',
        jsonPointer([...basePath, 'bones']),
        'weighted mesh `bones` manifest must be the ascending, de-duplicated set of referenced bone indices',
        {
          manifest: manifest.join(','),
          referenced: [...referenced].sort((a, b) => a - b).join(','),
        },
      ),
    );
  }
}

// Validate every mesh attachment across all skins.
export function checkMeshes(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  const boneCount = doc.bones.length;
  for (const [skinIndex, skin] of doc.skins.entries()) {
    for (const [slotName, slotAttachments] of Object.entries(skin.attachments)) {
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (attachment.type !== 'mesh') continue;
        checkMesh(
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

// Look up an attachment by (skin name, slot name, attachment name), or undefined when any level is
// absent. Pure, no `as`: the skin/slot/attachment maps are typed records.
function attachmentAt(
  doc: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): Attachment | undefined {
  const skin = doc.skins.find((candidate) => candidate.name === skinName);
  return skin?.attachments[slotName]?.[attachmentName];
}

// The outcome of resolving a linked-mesh chain to its geometry source (ADR-0009 section 2). A linked
// mesh reuses a parent mesh's geometry; the parent lives on the SAME slot in skin `skin ?? this skin`
// and may itself be a linked mesh, so resolution walks the chain until it reaches a real `mesh`.
export type GeometrySource =
  | { readonly kind: 'mesh'; readonly mesh: MeshAttachment }
  | { readonly kind: 'missing' } // a link points at an attachment that does not exist
  | { readonly kind: 'invalid' } // a link points at a non-geometry attachment (not mesh or linked mesh)
  | { readonly kind: 'cycle' }; // the chain revisits a node and never reaches a real mesh

// Follow the parent chain of the attachment at (skinName, slotName, attachmentName) to its root mesh.
// The slot is constant along the chain; each linked-mesh hop may change the skin via its `skin` field.
// Bounded by the visited set (revisiting a node is a cycle). Shared by the linked-mesh validator and the
// deform vertex-count resolution (a linked mesh may be a deform target, inheriting the root mesh's V).
export function resolveGeometrySource(
  doc: SkeletonDocument,
  skinName: string,
  slotName: string,
  attachmentName: string,
): GeometrySource {
  const visited = new Set<string>();
  let currentSkin = skinName;
  let currentName = attachmentName;
  for (;;) {
    const key = `${currentSkin} ${currentName}`;
    if (visited.has(key)) return { kind: 'cycle' };
    visited.add(key);
    const attachment = attachmentAt(doc, currentSkin, slotName, currentName);
    if (attachment === undefined) return { kind: 'missing' };
    if (attachment.type === 'mesh') return { kind: 'mesh', mesh: attachment };
    if (attachment.type !== 'linkedmesh') return { kind: 'invalid' };
    currentSkin = attachment.skin ?? currentSkin;
    currentName = attachment.parent;
  }
}

// MESH family (ADR-0009 section 2): every linked-mesh attachment resolves to a real mesh through a
// cycle-free parent chain. Reported per code so a reviewer sees whether the parent is missing, is a
// non-geometry attachment, or the chain loops. The starting attachment always exists (we iterate the
// linked meshes themselves), so `missing`/`invalid`/`cycle` describe the PARENT side of the link.
export function checkLinkedMeshes(doc: SkeletonDocument): FormatError[] {
  const errors: FormatError[] = [];
  for (const [skinIndex, skin] of doc.skins.entries()) {
    for (const [slotName, slotAttachments] of Object.entries(skin.attachments)) {
      for (const [attachmentName, attachment] of Object.entries(slotAttachments)) {
        if (attachment.type !== 'linkedmesh') continue;
        const parentPath = jsonPointer([
          'skins',
          skinIndex,
          'attachments',
          slotName,
          attachmentName,
          'parent',
        ]);
        const source = resolveGeometrySource(doc, skin.name, slotName, attachmentName);
        if (source.kind === 'missing') {
          errors.push(
            formatError(
              'LINKED_MESH_PARENT_MISSING',
              parentPath,
              `linked mesh "${attachmentName}" references parent "${attachment.parent}" in skin "${attachment.skin ?? skin.name}" on slot "${slotName}", which does not exist`,
              { parent: attachment.parent, skin: attachment.skin ?? skin.name, slot: slotName },
            ),
          );
        } else if (source.kind === 'invalid') {
          errors.push(
            formatError(
              'LINKED_MESH_PARENT_INVALID',
              parentPath,
              `linked mesh "${attachmentName}" references parent "${attachment.parent}", which is not a mesh or linked mesh`,
              { parent: attachment.parent },
            ),
          );
        } else if (source.kind === 'cycle') {
          errors.push(
            formatError(
              'LINKED_MESH_CYCLE',
              parentPath,
              `linked mesh "${attachmentName}" parent chain is cyclic and never reaches a mesh`,
              { parent: attachment.parent },
            ),
          );
        }
      }
    }
  }
  return errors;
}
