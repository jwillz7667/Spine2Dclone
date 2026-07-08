import { describe, expect, it } from 'vitest';
import type { SkeletonDocument } from '../src/schema/document';
import { validateDocument } from '../src/validate';
import type { FormatErrorCode } from '../src/validate/errors';
import { cloneMinimal } from './helpers';

// Stage F1 (ADR-0008): the event and draw-order validators. Each test isolates one behavior. Hashes
// are not managed here (verifyHash: false); the structural and semantic layers run regardless.

function codes(doc: SkeletonDocument): FormatErrorCode[] {
  return validateDocument(doc, { verifyHash: false }).errors.map((error) => error.code);
}

// A second slot so draw-order offsets can describe a real reordering (a single slot can only hold
// offset 0). The extra slot shows no attachment, which is irrelevant to draw order.
function twoSlotDoc(): SkeletonDocument {
  const doc = cloneMinimal();
  doc.slots.push({
    name: 'body2',
    bone: 'root',
    color: { r: 1, g: 1, b: 1, a: 1 },
    attachment: null,
    blendMode: 'normal',
  });
  return doc;
}

describe('event definitions (ADR-0008)', () => {
  it('accepts unique event names with payloads and an audio hint', () => {
    const doc = cloneMinimal();
    doc.events = [
      { name: 'footstep', audio: { path: 'sfx/step.wav', volume: 0.5, balance: -0.5 } },
      { name: 'spawn', int: 2, float: 0.25, string: 'boss' },
    ];
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('EVENT_NAME_DUPLICATE for a repeated event name', () => {
    const doc = cloneMinimal();
    doc.events = [{ name: 'hit' }, { name: 'hit' }];
    const report = validateDocument(doc, { verifyHash: false });
    expect(report.errors.map((e) => e.code)).toEqual(['EVENT_NAME_DUPLICATE']);
    expect(report.errors[0]?.path).toBe('/events/1/name');
  });

  it('EVENT_AUDIO_RANGE for a volume above 1', () => {
    const doc = cloneMinimal();
    doc.events = [{ name: 'hit', audio: { path: 'a.wav', volume: 1.5, balance: 0 } }];
    expect(codes(doc)).toContain('EVENT_AUDIO_RANGE');
  });

  it('EVENT_AUDIO_RANGE for a balance below -1', () => {
    const doc = cloneMinimal();
    doc.events = [{ name: 'hit', audio: { path: 'a.wav', volume: 1, balance: -2 } }];
    expect(codes(doc)).toContain('EVENT_AUDIO_RANGE');
  });

  it('SCHEMA_SHAPE for a non-integer int payload', () => {
    const doc = cloneMinimal();
    doc.events = [{ name: 'hit', int: 1.5 }];
    expect(codes(doc)).toContain('SCHEMA_SHAPE');
  });
});

describe('event timeline (ADR-0008)', () => {
  function withEvents(events: SkeletonDocument['animations'][string]['events']): SkeletonDocument {
    const doc = cloneMinimal();
    doc.events = [{ name: 'footstep' }];
    doc.animations['idle']!.events = events;
    return doc;
  }

  it('accepts a defined event with a payload override', () => {
    expect(
      validateDocument(withEvents([{ time: 0.5, name: 'footstep', int: 7 }]), {
        verifyHash: false,
      }).ok,
    ).toBe(true);
  });

  it('accepts coincident event keys (non-decreasing order)', () => {
    const doc = withEvents([
      { time: 0.5, name: 'footstep' },
      { time: 0.5, name: 'footstep' },
    ]);
    expect(codes(doc)).not.toContain('ANIM_TIME_ORDER');
  });

  it('ANIM_TIME_ORDER for a strictly decreasing event pair', () => {
    const doc = withEvents([
      { time: 0.6, name: 'footstep' },
      { time: 0.4, name: 'footstep' },
    ]);
    expect(codes(doc)).toContain('ANIM_TIME_ORDER');
  });

  it('ANIM_EVENT_UNKNOWN for a fired event with no definition', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.events = [{ time: 0, name: 'ghost' }];
    const report = validateDocument(doc, { verifyHash: false });
    expect(report.errors.map((e) => e.code)).toContain('ANIM_EVENT_UNKNOWN');
    expect(report.errors.find((e) => e.code === 'ANIM_EVENT_UNKNOWN')?.path).toBe(
      '/animations/idle/events/0/name',
    );
  });
});

describe('draw-order timeline (ADR-0008)', () => {
  function withDrawOrder(
    drawOrder: SkeletonDocument['animations'][string]['drawOrder'],
  ): SkeletonDocument {
    const doc = twoSlotDoc();
    doc.animations['idle']!.drawOrder = drawOrder;
    return doc;
  }

  it('accepts an empty-offsets key (setup order) and a consistent swap', () => {
    const doc = withDrawOrder([
      { time: 0, offsets: [] },
      {
        time: 0.5,
        offsets: [
          { slot: 'body', offset: 1 },
          { slot: 'body2', offset: -1 },
        ],
      },
    ]);
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('ANIM_TIME_ORDER for coincident draw-order keys (strict order)', () => {
    const doc = withDrawOrder([
      { time: 0.5, offsets: [] },
      { time: 0.5, offsets: [] },
    ]);
    expect(codes(doc)).toContain('ANIM_TIME_ORDER');
  });

  it('ANIM_SLOT_UNKNOWN for an offset on a slot that does not exist', () => {
    const doc = withDrawOrder([{ time: 0, offsets: [{ slot: 'ghost', offset: 0 }] }]);
    expect(codes(doc)).toContain('ANIM_SLOT_UNKNOWN');
  });

  it('DRAWORDER_INCOMPLETE when an offset moves a slot outside the draw-order range', () => {
    const doc = withDrawOrder([{ time: 0, offsets: [{ slot: 'body', offset: 5 }] }]);
    expect(codes(doc)).toContain('DRAWORDER_INCOMPLETE');
  });

  it('DRAWORDER_INCOMPLETE when a slot appears twice in one key', () => {
    const doc = withDrawOrder([
      {
        time: 0,
        offsets: [
          { slot: 'body', offset: 0 },
          { slot: 'body', offset: 1 },
        ],
      },
    ]);
    expect(codes(doc)).toContain('DRAWORDER_INCOMPLETE');
  });

  it('DRAWORDER_INCOMPLETE when two slots resolve to the same index', () => {
    const doc = withDrawOrder([
      {
        time: 0,
        offsets: [
          { slot: 'body', offset: 1 },
          { slot: 'body2', offset: 0 },
        ],
      },
    ]);
    expect(codes(doc)).toContain('DRAWORDER_INCOMPLETE');
  });
});

describe('skeleton metadata (ADR-0008)', () => {
  it('accepts an omitted metadata block and a populated one', () => {
    expect(validateDocument(cloneMinimal()).ok).toBe(true);

    const doc = cloneMinimal();
    doc.metadata = { fps: 24, imagesPath: 'src/images', audioPath: 'src/audio' };
    expect(validateDocument(doc, { verifyHash: false }).ok).toBe(true);
  });

  it('SCHEMA_SHAPE for a non-positive fps', () => {
    const doc = cloneMinimal();
    doc.metadata = { fps: 0 };
    expect(codes(doc)).toContain('SCHEMA_SHAPE');
  });
});
