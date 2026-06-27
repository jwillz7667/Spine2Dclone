import type { Mat2x3 } from '../math/affine';
import { DEG_TO_RAD, RAD_TO_DEG } from './scalar';

// Canonical 2D affine world-channel decomposition/recomposition (ADR-0003 section 6). This is the
// channel model transform constraints blend in (read world, blend per channel in world, write local).
// It is a first-principles QR-style decomposition (Law 4, NOT Spine source): the X-axis column fixes
// rotation and scaleX, the signed determinant carries reflection into scaleY, and the residual
// non-perpendicularity of the Y-axis is the Y shear. Angles are kept in DEGREES at this boundary to
// match affine.compose and the format's stored fields; the trig runs in radians internally.
//
// decomposeWorld and composeWorld are EXACT inverses for any non-degenerate matrix:
// composeWorld(decomposeWorld(m)) reproduces m to f64 round-off (see the round-trip proof in the unit
// tests). shearY is undefined as it approaches +/-90 degrees (the tan term diverges); the format
// validator rejects keyed/setup shears in that degenerate band, so the solve never sees one.
export interface WorldChannels {
  // Rotation of the X axis, in DEGREES.
  rotation: number;
  x: number;
  y: number;
  scaleX: number;
  // Signed: a reflected matrix (det < 0) yields a negative scaleY, which carries the reflection.
  scaleY: number;
  // Y shear, in DEGREES. Zero for a pure rotation; equals gamma for a Y-only shear of gamma degrees.
  shearY: number;
}

export function decomposeWorld(m: Mat2x3): WorldChannels {
  // ADR-0003 section 6 names the entries by COLUMN: the X' column is (a, c), the Y' column is (b, d).
  // In our column-vector Mat2x3 = [m0, m1, m2, m3, tx, ty] that is a = m0, c = m1 (X column), b = m2,
  // d = m3 (Y column), NOT the literal index order. With this mapping rotation = atan2(c, a) matches
  // affine.compose/getRotationDeg (a pure rotation built by affine.compose decomposes to +theta).
  const a = m[0];
  const c = m[1];
  const b = m[2];
  const d = m[3];
  const rotation = Math.atan2(c, a);
  const scaleX = Math.sqrt(a * a + c * c);
  const det = a * d - b * c;
  // scaleY is the determinant divided out by scaleX, so it is signed and carries reflection; scaleX
  // stays the non-negative X-axis length.
  const scaleY = det / scaleX;
  const shearY = Math.atan2(a * b + c * d, det);
  return {
    rotation: rotation * RAD_TO_DEG,
    x: m[4],
    y: m[5],
    scaleX,
    scaleY,
    shearY: shearY * RAD_TO_DEG,
  };
}

export function composeWorld(channels: WorldChannels): Mat2x3 {
  const rotation = channels.rotation * DEG_TO_RAD;
  const shearY = channels.shearY * DEG_TO_RAD;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tanShearY = Math.tan(shearY);
  const { scaleX, scaleY } = channels;
  // a = scaleX*cos, c = scaleX*sin (X column); b = scaleY*(tan*cos - sin), d = scaleY*(tan*sin + cos)
  // (Y column). Packed back in Mat2x3 order [a, c, b, d, x, y] = [m0, m1, m2, m3, m4, m5]. A pure
  // rotation reduces to [cos, sin, -sin, cos], identical to affine.compose's rotation layout.
  return [
    scaleX * cos,
    scaleX * sin,
    scaleY * (tanShearY * cos - sin),
    scaleY * (tanShearY * sin + cos),
    channels.x,
    channels.y,
  ];
}
