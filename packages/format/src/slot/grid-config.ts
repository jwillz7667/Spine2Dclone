import { z } from 'zod';
import { symbolIdSchema } from './symbol-id';

// Grid / reel geometry, timing, gravity, and anticipation for the slot scene (format-contract section
// 15.3, phase-4 WP-4.5). WP-4.5 is the SOLE owner of this module and lands the COMPLETE schema (not a
// minimal stub): GridConfig carries rich topology/dims/gravity/anticipation invariants, so a half-owned
// schema would invite drift. The cross-field semantic invariants (topology/dims consistency,
// gravity/topology consistency, anticipation bounds against cols) live in the validator's semantic
// layer, not here, so this module only encodes the closed shapes and per-field scalar bounds.
//
// LAW 1: there is NO symbol-placement and NO symbol-source field anywhere in GridConfig. The board is
// RNG-driven by the engine at runtime (SpinResult), never authored here.

// Grid topologies the slot composer supports (format-contract section 15.3). A closed enum: an unknown
// topology is a shape fault (SLOT_SCHEMA_SHAPE).
export const gridTopologySchema = z.enum(['reelStrip', 'scatterPay', 'cluster']);

export type GridTopology = z.infer<typeof gridTopologySchema>;

// The documented forward cascade rule (phase-4 section 5.5.1). Closed enum.
export const gravityRuleSchema = z.enum(['column-down', 'cluster-down']);

export type GravityRule = z.infer<typeof gravityRuleSchema>;

// A finite, non-negative integer (cell metrics, stop stagger). reelStopStaggerMs may be 0.
const nonNegativeInt = z.number().int().nonnegative();

// A finite, positive integer (cell width/height must be > 0).
const positiveInt = z.number().int().positive();

// A finite integer (no sign bound). The anticipation bounds (>= 1, <= cols) are enforced SEMANTICALLY
// so each violation surfaces its own typed code (anticipationThreshold, anticipationColsOutOfRange)
// with a JSON path, rather than collapsing into a generic shape fault.
const finiteInt = z.number().int().finite();

// Cols and rows are bounded to [1, 12] structurally (format-contract section 15.4); the per-topology
// refinements (reelStrip rows in [2, 6], scatterPay cols in [5, 7], cluster square) are semantic.
const gridDimension = z.number().int().min(1).max(12);

// AnticipationConfig (format-contract section 15.3, phase-4 WP-4.5). Deterministic, fed by the engine
// board only (phase-4 section 10.4): the author sets the trigger vocabulary, the threshold, and the
// cap; the counts come from SpinResult at runtime. The shape here is closed and scalar-typed; the
// invariants (triggerSymbols non-empty, thresholdCount >= 1, maxAnticipatingCols in [1, cols]) are
// SEMANTIC (format-contract section 15.4), enforced in the validator so each carries its own typed
// code and path. maxAnticipatingCols <= cols in particular depends on the sibling grid field.
export const anticipationConfigSchema = z
  .object({
    // Scatter / trigger ids (the math model's known vocabulary). Non-empty is a semantic check.
    triggerSymbols: z.array(symbolIdSchema),
    // Start anticipating once this many trigger symbols have landed in stopped columns (>= 1 semantic).
    thresholdCount: finiteInt,
    // Cap on simultaneously anticipating not-yet-stopped columns ([1, cols] semantic).
    maxAnticipatingCols: finiteInt,
  })
  .strict();

export type AnticipationConfig = z.infer<typeof anticipationConfigSchema>;

// GridConfig (format-contract section 15.3). Closed (.strict()) so an unknown key (in particular any
// attempt to smuggle in a symbol-placement field) fails as SLOT_SCHEMA_SHAPE.
export const gridConfigSchema = z
  .object({
    topology: gridTopologySchema,
    cols: gridDimension,
    rows: gridDimension,
    cellWidth: positiveInt,
    cellHeight: positiveInt,
    cellGap: nonNegativeInt,
    // Per-column stop delay (timing only), integer ms, may be 0.
    reelStopStaggerMs: nonNegativeInt,
    gravity: gravityRuleSchema,
    anticipation: anticipationConfigSchema,
  })
  .strict();

export type GridConfig = z.infer<typeof gridConfigSchema>;
