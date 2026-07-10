import type { RGBA } from '@marionette/format';
import type { Diagnostics } from './diagnostics';
import { ptr, type JsonRecord } from './read';

// Spine encodes colors as hex strings: 8 characters "RRGGBBAA" (RGBA order) or 6 characters "RRGGBB"
// (RGB order, opaque). Our format stores each channel as a float in [0, 1]. The conversion is
// channel / 255. A 6 digit string maps alpha to 1. See the README conventions table.

const WHITE: RGBA = { r: 1, g: 1, b: 1, a: 1 };
const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

// Parse a Spine hex color string into RGBA floats, or return null when the string is not a valid 6 or
// 8 digit hex value. Pure: it records no diagnostics (the caller decides how to report an invalid one).
export function parseHexColor(hex: string): RGBA | null {
  if (hex.length !== 6 && hex.length !== 8) return null;
  const channel = (start: number): number | null => {
    const pair = hex.slice(start, start + 2);
    if (!HEX_PAIR.test(pair)) return null;
    return parseInt(pair, 16) / 255;
  };
  const r = channel(0);
  const g = channel(2);
  const b = channel(4);
  const a = hex.length === 8 ? channel(6) : 1;
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

// Read a color field, defaulting to `fallback` when absent. A present-but-invalid color (wrong type or
// unparseable hex) records SPINE_COLOR_INVALID and returns `fallback` so the conversion continues.
export function readColor(
  rec: JsonRecord,
  key: string,
  base: string,
  diag: Diagnostics,
  fallback: RGBA = WHITE,
): RGBA {
  const value = rec[key];
  if (value === undefined) return fallback;
  const path = ptr(base, key);
  if (typeof value !== 'string') {
    diag.error('SPINE_COLOR_INVALID', path, `color field "${key}" must be a hex string`);
    return fallback;
  }
  const parsed = parseHexColor(value);
  if (parsed === null) {
    diag.error('SPINE_COLOR_INVALID', path, `color "${value}" is not a 6 or 8 digit hex string`, {
      value,
    });
    return fallback;
  }
  return parsed;
}
