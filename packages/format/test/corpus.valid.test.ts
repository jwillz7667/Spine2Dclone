import { describe, expect, it } from 'vitest';
import { parseDocument, validateDocument } from '../src/validate';
import minimal from './fixtures/minimal.json';
import eventsDrawOrder from './fixtures/events-draworder.json';
import f2Complete from './fixtures/f2-complete.json';

// WP-0.3: the canonical valid fixture passes clean under the default (verifyHash: true) path, with
// zero errors and zero warnings, so its committed content hash is correct.
describe('valid corpus', () => {
  it('minimal.json validates with zero errors and zero warnings', () => {
    const report = validateDocument(minimal);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.document).not.toBeNull();
  });

  // Stage F1 (ADR-0008) positive completeness fixture: exercises the new 0.3.0 shapes end to end.
  it('events-draworder.json validates with zero errors and zero warnings', () => {
    const report = validateDocument(eventsDrawOrder);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('events-draworder.json authors every new 0.3.0 shape', () => {
    // parseDocument returns the typed schema output (zero casts), so the shape claims below are
    // type-checked, not hand-asserted.
    const doc = parseDocument(eventsDrawOrder);

    // Event definitions: an audio-backed event and a payload-carrying event.
    expect(doc.events.map((event) => event.name)).toEqual(['footstep', 'spawn']);
    expect(doc.events[0]?.audio).toEqual({ path: 'sfx/step.wav', volume: 0.8, balance: 0 });
    expect(doc.events[1]?.int).toBe(3);

    const idle = doc.animations['idle'];
    if (idle === undefined) throw new Error('fixture invariant: idle animation');

    // Draw-order timeline: an empty (setup-order) key and a two-slot swap key.
    expect(idle.drawOrder).toHaveLength(2);
    expect(idle.drawOrder[0]?.offsets).toEqual([]);
    expect(idle.drawOrder[1]?.offsets).toHaveLength(2);

    // Event timeline: coincident events at 0.5 (non-decreasing) with a payload override.
    expect(idle.events.map((key) => key.time)).toEqual([0.25, 0.5, 0.5]);
    expect(idle.events[1]?.int).toBe(9);

    // Optional metadata block.
    expect(doc.metadata).toEqual({ fps: 30, imagesPath: 'images/', audioPath: 'audio/' });
  });

  // Stage F2 (ADR-0009) positive completeness fixture: exercises the new 0.4.0 shapes end to end.
  it('f2-complete.json validates with zero errors and zero warnings', () => {
    const report = validateDocument(f2Complete);

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('f2-complete.json authors every new 0.4.0 shape', () => {
    const doc = parseDocument(f2Complete);

    // Constraint depth: signed bend, softness, stretch/uniform, and an explicit dense order.
    const ik1 = doc.ikConstraints[0];
    expect(ik1?.bend).toBe(1);
    expect(ik1?.softness).toBe(8);
    expect(ik1?.stretch).toBe(true);
    expect(ik1?.uniform).toBe(true);
    expect([ik1?.order, doc.ikConstraints[1]?.order, doc.transformConstraints[0]?.order]).toEqual([
      0, 1, 2,
    ]);
    expect(doc.transformConstraints[0]?.local).toBe(true);

    // A linked mesh reusing a parent mesh's geometry, and a sequence attachment.
    const limb = doc.skins[0]?.attachments['limb'];
    expect(limb?.['linkedLimb']?.type).toBe('linkedmesh');
    const body = doc.skins[0]?.attachments['body']?.['body'];
    expect(body?.type === 'region' ? body.sequence?.count : undefined).toBe(3);

    // Skin scoping.
    expect(doc.skins[0]?.bones).toEqual(['child']);
    expect(doc.skins[0]?.constraints).toEqual(['ik1', 'tc1']);

    // Timeline granularity: per-component bone tracks and split slot color / dark / sequence tracks.
    const idle = doc.animations['idle'];
    expect(idle?.bones['child']?.translateX).toBeDefined();
    expect(idle?.bones['child']?.scaleX).toBeDefined();
    expect(idle?.slots['body']?.rgb).toBeDefined();
    expect(idle?.slots['body']?.alpha).toBeDefined();
    expect(idle?.slots['body']?.dark).toBeDefined();
    expect(idle?.slots['body']?.sequence).toBeDefined();
  });
});
