import { describe, expect, it } from 'vitest';
import { validateDocument } from '../src/validate';
import { cloneMinimal, errorCodes } from './helpers';

// WP-0.3 animation timeline checks (format-contract section 4.8). Strict-ascending time order applies
// to the interpolated VALUE timelines the contract enumerates (bone channels, slot color); the
// attachment (swap) timeline is contract-silent on order and so is range-checked only. Duration must
// be at least the maximum keyframe time and strictly positive when there are keyframes.
describe('animation timelines', () => {
  it('reports ANIM_TIME_ORDER (at the offending keyframe) for equal times on a value timeline', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.bones['root']!.rotate = [
      { time: 0, value: { angle: 0 }, curve: 'linear' },
      { time: 0, value: { angle: 30 }, curve: 'linear' },
    ];

    const report = validateDocument(doc, { verifyHash: false });
    expect(errorCodes(report)).toContain('ANIM_TIME_ORDER');
    expect(report.errors.find((error) => error.code === 'ANIM_TIME_ORDER')?.path).toBe(
      '/animations/idle/bones/root/rotate/1/time',
    );
  });

  it('reports ANIM_TIME_ORDER for an equal-time slot color timeline (strict)', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots = {
      body: {
        color: [
          { time: 0.2, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' },
          { time: 0.2, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' },
        ],
      },
    };

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('ANIM_TIME_ORDER');
  });

  it('accepts coincident attachment-swap frames (the attachment timeline is not strict)', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.slots = {
      body: {
        attachment: [
          { time: 0.5, name: 'body' },
          { time: 0.5, name: null },
        ],
      },
    };

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).not.toContain('ANIM_TIME_ORDER');
  });

  it('reports ANIM_TIME_RANGE for a keyframe time outside [0, duration]', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.bones['root']!.rotate = [
      { time: -1, value: { angle: 0 }, curve: 'linear' },
      { time: 0.5, value: { angle: 30 }, curve: 'linear' },
    ];

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('ANIM_TIME_RANGE');
    expect(codes).not.toContain('ANIM_DURATION');
  });

  it('reports ANIM_DURATION when duration is below the maximum keyframe time', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.duration = 0.5; // a rotate keyframe sits at time 1

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).toContain('ANIM_DURATION');
  });

  it('reports ANIM_DURATION when duration is zero but the animation has keyframes', () => {
    const doc = cloneMinimal();
    doc.animations['idle']!.duration = 0;
    doc.animations['idle']!.bones['root']!.rotate = [{ time: 0, value: { angle: 0 }, curve: 'linear' }];

    const codes = errorCodes(validateDocument(doc, { verifyHash: false }));
    expect(codes).toContain('ANIM_DURATION');
    expect(codes).not.toContain('ANIM_TIME_RANGE');
  });

  it('accepts a keyframe-free animation with zero duration', () => {
    const doc = cloneMinimal();
    doc.animations['empty'] = { duration: 0, bones: {}, slots: {} };

    expect(errorCodes(validateDocument(doc, { verifyHash: false }))).not.toContain('ANIM_DURATION');
  });
});
