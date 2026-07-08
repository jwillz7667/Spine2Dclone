import {
  getTranslation,
  identity,
  invert,
  transformPoint,
  type Mat2x3,
} from '@marionette/runtime-core';
import { documentHost, type BoneId } from '../../document';
import { useSelectionStore } from '../../editor-state/selection-store';
import { usePlaybackStore } from '../../editor-state/playback-store';
import { dispatchBoneTransform, type EditDispatchContext } from '../edit-dispatcher';
import type { GizmoHandle, MoveRotateGizmo } from '../gizmo/move-rotate-gizmo';
import { scaleFromDrag, type ScaleHandle } from '../gizmo/gizmo-scale';
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
  // The editor mode/auto-key context captured at pointerdown, reused for every move in this gesture so a
  // drag is consistently setup-pose or keyframe (the user cannot flip mode or scrub mid-drag).
  readonly ctx: EditDispatchContext;
}

interface RotateSession {
  readonly kind: 'rotate';
  readonly bone: BoneId;
  readonly centerWorld: readonly [number, number];
  readonly startRotation: number; // bone local rotation (deg) at pointerdown
  lastAngle: number; // last cursor angle (rad) about the center
  total: number; // accumulated signed angle (rad), continuous across the +/-pi seam
  readonly ctx: EditDispatchContext; // see MoveSession.ctx
}

interface ScaleSession {
  readonly kind: 'scale';
  readonly handle: ScaleHandle;
  readonly bone: BoneId;
  readonly originWorld: readonly [number, number]; // bone world origin at pointerdown
  // Unit world directions of the bone's local x/y axes (its world matrix columns, normalized). Fixed for
  // the drag: changing the bone's own scale never rotates these, so projecting the cursor onto them and
  // dividing by the grab projection yields a parent-rotation/scale-invariant scale factor.
  readonly axisX: readonly [number, number];
  readonly axisY: readonly [number, number];
  readonly startScaleX: number;
  readonly startScaleY: number;
  readonly grabProjX: number; // (grab - origin) . axisX at pointerdown
  readonly grabProjY: number; // (grab - origin) . axisY at pointerdown
  readonly grabDist: number; // |grab - origin| at pointerdown (uniform handle)
  readonly ctx: EditDispatchContext; // see MoveSession.ctx
}

type Session = MoveSession | RotateSession | ScaleSession;

