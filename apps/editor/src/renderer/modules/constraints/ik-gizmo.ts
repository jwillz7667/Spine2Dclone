// PURE IK AUTHORING MATH for the viewport IK gizmo (WP-2.6). The gizmo .tsx is thin glue: it draws a
// target handle and a bend-direction toggle and routes edits to CreateIkConstraint / SetIkMix /
// SetIkBendPositive through history. The DECISIONS worth testing live here as pure functions: where the
// drag handle sits, which bend direction a target suggests, and how a mix slider clamps. No DOM, no PixiJS,
// no document access; deterministic. (This mirrors the "decisions in a pure module, panel is glue"
// convention used by edit-dispatcher.ts and inspector-logic.ts.)

// A world-space 2D point (the bone world transforms produce these; the gizmo consumes them).
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

// Clamp an IK mix-slider value into the constraint's legal [0, 1] blend range (SetIkMix stores an absolute
// mix). A non-finite input falls back to 0 (fully off) so a garbage slider edit cannot store NaN. This is
// the single place the editor clamps the mix before issuing the command.
export function mixFromSlider(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// The IK target handle position the gizmo draws and drags. The handle IS the target bone's world origin
// (the point the chain tip reaches toward), so dragging the handle moves the target. Returned as a fresh
// Vec2 so the caller never aliases the bone's world data. Kept as a function (not an identity inline) so
// the contract is explicit and unit-tested, and a future offset (e.g. a handle drawn at the tip) is a
// one-line change here.
export function ikTargetHandle(targetWorld: Vec2): Vec2 {
  return { x: targetWorld.x, y: targetWorld.y };
}

// Suggest the `bendPositive` flag for a two-bone IK chain from the geometry at author time (WP-2.6): the
// sign of the cross product (mid - root) x (target - root). A positive cross means the target sits to the
// LEFT of the root->mid direction, which the positive bend convention elbows toward; a negative cross
// suggests the negative bend. A (near-)zero cross (target collinear with the chain) defaults to true so the
// suggestion is total and deterministic. This only SUGGESTS the initial flag; the user can flip it (the
// toggle issues SetIkBendPositive), so a borderline guess is harmless.
export function suggestBendPositive(root: Vec2, mid: Vec2, target: Vec2): boolean {
  const cross = (mid.x - root.x) * (target.y - root.y) - (mid.y - root.y) * (target.x - root.x);
  return cross >= 0;
}
