import type { CurveType } from '@marionette/format';
import type { Diagnostics } from './diagnostics';
import { ptr, readNumber, type JsonRecord } from './read';

// Convert a Spine keyframe's interpolation curve into our CurveType. The published documentation gives
// three encodings for a keyframe's outgoing curve:
//   - absent            => linear
//   - "stepped"         => stepped
//   - a bezier easing, expressed EITHER as the flat form (`curve` is the number cx1, with sibling
//     `c2` = cy1, `c3` = cx2, `c4` = cy2) OR the array form (`curve` is [cx1, cy1, cx2, cy2]).
// Our bezier control points are cx1/cy1/cx2/cy2; the x components must stay in [0, 1] (our curve schema
// enforces this and validateDocument rejects an out-of-range easing loudly). The documented defaults for
// the flat form are cy1 = 0, cx2 = 1, cy2 = 1 when only `curve` (cx1) is given.
export function parseCurve(rec: JsonRecord, base: string, diag: Diagnostics): CurveType {
  const value = rec['curve'];
  if (value === undefined) return 'linear';
  if (value === 'stepped') return 'stepped';

  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      type: 'bezier',
      cx1: value,
      cy1: readNumber(rec, 'c2', base, diag, 0),
      cx2: readNumber(rec, 'c3', base, diag, 1),
      cy2: readNumber(rec, 'c4', base, diag, 1),
    };
  }

  if (Array.isArray(value)) {
    const path = ptr(base, 'curve');
    if (value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      const [cx1, cy1, cx2, cy2] = value;
      return { type: 'bezier', cx1: cx1!, cy1: cy1!, cx2: cx2!, cy2: cy2! };
    }
    diag.error('SPINE_SCHEMA', path, 'bezier curve array must hold exactly 4 finite numbers');
    return 'linear';
  }

  diag.error(
    'SPINE_SCHEMA',
    ptr(base, 'curve'),
    'curve must be "stepped", a bezier number, or a 4 number array',
  );
  return 'linear';
}
