import type { BlendMode, RGBA, Slot } from '@marionette/format';
import { parseHexColor, readColor } from '../color';
import type { Diagnostics } from '../diagnostics';
import { isBlendMode } from '../enums';
import {
  asRecord,
  ptr,
  readOptionalString,
  readRequiredString,
  readString,
  type JsonRecord,
} from '../read';

function readBlendMode(rec: JsonRecord, base: string, diag: Diagnostics): BlendMode {
  const raw = readString(rec, 'blend', base, diag, 'normal');
  if (isBlendMode(raw)) return raw;
  diag.error('SPINE_SCHEMA', ptr(base, 'blend'), `unknown slot blend mode "${raw}"`);
  return 'normal';
}

// The optional dark tint. Spine stores it as a 6 digit RGB hex ("RRGGBB"); our format stores a full
// RGBA, so the imported dark color takes alpha 1 (the dark channel has no alpha in Spine). Absent means
// single-color tint (no dark channel), which our schema models by omitting darkColor entirely.
function readDarkColor(rec: JsonRecord, base: string, diag: Diagnostics): RGBA | undefined {
  const value = rec['dark'];
  if (value === undefined) return undefined;
  const path = ptr(base, 'dark');
  if (typeof value !== 'string') {
    diag.error('SPINE_COLOR_INVALID', path, 'slot dark color must be a hex string');
    return undefined;
  }
  const parsed = parseHexColor(value);
  if (parsed === null) {
    diag.error(
      'SPINE_COLOR_INVALID',
      path,
      `dark color "${value}" is not a 6 or 8 digit hex string`,
      {
        value,
      },
    );
    return undefined;
  }
  return parsed;
}

// Convert Spine's `slots` array. `color` defaults to opaque white (FFFFFFFF); `attachment` is the setup
// pose attachment name or null; `blend` defaults to normal. The nonessential slot ordering IS meaningful
// (it is the setup draw order), so slots are emitted in input order.
export function convertSlots(slots: readonly unknown[], base: string, diag: Diagnostics): Slot[] {
  const out: Slot[] = [];
  for (const [index, raw] of slots.entries()) {
    const path = ptr(base, index);
    const rec = asRecord(raw, path, diag);
    if (rec === undefined) continue;
    const name = readRequiredString(rec, 'name', path, diag);
    const bone = readRequiredString(rec, 'bone', path, diag);
    if (name === undefined || bone === undefined) continue;
    const darkColor = readDarkColor(rec, path, diag);
    const slot: Slot = {
      name,
      bone,
      color: readColor(rec, 'color', path, diag),
      attachment: readOptionalString(rec, 'attachment', path, diag) ?? null,
      blendMode: readBlendMode(rec, path, diag),
      ...(darkColor === undefined ? {} : { darkColor }),
    };
    out.push(slot);
  }
  return out;
}
