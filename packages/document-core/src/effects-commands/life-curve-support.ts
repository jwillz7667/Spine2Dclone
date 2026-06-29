import type { CurveType } from '@marionette/format/effects-types';
import { EffectEditError } from '../command/errors';
import type {
  EffectLayerEntity,
  EffectLifeStopEntity,
  LifeCurveField,
  LifeStopValue,
} from '../effects-model/effects-state';
import type { LifeStopId } from '../model/ids';

// Shared helpers for the five life-curve commands (AddLifeStop / RemoveLifeStop / MoveLifeStop /
// SetLifeStopValue / SetLifeStopCurve). A stop is addressed by LifeStopId alone (section 10 command
// table); since a layer holds several curves, these helpers locate which curve field a stop lives in by
// scanning the layer's curves (stop ids are unique within their layer, minted per import / per AddLifeStop).

export interface LocatedStop {
  readonly field: LifeCurveField;
  readonly stops: readonly EffectLifeStopEntity[];
  readonly index: number;
  readonly stop: EffectLifeStopEntity;
}

// Find the curve field and array index of a LifeStopId within a layer, or null when the layer has no such
// stop. Used by every curve command to resolve its target without the caller passing the field.
export function locateStop(layer: EffectLayerEntity, stopId: LifeStopId): LocatedStop | null {
  for (const [field, curve] of layer.curves) {
    const index = curve.stops.findIndex((stop) => stop.id === stopId);
    if (index >= 0) {
      const stop = curve.stops[index];
      if (stop) return { field, stops: curve.stops, index, stop };
    }
  }
  return null;
}

// Validate a candidate stop list against the LifeCurve contract (phase-3 section 8.1 / WP-3.0
// LIFECURVE_STOP_ORDER): at least two stops, first.t === 0, last.t === 1, and strictly ascending t. Throws
// a typed EffectEditError (lifeStopOrder / lifeCurveMinStops) BEFORE any mutation, so a rejected edit
// leaves no document change. This is the command-boundary form of the format validator's order check.
export function assertValidStopOrder(stops: readonly EffectLifeStopEntity[]): void {
  if (stops.length < 2) {
    throw new EffectEditError(
      'lifeCurveMinStops',
      `a life curve needs at least 2 stops, got ${stops.length}`,
    );
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first && first.t !== 0) {
    throw new EffectEditError('lifeStopOrder', `first stop t must be 0, got ${first.t}`);
  }
  if (last && last.t !== 1) {
    throw new EffectEditError('lifeStopOrder', `last stop t must be 1, got ${last.t}`);
  }
  for (let i = 1; i < stops.length; i += 1) {
    const previous = stops[i - 1];
    const current = stops[i];
    if (previous && current && current.t <= previous.t) {
      throw new EffectEditError(
        'lifeStopOrder',
        `stop t must strictly ascend, ${current.t} does not follow ${previous.t}`,
      );
    }
  }
}

// Re-export the value/curve types the curve commands construct against, so each command file has one import
// site for the life-curve shapes.
export type { CurveType, LifeStopValue, LifeCurveField };
