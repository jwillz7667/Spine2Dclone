import {
  getTranslation,
  identity,
  invert,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { MoveBoneCommand, RotateBoneCommand, documentHost, type BoneId } from '../../document';
import { useSelectionStore } from '../../editor-state/selection-store';
import type { GizmoHandle, MoveRotateGizmo } from '../gizmo/move-rotate-gizmo';
import { hitTestBone, solveWorldById } from '../scene-solve';
import type { ViewportPointer, ViewportTool } from './tool';

const RAD_TO_DEG = 180 / Math.PI;
const TWO_PI = Math.PI * 2;

interface MoveSession {
  readonly kind: 'move';
  readonly handle: 'move-x' | 'move-y' | 'move-free';
  readonly bone: BoneId;
  // The parent's inverse world matrix (constant during the drag), used to convert a world target back
  // into the bone's parent-local x/y (the space MoveBone stores).
  readonly parentInverse: Mat2x3;
  readonly originWorld: readonly [number, number]; // bone world origin at pointerdown (axis constraint)
  readonly grabWorld: readonly [number, number]; // boneOrigin - cursor at pointerdown (no-jump grab)
}

interface RotateSession {
  readonly kind: 'rotate';
  readonly bone: BoneId;
  readonly centerWorld: readonly [number, number];
  readonly startRotation: number; // bone local rotation (deg) at pointerdown
  lastAngle: number; // last cursor angle (rad) about the center
  total: number; // accumulated signed angle (rad), continuous across the +/-pi seam
}

type Session = MoveSession | RotateSession;

// Select-and-move tool (handoff 8.3, 8.4). Click selects the bone under the cursor, a non-undoable
// selection-store change that is NEVER a command (the editor/document wall). With a bone selected,
// dragging a gizmo handle drives a command SESSION: pointerdown opens a History interaction (BATCH
// mode), each pointermove issues an absolute MoveBone or RotateBone that coalesces into the session,
// and pointerup closes it as exactly ONE undo step with ONE memento per target (sessions are primary,
// not the time window). Move (local x/y) and rotate (local rotation) are distinct one-channel
// primitives, so a move drag never coalesces with a rotate drag.
export class SelectMoveTool implements ViewportTool {
  private session: Session | null = null;

  constructor(private readonly gizmo: MoveRotateGizmo) {}

  onPointerDown(pointer: ViewportPointer): void {
    const selected = selectedBoneId();
    const handle = this.gizmo.hitTest(pointer.screenX, pointer.screenY, pointer.camera);
    if (selected !== null && handle !== 'none') {
      this.beginSession(selected, handle, pointer);
      return;
    }

    // Not on a handle: select the bone under the cursor, or clear when clicking empty space.
    const model = documentHost.current().model;
    const hit = hitTestBone(model, pointer.screenX, pointer.screenY, pointer.camera);
    const selection = useSelectionStore.getState();
    if (hit === null) selection.clear();
    else selection.select([hit]);
  }

  onPointerMove(pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    if (session.kind === 'move') this.applyMove(session, pointer);
    else this.applyRotate(session, pointer);
  }

  onPointerUp(_pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    const label = session.kind === 'move' ? 'Move Bone' : 'Rotate Bone';
    documentHost.current().history.endInteraction(label);
  }

  private beginSession(
    bone: BoneId,
    handle: Exclude<GizmoHandle, 'none'>,
    pointer: ViewportPointer,
  ): void {
    const model = documentHost.current().model;
    const entity = model.getBone(bone);
    if (entity === undefined) return;

    const worldById = solveWorldById(model);
    const origin = getTranslation(worldById.get(bone) ?? identity());

    documentHost.current().history.beginInteraction();

    if (handle === 'rotate') {
      this.session = {
        kind: 'rotate',
        bone,
        centerWorld: origin,
        startRotation: entity.rotation,
        lastAngle: Math.atan2(pointer.worldY - origin[1], pointer.worldX - origin[0]),
        total: 0,
      };
      return;
    }

    const parentWorld =
      entity.parent === null ? identity() : (worldById.get(entity.parent) ?? identity());
    this.session = {
      kind: 'move',
      handle,
      bone,
      parentInverse: invert(parentWorld),
      originWorld: origin,
      grabWorld: [origin[0] - pointer.worldX, origin[1] - pointer.worldY],
    };
  }

  private applyMove(session: MoveSession, pointer: ViewportPointer): void {
    const targetX = pointer.worldX + session.grabWorld[0];
    const targetY = pointer.worldY + session.grabWorld[1];
    // Axis handles pin the off-axis world coordinate to the origin's; the free handle moves both.
    const worldX = session.handle === 'move-y' ? session.originWorld[0] : targetX;
    const worldY = session.handle === 'move-x' ? session.originWorld[1] : targetY;
    const local = transformPoint(session.parentInverse, worldX, worldY);
    documentHost
      .current()
      .history.execute(new MoveBoneCommand(session.bone, { x: local[0], y: local[1] }));
  }

  private applyRotate(session: RotateSession, pointer: ViewportPointer): void {
    const angle = Math.atan2(
      pointer.worldY - session.centerWorld[1],
      pointer.worldX - session.centerWorld[0],
    );
    // Accumulate normalized deltas so a drag past +/-180 degrees keeps rotating continuously instead of
    // snapping back across the atan2 seam.
    session.total += normalizeAngle(angle - session.lastAngle);
    session.lastAngle = angle;
    const rotation = session.startRotation + session.total * RAD_TO_DEG;
    documentHost.current().history.execute(new RotateBoneCommand(session.bone, rotation));
  }
}

function selectedBoneId(): BoneId | null {
  const ids = useSelectionStore.getState().selectedBoneIds;
  return ids.length > 0 ? ids[0]! : null;
}

// Wrap a raw angle delta into (-pi, pi] so accumulated rotation stays continuous across the seam.
function normalizeAngle(delta: number): number {
  let d = delta % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}
