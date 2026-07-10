import { describe, expect, it } from 'vitest';
import { isCheckerAltTile, previewBackgroundStyle } from './preview-background';

describe('preview background style', () => {
  it('dark and light are flat fills with no checker', () => {
    expect(previewBackgroundStyle('dark').checker).toBeNull();
    expect(previewBackgroundStyle('light').checker).toBeNull();
    expect(previewBackgroundStyle('dark').clearColor).not.toBe(
      previewBackgroundStyle('light').clearColor,
    );
  });

  it('checker carries two tones and a positive tile size', () => {
    const checker = previewBackgroundStyle('checker').checker;

    expect(checker).not.toBeNull();
    expect(checker!.tile).toBeGreaterThan(0);
    expect(checker!.colorA).not.toBe(checker!.colorB);
  });

  it('tile parity is the XOR of the two axis parities', () => {
    expect(isCheckerAltTile(0, 0)).toBe(false);
    expect(isCheckerAltTile(1, 0)).toBe(true);
    expect(isCheckerAltTile(0, 1)).toBe(true);
    expect(isCheckerAltTile(1, 1)).toBe(false);
    expect(isCheckerAltTile(2, 3)).toBe(true);
  });
});
