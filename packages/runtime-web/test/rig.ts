import type {
  Animation,
  AtlasRegion,
  Bone,
  MeshAttachment,
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

// An UNWEIGHTED unit-quad mesh (4 hull vertices, 2 triangles) in slot-bone space, scaled to
// width x height around the bone origin. Weighted-mesh render tests use the committed mesh-limb-rig
// asset instead (a document-core-authored rig); this builder covers the structural render path.
export function mesh(path: string, overrides: Partial<MeshAttachment> = {}): MeshAttachment {
  const w = overrides.width ?? 64;
  const h = overrides.height ?? 64;
  return {
    type: 'mesh',
    path,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 2, 3, 0],
    hullLength: 4,
    width: w,
    height: h,
    color: { ...WHITE },
    vertices: [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2],
    ...overrides,
  };
}

// Default-skin attachment map: slot name -> attachment name -> region or mesh attachment.
export type SkinMap = Record<string, Record<string, RegionAttachment | MeshAttachment>>;

export interface DocumentParts {
  readonly bones: Bone[];
  readonly slots?: Slot[];
  readonly skin?: SkinMap;
  readonly animations?: Record<string, Animation>;
  readonly name?: string;
  // Per-path overrides of the derived atlas region (trim offsets, packed w/h, rotated), so a test can pack
  // a region trimmed or rotated without hand-writing the whole document. Unspecified paths stay untrimmed.
  readonly atlasOverrides?: Record<string, Partial<AtlasRegion>>;
}

export function makeDocument(parts: DocumentParts): SkeletonDocument {
  const slots = parts.slots ?? [];
  const skin = parts.skin ?? {};
  const atlasOverrides = parts.atlasOverrides ?? {};

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
    ...atlasOverrides[name],
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
