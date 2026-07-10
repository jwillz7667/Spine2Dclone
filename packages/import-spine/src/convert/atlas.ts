import type { AtlasRef, AtlasRegion, Skin } from '@marionette/format';
import type { Diagnostics } from '../diagnostics';

// Spine JSON does NOT carry atlas region geometry: the region rectangles, trim, and rotation live in the
// sibling `.atlas` text file, which this slice does not read. Our format validator requires every
// region/mesh/linkedmesh attachment `path` to resolve to an atlas region, so the importer synthesizes a
// placeholder atlas page listing every referenced region name (with zero geometry). This makes the
// document VALID and self-consistent; real UVs come from importing the `.atlas` through atlas-pack
// separately and re-associating by region name. The synthesis is surfaced as a warning, never silent.
export function synthesizeAtlas(skins: readonly Skin[], diag: Diagnostics): AtlasRef {
  const names = collectRegionNames(skins);
  if (names.length === 0) return { pages: [] };

  const regions: AtlasRegion[] = names.map((name) => ({
    name,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 0,
    originalH: 0,
  }));

  diag.warn(
    'atlas-synthesized',
    '',
    `Spine JSON carries no atlas geometry; ${regions.length} placeholder region(s) were synthesized so attachment paths resolve. Import the sibling .atlas via atlas-pack for real UVs.`,
    { regions: regions.length },
  );

  return { pages: [{ file: 'imported-atlas.png', width: 0, height: 0, regions }] };
}

// The ascending, de-duplicated set of region names referenced by textured attachments across all skins.
function collectRegionNames(skins: readonly Skin[]): string[] {
  const names = new Set<string>();
  for (const skin of skins) {
    for (const slotAttachments of Object.values(skin.attachments)) {
      for (const attachment of Object.values(slotAttachments)) {
        if (
          attachment.type === 'region' ||
          attachment.type === 'mesh' ||
          attachment.type === 'linkedmesh'
        ) {
          names.add(attachment.path);
        }
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
