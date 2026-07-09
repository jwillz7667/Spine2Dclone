import type { AtlasRegion } from '@marionette/format/types';
import type { RegionAttachmentEntity } from '../document';
import { regionAttachmentDefaults } from './inspector-logic';
import { DEFAULT_SKIN_NAME } from '../editor-state/skin-preview-store';

// Pure naming, reconciliation, and entity-construction logic for the skins panel (PP-D4). The panel
// (skins-panel.tsx) is thin glue over the five skin commands plus the ephemeral skin-preview store; every
// DECISION worth a test lives here with no React, no document access, and no side effects (the house
// convention, mirrors inspector-logic.ts). The editor vitest env is `node`, so this is unit-tested and the
// .tsx is covered by typecheck + lint.

const DEFAULT_SKIN_BASENAME = 'skin';

// Return `base` if free, else `base` followed by the smallest numeric suffix (from 2) not taken, matching
// inspector-logic's slot naming. Uniqueness here is an editor convenience; CreateSkin still rejects a true
// duplicate at the command boundary.
function nextFreeName(existing: readonly string[], base: string): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

// The default name for a fresh skin, uniquified against the existing skin names.
export function uniqueSkinName(existing: readonly string[]): string {
  return nextFreeName(existing, DEFAULT_SKIN_BASENAME);
}

// The name a duplicate defaults to: "<source> copy", uniquified so duplicating twice does not collide.
export function duplicateSkinName(existing: readonly string[], sourceName: string): string {
  return nextFreeName(existing, `${sourceName} copy`);
}

// Reconcile the EPHEMERAL skin preview after a skin is deleted (editor state, never part of the command;
// the document/editor wall, LAW 1). If the previewed skin was the deleted one, fall back to 'default';
// otherwise leave it. Generic string logic so it is trivially testable.
export function previewAfterDelete(deletedName: string, currentPreview: string): string {
  return currentPreview === deletedName ? DEFAULT_SKIN_NAME : currentPreview;
}

// Reconcile the EPHEMERAL skin preview after a skin is renamed: if the previewed skin was the one renamed,
// follow it to the new name so the viewport keeps showing the same costume.
export function previewAfterRename(oldName: string, newName: string, currentPreview: string): string {
  return currentPreview === oldName ? newName : currentPreview;
}

// True when the previewed name still resolves to a skin the document defines ('default' always resolves).
// The panel uses this to reset a dangling preview (a skin removed by an undo the panel did not initiate).
export function isKnownSkin(previewName: string, skinNames: readonly string[]): boolean {
  return previewName === DEFAULT_SKIN_NAME || skinNames.includes(previewName);
}

// Build the region attachment entity a skin override stores for a slot. The entity is keyed IN THE SKIN by
// its `name`, which MUST equal the slot's active (placeholder) attachment name so a live skin switch swaps
// this geometry in for that placeholder; the `path` points at the chosen atlas region and the placement is
// the trim-offset default (regionAttachmentDefaults), exactly like a default-skin region attachment.
export function skinRegionEntity(
  placeholderName: string,
  region: AtlasRegion,
): RegionAttachmentEntity {
  return {
    kind: 'region',
    name: placeholderName,
    path: region.name,
    ...regionAttachmentDefaults(region),
  };
}
