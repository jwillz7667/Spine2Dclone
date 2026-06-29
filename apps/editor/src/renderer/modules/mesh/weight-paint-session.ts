import {
  PaintWeightStrokeCommand,
  type BoneId,
  type History,
  type PaintMode,
  type SlotId,
  type WeightDab,
} from '../../document';

// THIN GLUE for the weight-paint tool's stroke lifecycle (WP-2.4): a stroke is ONE interaction group
// (pointer-down to pointer-up), so it opens a History interaction session, executes one
// PaintWeightStrokeCommand per dab batch (consecutive same-bone/same-mode commands coalesce into one
// memento inside the session), and closes the session as a single undo step (command-history Section 5.3,
// TASK-2.4.6). The pure brush model (weight-brush.ts) computes the WeightDab[] and is unit-tested there;
// this module is the begin/execute/end plumbing, covered by typecheck + lint. The pointer wiring and the
// per-frame dab computation live in the panel/tool .tsx; it calls these.

// An open weight-paint stroke: the active target and mode are fixed for the stroke's lifetime so every
// dab batch coalesces into one undo step. Created by beginWeightStroke, fed by paintDabs, closed by
// endWeightStroke.
export interface WeightStroke {
  readonly history: History;
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly activeBoneId: BoneId;
  readonly mode: PaintMode;
}

// Open the interaction session and return the stroke handle. The caller must pair this with
// endWeightStroke (or cancelWeightStroke) in a finally so the session is always closed.
export function beginWeightStroke(
  history: History,
  slotId: SlotId,
  attachmentName: string,
  activeBoneId: BoneId,
  mode: PaintMode,
): WeightStroke {
  history.beginInteraction();
  return { history, slotId, attachmentName, activeBoneId, mode };
}

// Apply one batch of brush dabs within the open stroke. Empty batches are skipped so a pointer-move that
// touched nothing creates no command. The PaintWeightStrokeCommand coalesces same-bone/same-mode dabs in
// the session, so a whole stroke collapses to one undo step.
export function paintDabs(stroke: WeightStroke, dabs: readonly WeightDab[]): void {
  if (dabs.length === 0) return;
  stroke.history.execute(
    new PaintWeightStrokeCommand(
      stroke.slotId,
      stroke.attachmentName,
      stroke.activeBoneId,
      dabs,
      stroke.mode,
    ),
  );
}

// Close the stroke as a single undo step labelled "Paint Weights".
export function endWeightStroke(stroke: WeightStroke): void {
  stroke.history.endInteraction('Paint Weights');
}

// Abandon the stroke (e.g. Escape mid-paint): discard the open session so nothing is pushed to the undo
// stack and the mesh returns to its pre-stroke weights.
export function cancelWeightStroke(stroke: WeightStroke): void {
  stroke.history.cancelInteraction();
}
