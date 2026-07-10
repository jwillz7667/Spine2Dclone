import { invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import {
  AddPathCurveCommand,
  MovePathControlPointCommand,
  documentHost,
  type SlotId,
} from '../../document';
import { usePathEditStore } from '../../editor-state/path-edit-store';
import { useSlotSelectionStore } from '../../editor-state/slot-selection-store';
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
// Control-point DELETION is intentionally absent: no delete-path-control-point command exists in
// document-core, so the tool offers no gesture that would have to mutate the document outside a command
// (Law 2). The tool never mutates the document outside a command and reads the model only at gesture
// boundaries. Selection/tool state lives in Zustand (the document/editor wall).
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
