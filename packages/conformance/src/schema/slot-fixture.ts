import { z } from 'zod';

// The committed slot golden-playback fixture schema (phase-4-slot-composer.md WP-4.13, implements
// conformance WP-V.5). A slot fixture is the canonical serialized result of running the runtime-core slot
// sequencer over a committed (SpinResult, SlotScene) pair: the full `PresentationTimeline` (directives in
// the sequencer's sorted (atMs, seq) order) PLUS, for every `counterRollup` directive, its pinned
// `rollupValueAt` integer evaluated at the committed sample times. It is a NEW fixture SHAPE versus the
// skeleton pose and effects particle fixtures.
//
// Validate on import / fail loudly (Law 3): a fixture that does not match this schema is rejected with a
// typed SlotFixtureValidationError. Every object is `.strict()` so an unexpected member fails loudly until
// it is deliberately added. The data is ALL integer-ms times + integer base-unit amounts + closed string
// enums (no floats), so a committed fixture is compared by EXACT deep-equal (no epsilon): the slot
// determinism contract is byte-exact, not tolerance-bounded.

// The closed rollup CurveType the sequencer pins (runtime-core/slot rollup.ts). Mirrored as a closed enum so
// an unknown curve in a committed timeline fails loudly.
const curveTypeSchema = z.enum(['linear', 'easeInQuad', 'easeOutQuad', 'easeInOutCubic']);

// A grid-cell coordinate (integer row/col). Reused by symbolLand/symbolAnimate and the cascade directives.
const gridCellSchema = z.object({ row: z.number().int(), col: z.number().int() }).strict();

// The symbol animation phase a symbolAnimate selects (idle/anticipation/win/land).
const symbolAnimSlotSchema = z.enum(['idle', 'anticipation', 'win', 'land']);

// Where a vfxBurst / multiplierOrb anchors: a grid cell or an absolute screen position (closed union).
const gridAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cell'), row: z.number().int(), col: z.number().int() }).strict(),
  z.object({ kind: z.literal('screen'), x: z.number(), y: z.number() }).strict(),
]);

// A survivor move in a cascade drop (a symbol slides from one cell to a lower cell).
const symbolMoveSchema = z
  .object({ from: gridCellSchema, to: gridCellSchema, symbol: z.string().min(1) })
  .strict();

// Every directive carries an integer atMs and a globally unique deterministic emission index `seq`. The
// directive union below MIRRORS runtime-core/slot timeline.ts PresentationDirective EXACTLY (the closed set
// of kinds). A directive whose kind or fields drift from the sequencer's output fails this schema.
const presentationDirectiveSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('reelStop'),
      col: z.number().int(),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('symbolLand'),
      row: z.number().int(),
      col: z.number().int(),
      symbol: z.string().min(1),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('symbolAnimate'),
      row: z.number().int(),
      col: z.number().int(),
      set: symbolAnimSlotSchema,
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('vfxBurst'),
      preset: z.string().min(1),
      anchor: gridAnchorSchema,
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('counterRollup'),
      fromUnits: z.number().int(),
      toUnits: z.number().int(),
      startMs: z.number().int(),
      endMs: z.number().int(),
      curve: curveTypeSchema,
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('escalation'),
      tier: z.enum(['big', 'mega', 'epic']),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('flowEnter'),
      state: z.string().min(1),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('flowExit'),
      state: z.string().min(1),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('multiplierOrb'),
      valueX: z.number(),
      anchor: gridAnchorSchema,
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cascadeExplode'),
      // readonly to mirror runtime-core's PresentationDirective (its array fields are `readonly`), so the
      // inferred SlotTimeline type accepts a sequencer-produced timeline without a structural copy.
      cells: z.array(gridCellSchema).readonly(),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cascadeDrop'),
      moves: z.array(symbolMoveSchema).readonly(),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cascadeRefill'),
      col: z.number().int(),
      symbols: z.array(z.string().min(1)).readonly(),
      atMs: z.number().int(),
      seq: z.number().int().nonnegative(),
    })
    .strict(),
]);

export type SlotDirective = z.infer<typeof presentationDirectiveSchema>;

// The fully resolved presentation timeline for one pair: spinId (traceability), durationMs, and the sorted
// directive list.
const presentationTimelineSchema = z
  .object({
    spinId: z.string().min(1),
    durationMs: z.number().int().nonnegative(),
    directives: z.array(presentationDirectiveSchema),
  })
  .strict();

export type SlotTimeline = z.infer<typeof presentationTimelineSchema>;

// One pinned counter-rollup value sample: the displayed integer base-unit amount at a committed instant.
const rollupSampleValueSchema = z
  .object({ atMs: z.number().int().nonnegative(), value: z.number().int() })
  .strict();

export type RollupSampleValue = z.infer<typeof rollupSampleValueSchema>;

// The pinned rollup track for ONE counterRollup directive: its `seq` (the directive's globally unique index,
// tying the samples back to the exact directive) plus the per-sample-time evaluated values. Pinning these
// locks the rollup math (rollup.ts integer/fixed-point evaluation), not just the directive window: a Phase 5
// runtime that reproduces the timeline byte-for-byte but evaluates the curve differently still fails here.
const rollupTrackSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    fromUnits: z.number().int(),
    toUnits: z.number().int(),
    startMs: z.number().int(),
    endMs: z.number().int(),
    curve: curveTypeSchema,
    samples: z.array(rollupSampleValueSchema),
  })
  .strict();

export type RollupTrack = z.infer<typeof rollupTrackSchema>;

export const slotFixtureSchema = z
  .object({
    pairId: z.string().min(1),
    spinId: z.string().min(1), // the SpinResult.spinId the timeline was sequenced from
    sceneId: z.string().min(1),
    spinHash: z.string().min(1), // sha256:<hex> of the committed spin file (provenance, A.3)
    sceneHash: z.string().min(1), // sha256:<hex> of the committed scene file
    specHash: z.string().min(1), // sha256:<hex> of the committed sample-spec
    coreVersion: z.string().min(1), // provenance, not compared
    toolchain: z.string().min(1), // pinned generation toolchain id (A.7), e.g. node-22.13.1-v8
    generatedBy: z.string().min(1),
    sampleMs: z.array(z.number().int().nonnegative()).min(1), // the committed rollup sample instants
    timeline: presentationTimelineSchema,
    // One track per counterRollup directive in the timeline (sorted-order index), each pinning rollupValueAt
    // at every sampleMs. An empty array means the timeline emitted no counterRollup directive.
    rollups: z.array(rollupTrackSchema),
  })
  .strict();

export type SlotFixture = z.infer<typeof slotFixtureSchema>;

// Typed boundary error (Law 3): carries the Zod issues so a caller sees exactly which member of a malformed
// slot fixture failed.
export class SlotFixtureValidationError extends Error {
  override readonly name = 'SlotFixtureValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`slot fixture failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateSlotFixture(input: unknown): SlotFixture {
  const result = slotFixtureSchema.safeParse(input);
  if (!result.success) throw new SlotFixtureValidationError(result.error);
  return result.data;
}
