import { getRotationDeg } from '@marionette/runtime-core';
import type { ReadonlyEmitterView } from '@marionette/runtime-core';
import { packTint } from './attachment-sprites';

// The pure SoA -> render-instance bridge (phase-3-vfx-particles.md WP-3.5 TASK-3.5.2). The EffectSystem
// solve in runtime-core writes pooled structure-of-arrays state (anchor-LOCAL particle positions plus
// the derived out* render lanes); this module turns ONE emitter view into the flat per-instance arrays a
// pooled PixiJS ParticleContainer uploads: world position (anchor applied), rotation, scale, packed tint,
// alpha, and animated frame, one entry per LIVE particle. It is the renderer-side counterpart of the
// solve, and it is the SAME module the editor viewport and runtime-web both feed (TASK-3.5.6): there is
// no second SoA-to-instance path, so the two embeddings cannot drift. The actual GL upload (creating /
// transforming pooled Sprites, the MeshRope ribbon, the screen-cover quad) is the non-headless remainder
// of WP-3.5; this bridge is the pure, conformance-checkable core of it.
//
// Allocation discipline (INV no per-frame allocation): the batch's typed arrays are pre-allocated ONCE to
// the emitter capacity and reused every frame. fillEmitterBatch writes in place and returns the live
// count; it allocates nothing, so the render update path holds zero per-frame heap after warmup.

export interface ParticleRenderBatch {
  // Sized to the emitter's pool capacity; never grown. count <= capacity entries are valid each frame.
  readonly capacity: number;
  // Number of valid (live) entries written by the last fillEmitterBatch call.
  count: number;
  // World position (the emitter anchor applied to the anchor-local solved position).
  readonly x: Float64Array;
  readonly y: Float64Array;
  // Sprite rotation in degrees (particle rotation plus the anchor's rotation).
  readonly rotationDeg: Float64Array;
  // Final scale (the solved outScale; the renderer multiplies by the region's base size).
  readonly scale: Float64Array;
  // Packed 0xRRGGBB tint (from outR/outG/outB) and 0..1 alpha (from outAlpha).
  readonly tint: Uint32Array;
  readonly alpha: Float64Array;
  // Animated-frame index (which atlas region of an animated texture to draw).
  readonly frame: Int32Array;
}

// Allocate a render batch sized to an emitter's pool capacity. Called once per emitter instance at
// trigger time (outside the per-frame hot path), mirroring the runtime-core pool allocation.
export function makeParticleRenderBatch(capacity: number): ParticleRenderBatch {
  return {
    capacity,
    count: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    rotationDeg: new Float64Array(capacity),
    scale: new Float64Array(capacity),
    tint: new Uint32Array(capacity),
    alpha: new Float64Array(capacity),
    frame: new Int32Array(capacity),
  };
}

// Fill a batch from one emitter view's live particles, applying the per-frame anchor transform. Returns
// the live count (also stored on batch.count). Allocation-free: the affine apply is inlined (no
// transformPoint tuple allocation) and the anchor rotation is decomposed ONCE for the whole batch, since
// the anchor is held constant across the frame (section 8.4). Entries are packed densely [0, count): the
// renderer iterates [0, count) and ignores stale slots beyond it.
export function fillEmitterBatch(batch: ParticleRenderBatch, view: ReadonlyEmitterView): number {
  const a = view.anchor;
  const m0 = a[0];
  const m1 = a[1];
  const m2 = a[2];
  const m3 = a[3];
  const m4 = a[4];
  const m5 = a[5];
  const anchorRotDeg = getRotationDeg(a);

  const { alive, px, py, rot, outScale, outAlpha, outR, outG, outB, frame } = view;
  let out = 0;
  for (let s = 0; s < view.capacity; s += 1) {
    if (alive[s] === 0) continue;
    const lx = px[s]!;
    const ly = py[s]!;
    // Inlined anchor apply (transformPoint without the tuple allocation).
    batch.x[out] = m0 * lx + m2 * ly + m4;
    batch.y[out] = m1 * lx + m3 * ly + m5;
    batch.rotationDeg[out] = rot[s]! + anchorRotDeg;
    batch.scale[out] = outScale[s]!;
    batch.tint[out] = packTint(outR[s]!, outG[s]!, outB[s]!);
    batch.alpha[out] = outAlpha[s]!;
    batch.frame[out] = frame[s]!;
    out += 1;
  }
  batch.count = out;
  return out;
}
