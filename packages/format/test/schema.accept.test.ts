import { describe, expect, it } from 'vitest';
import minimal from './fixtures/minimal.json';
import { validateDocument } from '../src/validate';

// WP-0.3: the minimal valid document parses clean. It contains exactly one root bone, one slot, one
// region attachment, and one one-second animation with two rotate keyframes (handoff section 12).
describe('schema accept', () => {
  it('validates the minimal document with zero errors and zero warnings', () => {
    const report = validateDocument(minimal);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.document).not.toBeNull();
  });

  it('returns a document that deep-equals the parsed fixture', () => {
    const report = validateDocument(minimal);

    expect(report.document).toEqual(minimal);
  });

  it('has the expected minimal shape: one root bone, one slot, one region, one idle animation', () => {
    const document = validateDocument(minimal).document;
    if (document === null) throw new Error('expected a valid document');

    expect(document.bones).toHaveLength(1);
    expect(document.bones[0]?.parent).toBeNull();
    expect(document.slots).toHaveLength(1);
    const regionAttachment = document.skins[0]?.attachments['body']?.['body'];
    expect(regionAttachment?.type).toBe('region');
    const rotate = document.animations['idle']?.bones['root']?.rotate;
    expect(document.animations['idle']?.duration).toBe(1);
    expect(rotate).toHaveLength(2);
  });
});
