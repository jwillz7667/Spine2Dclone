import { z } from 'zod';

// FeatureFlowGraph (format-contract section 15.3, phase-4 WP-4.9). WP-4.9 OWNS and FINALIZES this: the
// state machine that drives free-spin / bonus / retrigger presentation from `SpinResult.features`. A node
// (`base`, `freeSpinIntro`, `freeSpins`, `freeSpinOutro`, plus custom) carries an optional cinematic (a
// VFX-preset / animation reference, resolved by name); a transition `{ from, on, to }` is taken when a
// FeatureEvent matches its `on` predicate. LAW 1 holds structurally: `FeatureMatch` names a feature TYPE
// and (optionally) a `data` FIELD NAME plus a constant; it never embeds an outcome VALUE the presentation
// decides. The deterministic walk that turns this graph plus a SpinResult into flowEnter/flowExit/
// multiplierOrb directives lives in runtime-core/slot (sequence.ts), not here.
//
// The slot contract is authored across WP-4.4..4.10 at slotSceneFormatVersion 0.1.0 (the initial contract,
// not a released-then-broken one), so finalizing this sub-schema does not bump the version. The
// minimal-but-valid form stays representable: `{ states: { base: {} }, transitions: [], entry: 'base' }`.

// A FeatureMatch matches a FeatureEvent by `type` and, optionally, by requiring one `data` FIELD to equal a
// LITERAL constant (a field name + a number/string/boolean constant, e.g. { field: 'tier', equals: 'super' }).
// This is authoring DATA only: it stores a field NAME and a constant the author types, never an outcome value
// the presentation derives (LAW 1). The shape is closed and small (no nested predicates, no operators beyond
// equality) so the cross-runtime match rule stays a single equality check.
export const featureMatchSchema = z
  .object({
    type: z.string().min(1),
    dataEquals: z
      .object({
        field: z.string().min(1),
        equals: z.union([z.number(), z.string(), z.boolean()]),
      })
      .strict()
      .optional(),
  })
  .strict();

export type FeatureMatch = z.infer<typeof featureMatchSchema>;

// A node's optional cinematic bundle: a VFX preset name (resolved against refs.vfxPresets by the semantic
// validator, checkVfxRefs) and/or an animation name. Both are by-name references; neither embeds an outcome.
export const featureFlowCinematicSchema = z
  .object({
    vfxPreset: z.string().min(1).optional(),
    animation: z.string().min(1).optional(),
  })
  .strict();

export type FeatureFlowCinematic = z.infer<typeof featureFlowCinematicSchema>;

export const featureFlowNodeSchema = z
  .object({
    cinematic: featureFlowCinematicSchema.optional(),
  })
  .strict();

export type FeatureFlowNode = z.infer<typeof featureFlowNodeSchema>;

// A transition names a source node by key (`from`), the FeatureMatch that fires it (`on`), and the target
// node by key (`to`). The graph-integrity checks (no transition from/to a missing state) live in the
// semantic validator, not the schema (a schema cannot cross-check keys against the states record).
export const featureFlowTransitionSchema = z
  .object({
    from: z.string().min(1),
    on: featureMatchSchema,
    to: z.string().min(1),
  })
  .strict();

export type FeatureFlowTransition = z.infer<typeof featureFlowTransitionSchema>;

// The full FeatureFlowGraph: the named states, the ordered transitions, and the single entry node. The
// entry MUST be 'base' and `states.base` MUST exist (validated by the semantic checkFeatureFlow family; the
// schema enforces only shape, mirroring how winSequencer.defaultSequence resolution is a validator concern).
export const featureFlowGraphSchema = z
  .object({
    states: z.record(z.string(), featureFlowNodeSchema),
    transitions: z.array(featureFlowTransitionSchema),
    entry: z.string().min(1),
  })
  .strict();

export type FeatureFlowGraph = z.infer<typeof featureFlowGraphSchema>;
