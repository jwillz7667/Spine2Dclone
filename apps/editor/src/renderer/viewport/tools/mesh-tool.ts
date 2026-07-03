import { invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import {
  AddMeshVertexCommand,
  MoveMeshVertexCommand,
  documentHost,
  type SlotId,
} from '../../document';
import { useMeshEditStore } from '../../editor-state/mesh-edit-store';
import { useSlotSelectionStore } from '../../editor-state/slot-selection-store';
import { addInteriorVertex } from '../../modules/mesh/topology-edit';
import { MeshError } from '../../modules/mesh/mesh-error';
import { hitTestMeshVertex, resolveMeshEditTarget, type MeshEditTarget } from '../mesh-edit';
import type { ViewportPointer, ViewportTool } from './tool';

// The mesh editing tool (WP-2.1 authoring surface). It edits the mesh resolved from the slot selected
// in the inspector (resolveMeshEditTarget: the active or first UNWEIGHTED mesh attachment):
//  - click a vertex handle: select it (ephemeral store, never a command) and start a drag SESSION:
//    pointerdown opens a History interaction, each pointermove executes one MoveMeshVertexCommand
//    (consecutive moves of the same vertex coalesce), pointerup closes it as ONE undo step
//    (TASK-2.1.2's interaction-group contract, the same shape as the bone gizmo sessions).
//  - shift+click inside the mesh: add an interior vertex there (uv-interpolated, re-triangulated by
//    the pure topology-edit module) as a single AddMeshVertexCommand, then select the new vertex.
//  - click empty space: clear the vertex selection.
// Vertex DELETION is a keybinding (Delete/Backspace in keybindings.ts), not a gesture. The tool never
// mutates the document outside a command (Law 2) and reads the model only at gesture boundaries.
interface DragSession {
  readonly slotId: SlotId;
  readonly attachmentName: string;
  readonly vertexIndex: number;
  // The slot bone's inverse world (constant during the drag): world cursor -> stored local space.
  readonly boneInverse: Mat2x3;
}

export class MeshTool implements ViewportTool {
  private session: DragSession | null = null;

  onPointerDown(pointer: ViewportPointer): void {
    const host = documentHost.current();
    const target = resolveMeshEditTarget(
      host.model,
      useSlotSelectionStore.getState().selectedSlotId,
    );
    const meshEdit = useMeshEditStore.getState();
    if (target === null) {
      meshEdit.clearVertex();
      return;
    }

    const hit = hitTestMeshVertex(target, pointer.screenX, pointer.screenY, pointer.camera);
    if (hit !== null) {
      meshEdit.selectVertex(hit);
      host.history.beginInteraction();
      this.session = {
        slotId: target.slotId,
        attachmentName: target.attachmentName,
        vertexIndex: hit,
        boneInverse: invert(target.boneWorld),
      };
      return;
    }

    if (pointer.shiftKey) {
      this.addVertexAt(target, pointer);
      return;
    }

    meshEdit.clearVertex();
  }

  onPointerMove(pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    const [x, y] = transformPoint(session.boneInverse, pointer.worldX, pointer.worldY);
    documentHost
      .current()
      .history.execute(
        new MoveMeshVertexCommand(
          session.slotId,
          session.attachmentName,
          session.vertexIndex,
          x,
          y,
        ),
      );
  }

  onPointerUp(_pointer: ViewportPointer): void {
    if (this.session === null) return;
    this.session = null;
    documentHost.current().history.endInteraction('Move Mesh Vertex');
  }

  // Shift+click add: compute the replacement geometry in slot-bone space and execute ONE command. A
  // click outside every triangle is a no-op by design (not an error the author needs to read); any
  // other rejection (e.g. the command's topology lock) is surfaced at this boundary.
  private addVertexAt(target: MeshEditTarget, pointer: ViewportPointer): void {
    const [x, y] = transformPoint(invert(target.boneWorld), pointer.worldX, pointer.worldY);
    let result;
    try {
      result = addInteriorVertex(target.mesh, { x, y });
    } catch (error) {
      if (error instanceof MeshError && error.code === 'outsideMesh') return;
      throw error;
    }
    documentHost
      .current()
      .history.execute(
        new AddMeshVertexCommand(
          target.slotId,
          target.attachmentName,
          result.uvs,
          result.triangles,
          result.vertices,
        ),
      );
    useMeshEditStore.getState().selectVertex(result.vertices.length / 2 - 1);
  }
}
