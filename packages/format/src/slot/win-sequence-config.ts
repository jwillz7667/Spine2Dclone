import { z } from 'zod';
import { symbolIdSchema } from './symbol-id';
import { rollupCurveSchema } from './tumble-choreography';

// WinSequenceConfig (format-contract section 15.3, phase-4 WP-4.8). The FULL authored win-presentation
// contract: named win sequences keyed by name, the escalation threshold table (big/mega/epic as
// totalWin/bet multiples), and the deterministic default-sequence selector. WP-4.8 OWNS and finalized
// this schema (it was a minimal-but-valid placeholder through WP-4.4..4.7). The schema stores authoring
// DATA only: it names SpinResult FIELD selectors (a line index, a symbol id) and visual actions, never an
// outcome VALUE (LAW 1). The deterministic emit/sort that turns this config plus a SpinResult into the
// PresentationTimeline lives in runtime-core/slot (sequence.ts), not here.
//
// The slot contract is authored across WP-4.4..4.10 at slotSceneFormatVersion 0.1.0 (the initial contract,
// not a released-then-broken one), so growing this sub-schema does not bump the version.

// The escalation tier a banner step announces, and the tier the threshold table is keyed by. Ascending
// magnitude: big < mega < epic.
export const escalationTierSchema = z.enum(['big', 'mega', 'epic']);

export type EscalationTier = z.infer<typeof escalationTierSchema>;

// Which cells a step targets, by RULE (never by an authored board position): the union of all winning
// cells, the cells of one pay line by index, or the cells of every win on one symbol. The selectors name
// SpinResult.wins FIELD NAMES (lineIndex, symbol) and are resolved against the engine outcome at sequence
// time; no outcome value is embedded here (LAW 1). `index` is a non-negative integer line index.
export const winTargetRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allWinningCells') }).strict(),
  z.object({ kind: z.literal('byLine'), index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('bySymbol'), symbol: symbolIdSchema }).strict(),
]);

export type WinTargetRule = z.infer<typeof winTargetRuleSchema>;

// What a step DOES to its targeted cells: play the win animation, fire a named VFX preset (anchored per
// cell or at the grid center), start the single line-win counter rollup on a named curve, or show an
// escalation banner. The `preset` name is checked against refs.vfxPresets by the semantic validator. The
// `curve` is the closed rollup CurveType (reused from tumble-choreography so the format has ONE closed
// curve enum; the evaluation function lives in runtime-core). An escalationBanner action records authoring
// intent; the timeline's escalation directives are driven by the threshold table at sequence time
// (runtime-core stage 6), so the tier here is documentation of the authored placement.
export const winStepActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('animateWin') }).strict(),
  z
    .object({
      kind: z.literal('vfx'),
      preset: z.string().min(1),
      anchorRule: z.enum(['eachCell', 'gridCenter']),
    })
    .strict(),
  z.object({ kind: z.literal('rollupStart'), curve: rollupCurveSchema }).strict(),
  z.object({ kind: z.literal('escalationBanner'), tier: escalationTierSchema }).strict(),
]);

export type WinStepAction = z.infer<typeof winStepActionSchema>;

// One authored step: an integer-ms offset from the sequence start (>= 0), a target rule, and an action.
export const winSequenceStepSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    target: winTargetRuleSchema,
    action: winStepActionSchema,
  })
  .strict();

export type WinSequenceStep = z.infer<typeof winSequenceStepSchema>;

// One named sequence: a (possibly empty) ordered list of steps walked in AUTHORED order at sequence time.
export const winSequenceSchema = z
  .object({
    steps: z.array(winSequenceStepSchema),
  })
  .strict();

export type WinSequence = z.infer<typeof winSequenceSchema>;

// The escalation threshold table: big/mega/epic as totalWin/bet MULTIPLES (a tier is crossed when
// totalWin >= tier * bet, an integer-safe comparison the sequencer makes without float division). Each is
// a non-negative finite number; the table does not assert big <= mega <= epic (an author may pin any
// order; the sequencer emits one directive per crossed tier independently).
export const escalationThresholdsSchema = z
  .object({
    big: z.number().nonnegative().finite(),
    mega: z.number().nonnegative().finite(),
    epic: z.number().nonnegative().finite(),
  })
  .strict();

export type EscalationThresholds = z.infer<typeof escalationThresholdsSchema>;

// The full WinSequenceConfig: the named sequences, the threshold table, and the default sequence name
// selected when no tier-specific sequence matches. `defaultSequence` is a name; whether it resolves to a
// member of `sequences` is a sequencer concern (an unknown name selects an empty step list, never a
// throw), so the schema does not cross-check it (mirroring how featureFlows.entry is name-only).
export const winSequenceConfigSchema = z
  .object({
    sequences: z.record(z.string(), winSequenceSchema),
    thresholds: escalationThresholdsSchema,
    defaultSequence: z.string().min(1),
  })
  .strict();

export type WinSequenceConfig = z.infer<typeof winSequenceConfigSchema>;
