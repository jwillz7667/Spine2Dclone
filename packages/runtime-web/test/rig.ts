import type {
  Animation,
  Bone,
  RegionAttachment,
  RGBA,
  SkeletonDocument,
  Slot,
} from '@marionette/format/types';

// Test rig builders: construct in-memory documents that pass the full format validator (default skin
// present, slot/bone/attachment references resolve, atlas regions exist) so SkeletonView.sync accepts
// them. Documents are drafts (hash ''), so verifyHash is moot. These mirror the WP-0.3 minimal
// fixture shape without coupling the runtime-web tests to the format package's test fixtures.

export const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };

export function bone(name: string, parent: string | null, overrides: Partial<Bone> = {}): Bone {
  return {
    name,
    parent,
    length: 100,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
    ...overrides,
  };
}

export function region(path: string, overrides: Partial<RegionAttachment> = {}): RegionAttachment {
  return {
    type: 'region',
    path,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 64,
    height: 64,
    color: { ...WHITE },
    ...overrides,
  };
}

export function slot(
  name: string,
  boneName: string,
  attachment: string | null,
  overrides: Partial<Slot> = {},
): Slot {
  return {
    name,
    bone: boneName,
    color: { ...WHITE },
    attachment,
    blendMode: 'normal',
    ...overrides,
  };
}

// Default-skin attachment map: slot name -> attachment name -> region attachment.
export type SkinMap = Record<string, Record<string, RegionAttachment>>;

export interface DocumentParts {
  readonly bones: Bone[];
  readonly slots?: Slot[];
  readonly skin?: SkinMap;
  readonly animations?: Record<string, Animation>;
  readonly name?: string;
}

export function makeDocument(parts: DocumentParts): SkeletonDocument {
  const slots = parts.slots ?? [];
  const skin = parts.skin ?? {};

  // Derive one atlas region per distinct region path so ATTACHMENT_REGION_MISSING never fires.
  const paths = new Set<string>();
  for (const bySlot of Object.values(skin)) {
    for (const attachment of Object.values(bySlot)) paths.add(attachment.path);
  }
  const regions = [...paths].map((name) => ({
    name,
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  }));

  // Normalize each animation to the 0.2.0 shape (ADR-0004): the required ik/transform/deform timelines
  // default to empty so a caller that keys only bone/slot channels still produces a valid current
  // document (no migration on sync), which is what lets the hash-verification tests detect a tamper.
  const animations: Record<string, Animation> = {};
  for (const [name, anim] of Object.entries(parts.animations ?? {})) {
    animations[name] = {
      ...anim,
      ik: anim.ik ?? {},
      transform: anim.transform ?? {},
      deform: anim.deform ?? {},
    };
  }

  return {
    formatVersion: '0.2.0',
    name: parts.name ?? 'rig',
    hash: '',
    bones: parts.bones,
    slots,
    skins: [{ name: 'default', attachments: skin }],
    ikConstraints: [],
    transformConstraints: [],
    animations,
    atlas: {
      pages: regions.length > 0 ? [{ file: 'atlas.png', width: 128, height: 128, regions }] : [],
    },
  };
}

// The WP-0.3 minimal rig: one root bone, one slot showing one 64x64 region attachment.
export function minimalDocument(): SkeletonDocument {
  return makeDocument({
    bones: [bone('root', null)],
    slots: [slot('body', 'root', 'body')],
    skin: { body: { body: region('body') } },
    name: 'minimal',
  });
}
