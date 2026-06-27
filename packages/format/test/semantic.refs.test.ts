import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes } from './helpers';

// WP-0.3: the slot, skin, and atlas referential-integrity checks. Each mutation introduces exactly
// one fault; validated with verifyHash: false because the mutations invalidate the content hash.
describe('semantic references', () => {
  it('reports SLOT_BONE_MISSING (at the slot bone pointer) when a slot rides a nonexistent bone', () => {
    const doc = cloneMinimal();
    doc.slots[0]!.bone = 'ghost';

    const report = validateDocument(doc, { verifyHash: false });
    expect(errorCodes(report)).toContain('SLOT_BONE_MISSING');
    expect(report.errors.find((error) => error.code === 'SLOT_BONE_MISSING')?.path).toBe('/slots/0/bone');
  });

  it('reports SLOT_ATTACHMENT_MISSING when the setup attachment is not in the default skin', () => {
    const doc = cloneMinimal();
    doc.slots[0]!.attachment = 'missing';

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('SLOT_ATTACHMENT_MISSING');
  });

  it('reports SLOT_NAME_DUPLICATE for a repeated slot name', () => {
    const doc = cloneMinimal();
    doc.slots.push({ ...doc.slots[0]!, attachment: null });

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('SLOT_NAME_DUPLICATE');
  });

  it('reports SKIN_DEFAULT_MISSING when no skin is named default', () => {
    const doc = cloneMinimal();
    doc.skins[0]!.name = 'other';

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('SKIN_DEFAULT_MISSING');
    // A missing default skin must NOT cascade into a SLOT_ATTACHMENT_MISSING.
    expect(codes).not.toContain('SLOT_ATTACHMENT_MISSING');
  });

  it('reports SKIN_SLOT_UNKNOWN when a skin keys attachments on a nonexistent slot', () => {
    const doc = cloneMinimal();
    doc.skins[0]!.attachments['ghostSlot'] = {};

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('SKIN_SLOT_UNKNOWN');
  });

  it('reports ATTACHMENT_REGION_MISSING when an attachment path resolves to no region', () => {
    const doc = cloneMinimal();
    const attachment = doc.skins[0]!.attachments['body']!['body']!;
    if (attachment.type === 'region') attachment.path = 'ghostRegion';

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('ATTACHMENT_REGION_MISSING');
  });

  it('reports ATLAS_REGION_DUPLICATE for a region name repeated across pages', () => {
    const doc = cloneMinimal();
    doc.atlas.pages[0]!.regions.push({ ...doc.atlas.pages[0]!.regions[0]! });

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('ATLAS_REGION_DUPLICATE');
  });
});
