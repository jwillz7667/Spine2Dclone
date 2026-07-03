import { documentHost } from '../../document';
import { useSelectionStore } from '../../editor-state/selection-store';
import { useSlotSelectionStore } from '../../editor-state/slot-selection-store';
import { useWeightPaintStore } from '../../editor-state/weight-paint-store';
import {
  brushDab,
  neighborAverageWeights,
  type BrushVertex,
} from '../../modules/mesh/weight-brush';
import {
  beginWeightStroke,
  endWeightStroke,
  paintDabs,
  type WeightStroke,
} from '../../modules/mesh/weight-paint-session';
import { solveWorldById } from '../scene-solve';
import {
  activeBoneWeights,
  meshAdjacency,
  resolveWeightPaintTarget,
  weightedVertexWorldPositions,
} from '../weight-paint';
import type { ViewportPointer, ViewportTool } from './tool';

// The weight-paint tool (WP-2.4 authoring surface). It paints the ACTIVE bone's weight onto the selected
// slot's WEIGHTED mesh (resolveWeightPaintTarget), brushing in world space:
//  - pointerdown: resolve the target (slot-selection store) and the active bone (bone selection-store's
//    first id). If either is missing, do nothing but still set the brush hover so the cursor tracks. Else
//    open a stroke SESSION (beginWeightStroke: one History interaction, closed as ONE undo step) fixing the
//    slot, attachment, active bone, and mode for the stroke's lifetime, and apply the first dab batch.
//  - pointermove: recompute the vertex world positions and the active bone's current weights from the LIVE
//    model (weights change under the stroke), compute the brush dabs (brushDab), and execute one
//    PaintWeightStrokeCommand batch (paintDabs coalesces same-bone/same-mode dabs into the open session).
//    The hover is updated every move for the brush cursor.
//  - pointerup: close the stroke (endWeightStroke) as one undo step.
// The mode is read from the store AT pointer-down and frozen on the stroke, so a mid-gesture mode toggle
// cannot split the coalesced stroke; radius and strength are read live (they do not affect coalescing). The
// tool never mutates the document outside a command (Law 2) and reads the model only at gesture events.
export class WeightPaintTool implements ViewportTool {
  private stroke: WeightStroke | null = null;

  onPointerDown(pointer: ViewportPointer): void {
    useWeightPaintStore.getState().setHoverWorld([pointer.worldX, pointer.worldY]);

    const host = documentHost.current();
    const target = resolveWeightPaintTarget(
      host.model,
      useSlotSelectionStore.getState().selectedSlotId,
    );
    const activeBoneId = useSelectionStore.getState().selectedBoneIds[0];
    if (target === null || activeBoneId === undefined) return;

    this.stroke = beginWeightStroke(
      host.history,
      target.slotId,
      target.attachmentName,
      activeBoneId,
      useWeightPaintStore.getState().mode,
    );
    this.paint(pointer);
  }

  onPointerMove(pointer: ViewportPointer): void {
    useWeightPaintStore.getState().setHoverWorld([pointer.worldX, pointer.worldY]);
    if (this.stroke === null) return;
    this.paint(pointer);
  }

  onPointerUp(_pointer: ViewportPointer): void {
    if (this.stroke === null) return;
    endWeightStroke(this.stroke);
    this.stroke = null;
  }

  // Compute and apply one dab batch from the LIVE model. The mesh is re-resolved every dab because a prior
  // dab in the same stroke already changed its weights; the brush radius converts the pixel radius to world
  // units at the current zoom so it stays a constant on-screen size. smoothTargets is built only for the
  // smooth mode (the neighbor average add/subtract never need). A target that vanished mid-stroke (e.g. the
  // slot's attachment changed under the gesture) is a no-op batch, not a crash.
  private paint(pointer: ViewportPointer): void {
    const stroke = this.stroke;
    if (stroke === null) return;
    const model = documentHost.current().model;
    const target = resolveWeightPaintTarget(model, stroke.slotId);
    if (target === null) return;

    const worldPositions = weightedVertexWorldPositions(target, solveWorldById(model));
    const vertices: BrushVertex[] = [];
    for (let i = 0; i < target.vertexCount; i += 1) {
      vertices.push({
        index: i,
        position: { x: worldPositions[i * 2]!, y: worldPositions[i * 2 + 1]! },
      });
    }

    const store = useWeightPaintStore.getState();
    const currentWeights = activeBoneWeights(target, stroke.activeBoneId);

    // smoothTargets is only meaningful (and only accepted, exactOptionalPropertyTypes) for the smooth mode.
    const dabs = brushDab({
      vertices,
      center: { x: pointer.worldX, y: pointer.worldY },
      radius: store.radiusPx / pointer.camera.zoom,
      strength: store.strength,
      mode: stroke.mode,
      currentWeights,
      ...(stroke.mode === 'smooth'
        ? {
            smoothTargets: neighborAverageWeights(
              currentWeights,
              meshAdjacency(target.triangles, target.vertexCount),
            ),
          }
        : {}),
    });
    paintDabs(stroke, dabs);
  }
}
