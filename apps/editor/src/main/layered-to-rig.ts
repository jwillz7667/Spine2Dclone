import {
  computeContentHash,
  CURRENT_FORMAT_VERSION,
  type Attachment,
  type AtlasRef,
  type AtlasRegion,
  type SkeletonDocument,
  type Skin,
  type Slot,
} from '@marionette/format';
import { encodePng, packAtlas, trimSprite, type TrimmedSprite } from '@marionette/atlas-pack';
import type { AtlasImportPage } from '../shared';
import type { LayeredDocument, RasterLayer } from './layered-types';

// PURE "layers to rig" projection (PP-D5): turn a parsed LayeredDocument (from PSD or ORA) into an atlas plus
// a validated-shape SkeletonDocument, one slot + region attachment per layer positioned at its document
// coordinates. No filesystem, no Electron, so the packing determinism and the projection math are unit
// testable headless. The orchestrator (layered-import.ts) runs these in order and validates the assembled
// document with the format validator before returning it (LAW 3).
//
// PROJECTION RULES:
//  - One root bone at the origin; every slot rides it (no bone hierarchy is inferred from a flat layer list).
//  - The document origin (0,0) is the CANVAS CENTER. A layer whose bitmap sits at document (left, top) with
//    size (w, h) becomes a region attachment centered at (left + w/2 - canvasW/2, top + h/2 - canvasH/2).
//    Source pixel space and our world space are both y-down, so no vertical flip is applied.
//  - The attachment width/height is the region's ORIGINAL (untrimmed) size, so the alpha-trim the packer
//    applies is invisible in placement: the visible pixels land exactly where the artist put them.
//  - Slot (draw) order is BOTTOM layer first. PSD and ORA both store layers top-first, so the list is
//    reversed. A hidden layer keeps its attachment in the skin but shows nothing in setup pose (slot
//    attachment is null), so it can be revealed later without re-importing.
//  - Region/slot/attachment names are the path-joined layer names, de-duplicated with a numeric suffix.

const WHITE = { r: 1, g: 1, b: 1, a: 1 } as const;
const ROOT_BONE_NAME = 'root';

export interface NamedLayer extends RasterLayer {
  readonly regionName: string;
}

// Assign a unique region name to every layer, preserving the path-joined layer name and disambiguating
// collisions (PSD/ORA allow duplicate layer names) with a numeric suffix.
export function assignRegionNames(layers: readonly RasterLayer[]): NamedLayer[] {
  const used = new Set<string>();
  return layers.map((layer) => {
    let candidate = layer.name;
    let counter = 2;
    while (used.has(candidate)) {
      candidate = `${layer.name}_${counter}`;
      counter += 1;
    }
    used.add(candidate);
    return { ...layer, regionName: candidate };
  });
}

// Pack the layer bitmaps into a deterministic atlas (alpha-trim -> maxrects pack -> PNG encode), returning
// the AtlasRef and the encoded page bytes to ship to the renderer. Reuses the shared atlas-pack core, so a
// layered import lands the SAME kind of atlas a sprite-folder import does.
export function packNamedLayers(layers: readonly NamedLayer[]): {
  atlas: AtlasRef;
  pages: AtlasImportPage[];
} {
  const sprites: TrimmedSprite[] = layers.map((layer) => {
    const trimmed = trimSprite(layer.rgba, layer.width, layer.height);
    return {
      name: layer.regionName,
      trimmedW: trimmed.trimmedW,
      trimmedH: trimmed.trimmedH,
      offsetX: trimmed.offsetX,
      offsetY: trimmed.offsetY,
      originalW: trimmed.originalW,
      originalH: trimmed.originalH,
      pixels: trimmed.pixels,
    };
  });

  // Layered sources often carry large full-canvas layers, so pack onto the largest allowed page (4096) to
  // reduce page count and keep a big background layer packable.
  const { atlas, pageBitmaps } = packAtlas(sprites, { maxPageSize: 4096 });
  const pages: AtlasImportPage[] = atlas.pages.map((page, index) => {
    const bitmap = pageBitmaps[index];
    if (bitmap === undefined) {
      throw new Error(`atlas page ${index} has no bitmap`);
    }
    return {
      file: page.file,
      data: new Uint8Array(
        encodePng({ width: bitmap.width, height: bitmap.height, rgba: bitmap.rgba }),
      ),
    };
  });
  return { atlas, pages };
}

// Build the SkeletonDocument from the named layers and the packed atlas. Every layer must have a region in
// the atlas (packNamedLayers packed all of them); a layer whose region is missing is skipped defensively.
export function buildRigFromLayers(
  doc: Pick<LayeredDocument, 'name' | 'canvasWidth' | 'canvasHeight'>,
  layers: readonly NamedLayer[],
  atlas: AtlasRef,
): SkeletonDocument {
  const regionsByName = new Map<string, AtlasRegion>();
  for (const page of atlas.pages) {
    for (const region of page.regions) regionsByName.set(region.name, region);
  }

  const halfW = doc.canvasWidth / 2;
  const halfH = doc.canvasHeight / 2;
  const slots: Slot[] = [];
  const attachments: Record<string, Record<string, Attachment>> = {};

  // Bottom layer first: the file lists layers top-first, so reverse for setup draw order.
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index];
    if (layer === undefined) continue;
    const region = regionsByName.get(layer.regionName);
    if (region === undefined) continue;

    const attachment: Attachment = {
      type: 'region',
      path: layer.regionName,
      x: layer.left + region.originalW / 2 - halfW,
      y: layer.top + region.originalH / 2 - halfH,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: region.originalW,
      height: region.originalH,
      color: { ...WHITE },
    };
    slots.push({
      name: layer.regionName,
      bone: ROOT_BONE_NAME,
      color: { ...WHITE },
      attachment: layer.visible ? layer.regionName : null,
      blendMode: 'normal',
    });
    attachments[layer.regionName] = { [layer.regionName]: attachment };
  }

  const skin: Skin = { name: 'default', attachments };
  const document: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: doc.name,
    hash: '',
    bones: [
      {
        name: ROOT_BONE_NAME,
        parent: null,
        length: 0,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots,
    skins: [skin],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [],
    physicsConstraints: [],
    events: [],
    animations: {},
    atlas,
  };
  return { ...document, hash: computeContentHash(document) };
}
