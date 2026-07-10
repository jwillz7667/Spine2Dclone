import {
  computeContentHash,
  CURRENT_FORMAT_VERSION,
  type Bone,
  type IkConstraint,
  type PathConstraint,
  type Slot,
  type SkeletonDocument,
  type SkeletonMeta,
  type Skin,
  type TransformConstraint,
} from '@marionette/format';
import type { Diagnostics } from '../diagnostics';
import {
  asArray,
  asRecord,
  isRecord,
  readOptionalNumber,
  readOptionalString,
  type JsonRecord,
} from '../read';
import { isSupportedVersion } from '../version';
import { DEFAULT_SKELETON_NAME, type SpineImportOptions } from '../types';
import { convertBones } from './bones';
import { convertSlots } from './slots';
import { convertSkins } from './skins';
import {
  convertIkConstraints,
  convertPathConstraints,
  convertTransformConstraints,
  warnPhysicsConstraints,
} from './constraints';
import { convertEvents } from './event-defs';
import { convertAnimations, type AnimationContext } from './animations';
import { synthesizeAtlas } from './atlas';

// A black, opaque setup dark color synthesized for a slot that has a two-color timeline but no setup dark
// color (Spine allows this; our format requires the setup dark color to key a dark track).
const SYNTHESIZED_DARK = { r: 0, g: 0, b: 0, a: 1 } as const;

// Orchestrate the full conversion of a parsed Spine JSON value into an UNVALIDATED SkeletonDocument.
// Returns undefined only when the input cannot be gated at all (not an object, or an absent/unsupported
// version); every other fault is recorded on `diag` and the best-effort document is still returned so
// the caller can run validateDocument and surface the precise format errors. The version gate is the one
// hard stop, because past it every downstream reader would be guessing at an unknown layout.
export function convertDocument(
  input: unknown,
  options: SpineImportOptions | undefined,
  diag: Diagnostics,
): SkeletonDocument | undefined {
  if (!isRecord(input)) {
    diag.error('SPINE_ROOT_INVALID', '', 'the Spine document root must be a JSON object');
    return undefined;
  }
  if (!gateVersion(input, diag)) return undefined;

  const bones = convertBonesField(input, diag);
  const slots = convertSlotsField(input, diag);
  const skins = withDefaultSkin(convertSkinsField(input, diag));

  const ikConstraints = convertIkField(input, diag);
  const transformConstraints = convertTransformField(input, diag);
  const pathConstraints = convertPathField(input, diag);
  warnPhysicsField(input, diag);

  const events = convertEvents(input['events'], '/events', diag);

  const ctx: AnimationContext = {
    skinsByName: new Map(skins.map((skin) => [skin.name, skin])),
    slotsWithDark: new Set(
      slots.filter((slot) => slot.darkColor !== undefined).map((slot) => slot.name),
    ),
    needsDark: new Set<string>(),
  };
  const animations = convertAnimations(input['animations'], '/animations', diag, ctx);
  synthesizeDarkColors(slots, ctx.needsDark);

  const metadata = convertMetadata(input, diag);

  const document: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: options?.name ?? DEFAULT_SKELETON_NAME,
    hash: '',
    bones,
    slots,
    skins,
    ikConstraints,
    transformConstraints,
    pathConstraints,
    physicsConstraints: [],
    events,
    animations,
    atlas: synthesizeAtlas(skins, diag),
    ...(metadata === undefined ? {} : { metadata }),
  };
  return { ...document, hash: computeContentHash(document) };
}

// The version gate. The version lives in `skeleton.spine`. An absent skeleton block or version string is
// SPINE_VERSION_MISSING; a present but non-4.x version is SPINE_VERSION_UNSUPPORTED. Both stop the import.
function gateVersion(input: JsonRecord, diag: Diagnostics): boolean {
  const skeleton = input['skeleton'];
  const skeletonRec = skeleton === undefined ? undefined : asRecord(skeleton, '/skeleton', diag);
  const version =
    skeletonRec === undefined
      ? undefined
      : readOptionalString(skeletonRec, 'spine', '/skeleton', diag);
  if (version === undefined) {
    diag.error(
      'SPINE_VERSION_MISSING',
      '/skeleton/spine',
      'the skeleton block must carry a "spine" version string',
    );
    return false;
  }
  if (!isSupportedVersion(version)) {
    diag.error(
      'SPINE_VERSION_UNSUPPORTED',
      '/skeleton/spine',
      `Spine version "${version}" is not supported; the importer accepts the documented 4.x JSON shape`,
      { version },
    );
    return false;
  }
  return true;
}

