import { z } from 'zod';

// The committed anim-state scenario schema (ADR-0005 conformance family). A scenario is a deterministic,
// ordered script of AnimationState API calls and dt advances against one rig, with `capture` markers that
// record the solved pose. Every runtime (TS now, Unity/Godot in Phase 5) replays the SAME script, so the
// cross-runtime contract is the exact call sequence, not a per-runtime interpretation. Validate on import /
// fail loudly (Law 3): a malformed scenario is rejected with a typed error.

const trackIndex = z.number().int().nonnegative();

// set/crossfade may configure the two author-writable TrackEntry fields (alpha, additive) after the call.
const additive = z.boolean().optional();
const alpha = z.number().finite().optional();

const setOp = z
  .object({
    op: z.literal('set'),
    track: trackIndex,
    animation: z.string().min(1),
    loop: z.boolean(),
    additive,
    alpha,
  })
  .strict();

const crossfadeOp = z
  .object({
    op: z.literal('crossfade'),
    track: trackIndex,
    animation: z.string().min(1),
    loop: z.boolean(),
    mixDuration: z.number().finite().nonnegative(),
    additive,
    alpha,
  })
  .strict();

const queueOp = z
  .object({
    op: z.literal('queue'),
    track: trackIndex,
    animation: z.string().min(1),
    loop: z.boolean(),
    delay: z.number().finite().nonnegative(),
  })
  .strict();

const clearOp = z.object({ op: z.literal('clear'), track: trackIndex }).strict();
const advanceOp = z
  .object({ op: z.literal('advance'), dt: z.number().finite().nonnegative() })
  .strict();
const captureOp = z.object({ op: z.literal('capture'), label: z.string().optional() }).strict();

export const animStateOpSchema = z.discriminatedUnion('op', [
  setOp,
  crossfadeOp,
  queueOp,
  clearOp,
  advanceOp,
  captureOp,
]);

export const animStateScenarioSchema = z
  .object({
    scenarioId: z.string().min(1),
    rigId: z.string().min(1),
    // The scenario must produce at least one captured sample.
    ops: z.array(animStateOpSchema).min(1),
  })
  .strict()
  .superRefine((scenario, ctx) => {
    if (!scenario.ops.some((op) => op.op === 'capture')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'scenario has no capture op' });
    }
  });

export type AnimStateOp = z.infer<typeof animStateOpSchema>;
export type AnimStateScenario = z.infer<typeof animStateScenarioSchema>;

export class AnimStateScenarioValidationError extends Error {
  override readonly name = 'AnimStateScenarioValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`anim-state scenario failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

export function validateAnimStateScenario(input: unknown): AnimStateScenario {
  const result = animStateScenarioSchema.safeParse(input);
  if (!result.success) throw new AnimStateScenarioValidationError(result.error);
  return result.data;
}
