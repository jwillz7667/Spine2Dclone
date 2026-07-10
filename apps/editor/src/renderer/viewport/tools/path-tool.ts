import { invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import {
  AddPathCurveCommand,
  DeletePathControlPointCommand,
  MovePathControlPointCommand,
  PathError,
  documentHost,
  type SlotId,
} from '../../document';
import { usePathEditStore } from '../../editor-state/path-edit-store';
import { useSlotSelectionStore } from '../../editor-state/slot-selection-store';
import { useToolStore } from '../../editor-state/tool-store';
import { hitTestPathControlPoint, resolvePathEditTarget, type PathEditTarget } from '../path-edit';
import type { ViewportPointer, ViewportTool } from './tool';

// The path authoring tool (PP-D11 authoring surface). It edits the path attachment resolved from the slot
// selected in the inspector (resolvePathEditTarget: the active or first path attachment):
//  - click a control-point handle: select it (ephemeral store, never a command) and start a drag SESSION:
//    pointerdown opens a History interaction, each pointermove executes one MovePathControlPointCommand
//    (consecutive moves of the same point coalesce), pointerup closes it as ONE undo step (the same
//    interaction-group contract as the mesh vertex drag and the bone gizmo sessions).
//  - shift+click on empty space: append one cubic curve (AddPathCurve) and select its new end control
//    point. AddPathCurve extends the spline's tail by a straight step the author then bends; it takes no
//    location, so the click only signals intent.
//  - click empty space: clear the control-point selection.
//  - Delete/Backspace on a selected ANCHOR control point: drop that curve (DeletePathControlPoint) as one
//    undo step. Wired from keybindings.ts (like the mesh vertex delete) and guarded to anchors only, so the
//    keys stay free otherwise; the reject cases (a handle index, an out-of-range index, or the last curve)
//    are typed PathErrors surfaced once at this boundary rather than thrown into the UI.
// The tool never mutates the document outside a command and reads the model only at gesture boundaries.
// Selection/tool state lives in Zustand (the document/editor wall).
interface DragSession {
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly pointIndex: number;
  // The slot bone's inverse world (constant during the drag): world cursor -> stored local space. Captured
  // from the pure resolver so the session does not re-solve mid-drag.
  readonly boneInverse: Mat2x3;
}

export class PathTool implements ViewportTool {
  private session: DragSession | null = null;

  onPointerDown(pointer: ViewportPointer): void {
    const host = documentHost.current();
    const target = resolvePathEditTarget(
      host.model,
      useSlotSelectionStore.getState().selectedSlotId,
    );
    const pathEdit = usePathEditStore.getState();
    if (target === null) {
      pathEdit.clearPoint();
      return;
    }

    const hit = hitTestPathControlPoint(target, pointer.screenX, pointer.screenY, pointer.camera);
    if (hit !== null) {
      pathEdit.selectPoint(hit);
      host.history.beginInteraction();
      this.session = {
        slotId: target.slotId,
        attachmentName: target.attachmentName,
        pointIndex: hit,
        boneInverse: invert(target.boneWorld),
      };
      return;
    }

    if (pointer.shiftKey) {
      this.appendCurve(target);
      return;
    }

    pathEdit.clearPoint();
  }

  onPointerMove(pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    const [x, y] = transformPoint(session.boneInverse, pointer.worldX, pointer.worldY);
    documentHost
      .current()
      .history.execute(
        new MovePathControlPointCommand(
          session.slotId,
          session.attachmentName,
          session.pointIndex,
          x,
          y,
        ),
      );
  }

  onPointerUp(_pointer: ViewportPointer): void {
    if (this.session === null) return;
    this.session = null;
    documentHost.current().history.endInteraction('Move Path Point');
  }

  // Shift+click append: execute ONE AddPathCurveCommand, then select the new tail control point so the
  // author can immediately bend it. The command appends three control points; the last is the new tail
  // (an anchor for an open spline, a handle for a closed one), and either is a valid draggable point.
  private appendCurve(target: PathEditTarget): void {
    const host = documentHost.current();
    host.history.execute(new AddPathCurveCommand(target.slotId, target.attachmentName));
    const updated = resolvePathEditTarget(host.model, target.slotId);
    if (updated !== null) {
      usePathEditStore.getState().selectPoint(updated.path.vertices.length / 2 - 1);
    }
  }
}

// Pure guard for the delete gesture: a control-point index addresses an ANCHOR (a curve endpoint) only when
// it is a non-negative multiple of 3; indices 1 and 2 mod 3 are the two Bezier handles flanking an anchor.
// DeletePathControlPoint deletes an ANCHOR (collapsing its curve) and rejects a handle with
// PathError('pointRange'), so the gesture fires only on an anchor. Pure and total, unit-tested in isolation.
export function isPathAnchorIndex(pointIndex: number): boolean {
  return Number.isInteger(pointIndex) && pointIndex >= 0 && pointIndex % 3 === 0;
}

// Delete/Backspace with the path tool active drops the curve at the selected ANCHOR control point
// (DeletePathControlPoint) as one command (PP-D11 Lane D remainder). Inert unless the path tool is active
// with an anchor selected on a resolvable path attachment, so the keys stay free otherwise (mirrors
// deleteSelectedMeshVertex). The selection index is guarded against a stale value beyond the current
// control-point count (an undo can shrink the spline under a stale selection). A rejection the guard cannot
// pre-decide (the LAST curve, PathError('minCurves')) is surfaced once at this boundary, not swallowed
// silently or thrown into the UI; on success the now-gone point is cleared from the ephemeral selection.
export function deleteSelectedPathControlPoint(): void {
  if (useToolStore.getState().tool !== 'path') return;
  const selectedPoint = usePathEditStore.getState().selectedPoint;
  if (selectedPoint === null || !isPathAnchorIndex(selectedPoint)) return;

  const host = documentHost.current();
  const target = resolvePathEditTarget(host.model, useSlotSelectionStore.getState().selectedSlotId);
  if (target === null) return;
  if (selectedPoint >= target.path.vertices.length / 2) return;

  try {
    host.history.execute(
      new DeletePathControlPointCommand(target.slotId, target.attachmentName, selectedPoint),
    );
    usePathEditStore.getState().clearPoint();
  } catch (error) {
    if (error instanceof PathError) {
      console.error(`[marionette] delete path point rejected: ${error.message}`);
      return;
    }
    throw error;
  }
}