// Select-and-move tool (handoff 8.3, 8.4). Click selects the bone under the cursor, a non-undoable
// selection-store change that is NEVER a command (the editor/document wall). With a bone selected,
// dragging a gizmo handle drives a command SESSION: pointerdown opens a History interaction (BATCH
// mode), each pointermove routes the desired local value through the SINGLE edit dispatcher
// (dispatchBoneTransform, WP-1.8) instead of constructing a bone command directly, and pointerup closes
// it as exactly ONE undo step with ONE memento per target (sessions are primary, not the time window).
// The dispatcher decides, from the captured editor context, whether the edit writes the setup pose
// (setup mode) or auto-keys a setup-relative delta at the playhead (animation mode), so this tool never
// reaches for MoveBone/RotateBone/ScaleBone itself: that keeps the dispatcher the provable sole caller of
// the bone setup-transform commands (R1.4). Move (local x/y) and rotate (local rotation) are distinct
// one-channel primitives, so a move drag never coalesces with a rotate drag.
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

    // Not on a handle: select the bone under the cursor (shift/cmd adds to the ordered multi-selection),
    // or clear when a plain click lands on empty space. An additive click on empty space leaves the
    // selection untouched so a mis-aimed shift click never wipes a multi-selection.
    const model = documentHost.current().model;
    const hit = hitTestBone(model, pointer.screenX, pointer.screenY, pointer.camera);
    const selection = useSelectionStore.getState();
    if (hit === null) {
      if (!pointer.additive) selection.clear();
    } else {
      selection.click(hit, pointer.additive);
    }
  }

  onPointerMove(pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    if (session.kind === 'move') this.applyMove(session, pointer);
    else if (session.kind === 'rotate') this.applyRotate(session, pointer);
    else this.applyScale(session, pointer);
  }

  onPointerUp(_pointer: ViewportPointer): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    documentHost.current().history.endInteraction(interactionLabel(session));
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
    const ctx = editorContext();

    documentHost.current().history.beginInteraction();

    if (handle === 'rotate') {
      this.session = {
        kind: 'rotate',
        bone,
        centerWorld: origin,
        startRotation: entity.rotation,
        lastAngle: Math.atan2(pointer.worldY - origin[1], pointer.worldX - origin[0]),
        total: 0,
        ctx,
      };
      return;
    }

    if (handle === 'scale-x' || handle === 'scale-y' || handle === 'scale-uniform') {
      const world = worldById.get(bone) ?? identity();
      const axisX = normalize(world[0], world[1]);
      const axisY = normalize(world[2], world[3]);
      const gx = pointer.worldX - origin[0];
      const gy = pointer.worldY - origin[1];
      this.session = {
        kind: 'scale',
        handle,
        bone,
        originWorld: origin,
        axisX,
        axisY,
        startScaleX: entity.scaleX,
        startScaleY: entity.scaleY,
        grabProjX: gx * axisX[0] + gy * axisX[1],
        grabProjY: gx * axisY[0] + gy * axisY[1],
        grabDist: Math.hypot(gx, gy),
        ctx,
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
      ctx,
    };
  }

  private applyMove(session: MoveSession, pointer: ViewportPointer): void {
    const targetX = pointer.worldX + session.grabWorld[0];
    const targetY = pointer.worldY + session.grabWorld[1];
    // Axis handles pin the off-axis world coordinate to the origin's; the free handle moves both.
    const worldX = session.handle === 'move-y' ? session.originWorld[0] : targetX;
    const worldY = session.handle === 'move-x' ? session.originWorld[1] : targetY;
    const local = transformPoint(session.parentInverse, worldX, worldY);
    const host = documentHost.current();
    dispatchBoneTransform(
      host.history,
      host.model,
      session.bone,
      { channel: 'translate', x: local[0], y: local[1] },
      session.ctx,
    );
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
    const host = documentHost.current();
    dispatchBoneTransform(
      host.history,
      host.model,
      session.bone,
      { channel: 'rotate', rotation },
      session.ctx,
    );
  }

  private applyScale(session: ScaleSession, pointer: ViewportPointer): void {
    const vx = pointer.worldX - session.originWorld[0];
    const vy = pointer.worldY - session.originWorld[1];
    const { scaleX, scaleY } = scaleFromDrag({
      handle: session.handle,
      startScaleX: session.startScaleX,
      startScaleY: session.startScaleY,
      grabProjX: session.grabProjX,
      grabProjY: session.grabProjY,
      grabDist: session.grabDist,
      projX: vx * session.axisX[0] + vy * session.axisX[1],
      projY: vx * session.axisY[0] + vy * session.axisY[1],
      dist: Math.hypot(vx, vy),
    });
    const host = documentHost.current();
    dispatchBoneTransform(
      host.history,
      host.model,
      session.bone,
      { channel: 'scale', scaleX, scaleY },
      session.ctx,
    );
  }
}

// Unit vector of (x, y), or (1, 0) for a degenerate zero vector (never hit in practice: a bone's world
// axis column is non-zero unless its scale is exactly zero, which the scale gizmo does not produce).
function normalize(x: number, y: number): readonly [number, number] {
  const length = Math.hypot(x, y);
  return length < 1e-9 ? [1, 0] : [x / length, y / length];
}

function selectedBoneId(): BoneId | null {
  const ids = useSelectionStore.getState().selectedBoneIds;
  return ids.length > 0 ? ids[0]! : null;
}

// Snapshot the ephemeral edit context from the playback store at gesture start (read once, not per move).
function editorContext(): EditDispatchContext {
  const state = usePlaybackStore.getState();
  return {
    mode: state.mode,
    autoKey: state.autoKey,
    activeAnimation: state.activeAnimation,
    playhead: state.playhead,
  };
}

// The undo-step label, reflecting whether the gesture wrote the setup pose or keyed the playhead. An
// autoKey-off animation gesture issues no command, so endInteraction discards this label (no undo entry).
function interactionLabel(session: Session): string {
  const keying = session.ctx.mode === 'animation';
  if (session.kind === 'move') return keying ? 'Key Bone Position' : 'Move Bone';
  if (session.kind === 'rotate') return keying ? 'Key Bone Rotation' : 'Rotate Bone';
  return keying ? 'Key Bone Scale' : 'Scale Bone';
}

// Wrap a raw angle delta into (-pi, pi] so accumulated rotation stays continuous across the seam.
function normalizeAngle(delta: number): number {
  let d = delta % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}
