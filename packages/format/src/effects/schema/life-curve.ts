import { z } from 'zod';
import { curveSchema } from '../../common';
import type { CurveType } from '../../common';
import { rgbSchema } from './primitives';
import type { RGB } from './primitives';

// Over-life / over-length curves (phase-3-vfx-particles.md section 8.1, 8.5). A `LifeCurve<T>` is a
// list of stops over the normalized parameter `t` in [0, 1]. The contract requires `first.t === 0`,
// `last.t === 1`, and strictly increasing `t`; those ordering invariants are SEMANTIC checks (the
// validator reports LIFECURVE_STOP_ORDER with a JSON path), not structural, so a single bad stop is
// pinpointed rather than rejected as a generic shape error. The per-stop `t` range [0, 1] is a
// structural bound. Each stop's `curve: CurveType` reuses the shared `common` easing, and evaluation
// uses the SAME BEZIER_SEGMENTS sampling as the skeletal animation sampler (one math path, R3.6).

// A scalar over-life stop: `t` in [0, 1], a finite numeric `value`, and a `CurveType` easing.
const lifeStopNumberSchema = z
  .object({
    t: z.number().min(0).max(1),
    value: z.number().finite(),
    curve: curveSchema,
  })
  .strict();

// An RGB over-life stop: `t` in [0, 1], an RGB `value`, and a `CurveType` easing.
const lifeStopRgbSchema = z
  .object({
    t: z.number().min(0).max(1),
    value: rgbSchema,
    curve: curveSchema,
  })
  .strict();

// A `LifeCurve<number>`: the structural rule requires at least two stops (the t=0 and t=1 anchors);
// the exact first/last/strict-increasing checks are semantic.
export const lifeCurveNumberSchema = z
  .object({
    stops: z.array(lifeStopNumberSchema).min(2),
  })
  .strict();

// A `LifeCurve<RGB>` with the same two-stop structural floor.
export const lifeCurveRgbSchema = z
  .object({
    stops: z.array(lifeStopRgbSchema).min(2),
  })
  .strict();

// The shared stop type, with the value as a discriminating type parameter at the TS level.
export interface LifeStop<T> {
  readonly t: number;
  readonly value: T;
  readonly curve: CurveType;
}

export interface LifeCurve<T> {
  readonly stops: readonly LifeStop<T>[];
}

export type LifeCurveNumber = z.infer<typeof lifeCurveNumberSchema>;
export type LifeCurveRgb = z.infer<typeof lifeCurveRgbSchema>;
export type { RGB };
