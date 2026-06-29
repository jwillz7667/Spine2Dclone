import { z } from 'zod';

// FeatureFlowGraph (format-contract section 15.3). MINIMAL-BUT-VALID shape only. WP-4.9 OWNS and GROWS
// this: the full state machine (free-spin / bonus / retrigger states, guarded transitions, cinematic
// directives) is WP-4.9's job and is NOT invented here. The minimal valid form is a single `base` node
// graph: `entry: 'base'`, `states.base`, and no transitions. The job now is only to let the
// smallest-valid SlotScene validate and to give the validator a node that can reference a VFX preset.
//
// A node may carry an optional `cinematic` that names a VFX preset; when present the validator checks
// it resolves to a refs.vfxPresets[].name (format-contract section 15.4).
export const featureFlowCinematicSchema = z
  .object({
    vfxPreset: z.string().min(1).optional(),
  })
  .strict();

export type FeatureFlowCinematic = z.infer<typeof featureFlowCinematicSchema>;

export const featureFlowNodeSchema = z
  .object({
    cinematic: featureFlowCinematicSchema.optional(),
  })
  .strict();

export type FeatureFlowNode = z.infer<typeof featureFlowNodeSchema>;

// A transition names a source and target node by key. The full guard / event vocabulary is WP-4.9.
export const featureFlowTransitionSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

export type FeatureFlowTransition = z.infer<typeof featureFlowTransitionSchema>;

export const featureFlowGraphSchema = z
  .object({
    states: z.record(z.string(), featureFlowNodeSchema),
    transitions: z.array(featureFlowTransitionSchema),
    entry: z.string().min(1),
  })
  .strict();

export type FeatureFlowGraph = z.infer<typeof featureFlowGraphSchema>;