function convertBonesField(input: JsonRecord, diag: Diagnostics): Bone[] {
  const value = input['bones'];
  if (value === undefined) return [];
  const array = asArray(value, '/bones', diag);
  return array === undefined ? [] : convertBones(array, '/bones', diag);
}

function convertSlotsField(input: JsonRecord, diag: Diagnostics): Slot[] {
  const value = input['slots'];
  if (value === undefined) return [];
  const array = asArray(value, '/slots', diag);
  return array === undefined ? [] : convertSlots(array, '/slots', diag);
}

function convertSkinsField(input: JsonRecord, diag: Diagnostics): Skin[] {
  const value = input['skins'];
  if (value === undefined) return [];
  const array = asArray(value, '/skins', diag);
  return array === undefined ? [] : convertSkins(array, '/skins', diag);
}

// Every document must contain a skin named "default" (format SKIN_DEFAULT_MISSING). When the input
// declares none, an empty default skin is injected so the document validates.
function withDefaultSkin(skins: Skin[]): Skin[] {
  if (skins.some((skin) => skin.name === 'default')) return skins;
  return [{ name: 'default', attachments: {} }, ...skins];
}

function convertIkField(input: JsonRecord, diag: Diagnostics): IkConstraint[] {
  const value = input['ik'];
  if (value === undefined) return [];
  const array = asArray(value, '/ik', diag);
  return array === undefined ? [] : convertIkConstraints(array, '/ik', diag);
}

function convertTransformField(input: JsonRecord, diag: Diagnostics): TransformConstraint[] {
  const value = input['transform'];
  if (value === undefined) return [];
  const array = asArray(value, '/transform', diag);
  return array === undefined ? [] : convertTransformConstraints(array, '/transform', diag);
}

function convertPathField(input: JsonRecord, diag: Diagnostics): PathConstraint[] {
  const value = input['path'];
  if (value === undefined) return [];
  const array = asArray(value, '/path', diag);
  return array === undefined ? [] : convertPathConstraints(array, '/path', diag);
}

function warnPhysicsField(input: JsonRecord, diag: Diagnostics): void {
  const value = input['physics'];
  if (value === undefined) return;
  const array = asArray(value, '/physics', diag);
  if (array !== undefined) warnPhysicsConstraints(array, '/physics', diag);
}

// Patch a black setup dark color onto every slot a two-color timeline needs one for (a slot that still
// lacks a setup dark color after conversion). Mutates the slots array in place before the document is
// assembled, so the emitted document is internally consistent.
function synthesizeDarkColors(slots: Slot[], needsDark: ReadonlySet<string>): void {
  for (const [index, slot] of slots.entries()) {
    if (needsDark.has(slot.name) && slot.darkColor === undefined) {
      slots[index] = { ...slot, darkColor: { ...SYNTHESIZED_DARK } };
    }
  }
}

// The optional skeleton metadata block. `fps` is the authoring frame rate (positive), `images`/`audio`
// are the source-asset directories. The block is emitted only when at least one field is present.
function convertMetadata(input: JsonRecord, diag: Diagnostics): SkeletonMeta | undefined {
  const skeleton = input['skeleton'];
  const rec = skeleton === undefined ? undefined : asRecord(skeleton, '/skeleton', diag);
  if (rec === undefined) return undefined;
  const fps = readOptionalNumber(rec, 'fps', '/skeleton', diag);
  const imagesPath = readOptionalString(rec, 'images', '/skeleton', diag);
  const audioPath = readOptionalString(rec, 'audio', '/skeleton', diag);
  // fps must be positive for our metadata schema; a non-positive value is left out rather than emitted.
  const usableFps = fps !== undefined && fps > 0 ? fps : undefined;
  if (usableFps === undefined && imagesPath === undefined && audioPath === undefined)
    return undefined;
  return {
    ...(usableFps === undefined ? {} : { fps: usableFps }),
    ...(imagesPath === undefined ? {} : { imagesPath }),
    ...(audioPath === undefined ? {} : { audioPath }),
  };
}
