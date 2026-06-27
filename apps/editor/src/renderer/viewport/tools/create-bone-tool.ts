import { identity, invert, transformPoint, type Mat2x3 } from '@marionette/runtime-core';
import { CreateBoneCommand, documentHost, type BoneId } from '../../document';
import { useSelectionStore } from '../../editor-state/selection-store';
import { solveWorldById } from '../scene-solve';
import type { ViewportPointer, ViewportTool } from './tool';

const RAD_TO_DEG = 180 / Math.PI;

interface CreateGesture {
  readonly parent: BoneId | null;
  // The selected bone's inverse world matrix, captured at pointerdown (the parent does not move during
  // the drag), used to pull world points back into the new bone's parent-local space.
  readonly parentInverse: Mat2x3;
  readonly originWorld: readonly [number, number];
}

// Create-by-drag (handoff 8.4): pointerdown sets the parent (the currently selected bone, or null for a
// root) and the bone origin in world space; the drag sets length and rotation; release commits EXACTLY
// ONE CreateBoneCommand through History. The bone's stored transform is parent-local, so the world
// origin and world drag endpoint are pulled back through the parent's inverse world matrix (for a root
// the parent is identity, so local == world). The CreateBoneCommand carries a selectionHint that
// selects the new bone; the DocumentHost reconciler applies it (this tool never touches selection
// directly on commit).
export class CreateBoneTool implements ViewportTool {
  private gesture: CreateGesture | null = null;

  onPointerDown(pointer: ViewportPointer): void {
    const model = documentHost.current().model;
    const parent = selectedBoneId();
    const parentWorld =
      parent === null ? identity() : (solveWorldById(model).get(parent) ?? identity());
    this.gesture = {
      parent,
      parentInverse: invert(parentWorld),
      originWorld: [pointer.worldX, pointer.worldY],
    };
  }

  onPointerMove(_pointer: ViewportPointer): void {
    // No live document mutation while dragging: the bone is committed once on release, so the create
    // gesture allocates nothing per pointer-move. A length/rotation preview can be added here later.
  }

  onPointerUp(pointer: ViewportPointer): void {
    const gesture = this.gesture;
    this.gesture = null;
    if (gesture === null) return;

    const origin = transformPoint(
      gesture.parentInverse,
      gesture.originWorld[0],
      gesture.originWorld[1],
    );
    const tip = transformPoint(gesture.parentInverse, pointer.worldX, pointer.worldY);
    const dx = tip[0] - origin[0];
    const dy = tip[1] - origin[1];
    const length = Math.hypot(dx, dy);
    const rotation = length === 0 ? 0 : Math.atan2(dy, dx) * RAD_TO_DEG;

    const document = documentHost.current();
    const boneId = document.ids.mint('bone');
    document.history.execute(
      new CreateBoneCommand(boneId, gesture.parent, {
        // Default the name to the unique minted id so the export-time name-uniqueness contract (D9)
        // holds without a counter that could collide after undo/redo or deletes; the user renames later.
        name: boneId,
        length,
        x: origin[0],
        y: origin[1],
        rotation,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      }),
    );
  }
}

function selectedBoneId(): BoneId | null {
  const ids = useSelectionStore.getState().selectedBoneIds;
  return ids.length > 0 ? ids[0]! : null;
}
