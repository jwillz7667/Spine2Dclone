import { z } from 'zod';
import { symbolIdSchema } from '@marionette/format/slot';

// The engine boundary schemas (phase-4 section 5.4/5.5, WP-4.1). A `SpinResult` is validated on receipt
// (LAW 3: fail loudly before any sequencing), and is the single source of truth for the inferred types
// in types.ts (z.infer). math-bridge MAY import `format` (so cells are typed as SymbolId) but `format`
// never imports math-bridge (CD-1, direction-correct). No PixiJS, no engine import here; pure shapes.
//
// Money/integer discipline: win amounts are INTEGER BASE UNITS (cents/credits as the engine reports),
// never floats, so the rollup target is exact (phase-4 section 5.4). Positions and removed cells are
// [row, col] integer pairs; bounds against a concrete grid size are checked in validate.ts (a schema
// cannot know the grid dimensions), so the schema enforces shape + integrality and the validator
// enforces bounds + the forward-cascade + cumulative structural consistency.

// A finite number; rejects NaN/Infinity (LAW 3 fail-loud on a malformed engine number).
const finite = z.number().finite();
// A non-negative integer base-unit amount (win amounts, bet).
const units = z.number().int().nonnegative();
// A non-negative integer grid index (row or column).
const index = z.number().int().nonnegative();

// A [row, col] cell coordinate. Tuple form keeps the on-the-wire shape compact and unambiguous.
export const cellSchema = z.tuple([index, index]);

// A board: rows of columns, each cell a SymbolId. Rectangularity (every row the same length) and the
// match to the declared grid size are checked in validate.ts, not here.
const boardSchema = z.array(z.array(symbolIdSchema));

// A single win: the symbol, the winning cell positions, the integer amount, and an optional line index
// (line games) for the win-sequence `byLine(index)` selector.
export const winLineSchema = z
  .object({
    symbol: symbolIdSchema,
    positions: z.array(cellSchema).min(1),
    amount: units,
    lineIndex: index.optional(),
  })
  .strict();

// A feature event. `type` is the OPEN string branch (an unknown engine feature type is accepted), but
// `data` is a CLOSED record of scalar / number-array values, so a malformed data shape (a nested object,
// a function) is rejected (WP-4.1 acceptance). The sequencer reads data by FIELD NAME (e.g. awarded
// count, multiplier value), never by re-deriving an outcome.
export const featureEventSchema = z
  .object({
    type: z.string().min(1),
    data: z.record(z.string(), z.union([finite, z.string(), z.boolean(), z.array(finite)])),
  })
  .strict();

// One cascade step: the removed cell positions, the per-column refill symbols (top-down), the integer
// win contributed by this step, and the engine's AUTHORITATIVE running total THROUGH this step
// (`cumulativeWin`, phase-4 section 5.4.3). Presentation reads `cumulativeWin`, never sums `stepWin`.
export const cascadeStepSchema = z
  .object({
    removed: z.array(cellSchema),
    refill: z.array(z.object({ col: index, symbols: z.array(symbolIdSchema) }).strict()),
    stepWin: units,
    cumulativeWin: units,
  })
  .strict();

// The seed (provably-fair inputs) and the spin input. Shape is identical for the mock and the real
// engine; the scenario is NOT carried here (it is a MockMathEngine constructor argument, WP-4.2).
export const spinSeedSchema = z
  .object({
    serverSeedHash: z.string().min(1),
    clientSeed: z.string().min(1),
    nonce: z.number().int().nonnegative(),
  })
  .strict();

export const spinInputSchema = z
  .object({
    bet: units.positive(),
    seed: spinSeedSchema,
  })
  .strict();

// The engine output (phase-4 section 5.5). `initialGrid` is the board as first presented (pre-cascade);
// `grid` is the final board (post all cascades). For a non-cascade result `initialGrid` deep-equals
// `grid` (a lossless identity, not a fabrication). `cascades` is absent/empty for non-cascade results.
// `rngProof` is an opaque provably-fair proof blob (passthrough; never interpreted by presentation).
export const spinResultSchema = z
  .object({
    spinId: z.string().min(1),
    bet: units.positive(),
    initialGrid: boardSchema,
    grid: boardSchema,
    wins: z.array(winLineSchema),
    totalWin: units,
    features: z.array(featureEventSchema),
    cascades: z.array(cascadeStepSchema).optional(),
    rngProof: z.string().optional(),
  })
  .strict();
