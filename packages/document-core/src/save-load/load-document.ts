import { parseDocument } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { DocumentInvariantError } from '../command/errors';
import type { BoneEntity, DocState } from '../model/doc-state';
import type { BoneId, IdFactory } from '../model/ids';
import { buildLoadedDocument, type Document } from './document';
import type { DocumentEnvironment } from './environment';

// Resolve a validated format document into internal DocState: mint a BoneId per bone (in format
// order), resolve parent NAME references to BoneIds, and carry the non-bone body verbatim. The format
// validator already guaranteed unique bone names and parent-before-child ordering, so name resolution
// is total and the boneOrder invariant holds.
function resolveParentId(
  parent: string | null,
  nameToId: ReadonlyMap<string, BoneId>,
): BoneId | null {
  if (parent === null) return null;
  const id = nameToId.get(parent);
  if (id === undefined) {
    // Unreachable for a validated document (the format validator rejects an unresolved parent), but
    // fail fast rather than silently nulling a dangling reference (symmetry with export).
    throw new DocumentInvariantError(`bone references parent "${parent}", which does not exist`);
  }
  return id;
}

function formatToDocState(document: SkeletonDocument, ids: IdFactory): DocState {
  const nameToId = new Map<string, BoneId>();
  const boneOrder: BoneId[] = [];
  for (const bone of document.bones) {
    const id = ids.mint('bone');
    nameToId.set(bone.name, id);
    boneOrder.push(id);
  }
  const bones = new Map<BoneId, BoneEntity>();
  document.bones.forEach((bone, index) => {
    const id = boneOrder[index]!;
    const parent = resolveParentId(bone.parent, nameToId);
    bones.set(id, {
      id,
      name: bone.name,
      parent,
      length: bone.length,
      x: bone.x,
      y: bone.y,
      rotation: bone.rotation,
      scaleX: bone.scaleX,
      scaleY: bone.scaleY,
      shearX: bone.shearX,
      shearY: bone.shearY,
      transformMode: bone.transformMode,
    });
  });
  return {
    formatVersion: document.formatVersion,
    name: document.name,
    bones,
    boneOrder,
    preserved: {
      slots: document.slots,
      skins: document.skins,
      animations: document.animations,
      atlas: document.atlas,
    },
  };
}

// Load a document from format JSON (command-history Section 7.2). Validates at the boundary via
// packages/format and throws a typed FormatValidationError on malformed input, constructing NO
// Document (LAW 3: fail loudly, do not partially mutate). Runtimes treat the hash as opaque, so
// verifyHash is false; the editor verifies it explicitly on its own load path. Load is NOT a command
// and is NOT undoable: it returns a fresh Document with empty history.
export function loadDocument(json: unknown, env: DocumentEnvironment): Document {
  const document = parseDocument(json, { verifyHash: false });
  const ids = env.createIds();
  const state = formatToDocState(document, ids);
  return buildLoadedDocument(state, ids, env);
}
