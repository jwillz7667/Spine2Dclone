import {
  decompose,
  getTranslation,
  identity,
  invert,
  multiply,
  transformPoint,
  type DecomposedTransform,
  type Mat2x3,
} from '@marionette/runtime-core';
import { documentHost, type BoneId, type DocumentReadModel } from '../../document';
import { useSelectionStore } from '../../editor-state/selection-store';
import { useMarqueeStore } from '../../editor-state/marquee-store';
import { usePlaybackStore } from '../../editor-state/playback-store';
import { dispatchBoneTransform, type EditDispatchContext } from '../edit-dispatcher';
import type { GizmoHandle, MoveRotateGizmo } from '../gizmo/move-rotate-gizmo';
import { scaleFromDrag, type ScaleHandle } from '../gizmo/gizmo-scale';
import { reprojectLocal, rotationAboutPivot, scaleAboutPivot } from '../gizmo/group-transform';
import { bonesInRect, hitTestBone, solveWorldById } from '../scene-solve';
import type { ViewportPointer, ViewportTool } from './tool';

// A non-primary selected bone captured at gesture start: its world matrix, its parent world (and inverse),
// its world origin, and its decomposed start local. Rotate/scale reproject its world about the primary
// pivot; the decomposed start is the baseline the reprojected result is diffed against, so only the
// channels a gesture actually moves are dispatched (a pure translate never keys rotation/scale/shear).
interface GroupTarget {
  readonly bone: BoneId;
  readonly oldWorld: Mat2x3;
  readonly parentWorld: Mat2x3;
  readonly parentInverse: Mat2x3;
  readonly origin: readonly [number, number];
  readonly start: DecomposedTransform;
}

const CHANNEL_EPS = 1e-9;

// A drag on empty space below this screen distance is treated as a plain click (clear/deselect), not a
// marquee, so a small jitter on a deselect click does not accidentally box-select.
const MARQUEE_THRESHOLD_PX = 3;

// A marquee-select gesture in progress (dragging on empty space). It is NOT a document interaction (no
// History session): a marquee only changes the ephemeral selection, resolved on pointerup.
interface MarqueeState {
  readonly startScreen: readonly [number, number];
  readonly startWorld: readonly [number, number];
  readonly additive: boolean;
  moved: boolean;
}

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
  // Other selected bones (multi-select): translated by the SAME world delta as the primary.
  readonly others: readonly GroupTarget[];
}

interface RotateSession {
  readonly kind: 'rotate';
  readonly bone: BoneId;
  readonly centerWorld: readonly [number, number];
  readonly startRotation: number; // bone local rotation (deg) at pointerdown
  lastAngle: number; // last cursor angle (rad) about the center
  total: number; // accumulated signed angle (rad), continuous across the +/-pi seam
  readonly ctx: EditDispatchContext; // see MoveSession.ctx
  // Other selected bones (multi-select): orbited about the primary pivot (centerWorld).
  readonly others: readonly GroupTarget[];
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
  readonly axisAngle: number; // primary world x-axis angle (rad), the frame the group scales along
  readonly ctx: EditDispatchContext; // see MoveSession.ctx
  // Other selected bones (multi-select): scaled about the primary pivot along its axes.
  readonly others: readonly GroupTarget[];
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
  private marquee: MarqueeState | null = null;

  constructor(private readonly gizmo: MoveRotateGizmo) {}

  onPointerDown(pointer: ViewportPointer): void {
    const selected = selectedBoneId();
    const handle = this.gizmo.hitTest(pointer.screenX, pointer.screenY, pointer.camera);
    if (selected !== null && handle !== 'none') {
      this.beginSession(selected, handle, pointer);
      return;
    }

    // Not on a handle: a bone under the cursor selects immediately (shift/cmd adds to the ordered
    // multi-selection); empty space begins a marquee that resolves on pointerup (a tiny drag collapses to
    // a plain deselect click). Selecting is ephemeral editor state, never a command (LAW 1).
    const model = documentHost.current().model;
    const hit = hitTestBone(model, pointer.screenX, pointer.screenY, pointer.camera);
    if (hit !== null) {
      useSelectionStore.getState().click(hit, pointer.additive);
      return;
    }
    this.marquee = {
      startScreen: [pointer.screenX, pointer.screenY],
      startWorld: [pointer.worldX, pointer.worldY],
      additive: pointer.additive,
      moved: false,
    };
  }

  onPointerMove(pointer: ViewportPointer): void {
    if (this.session !== null) {
      const session = this.session;
      if (session.kind === 'move') this.applyMove(session, pointer);
      else if (session.kind === 'rotate') this.applyRotate(session, pointer);
      else this.applyScale(session, pointer);
      return;
    }
    if (this.marquee !== null) this.updateMarquee(this.marquee, pointer);
  }

  onPointerUp(pointer: ViewportPointer): void {
    if (this.session !== null) {
      const session = this.session;
      this.session = null;
      documentHost.current().history.endInteraction(interactionLabel(session));
      return;
    }
    if (this.marquee !== null) this.finishMarquee(this.marquee, pointer);
  }

  private updateMarquee(marquee: MarqueeState, pointer: ViewportPointer): void {
    if (
      Math.hypot(
        pointer.screenX - marquee.startScreen[0],
        pointer.screenY - marquee.startScreen[1],
      ) > MARQUEE_THRESHOLD_PX
    ) {
      marquee.moved = true;
    }
    if (!marquee.moved) return;
    useMarqueeStore.getState().setRect({
      x0: marquee.startWorld[0],
      y0: marquee.startWorld[1],
      x1: pointer.worldX,
      y1: pointer.worldY,
    });
  }

  private finishMarquee(marquee: MarqueeState, pointer: ViewportPointer): void {
    this.marquee = null;
    useMarqueeStore.getState().clear();
    const selection = useSelectionStore.getState();
    if (!marquee.moved) {
      // A click on empty space: a plain click deselects; an additive click leaves the selection alone so a
      // mis-aimed shift click never wipes a multi-selection.
      if (!marquee.additive) selection.clear();
      return;
    }
    const minX = Math.min(marquee.startWorld[0], pointer.worldX);
    const maxX = Math.max(marquee.startWorld[0], pointer.worldX);
    const minY = Math.min(marquee.startWorld[1], pointer.worldY);
    const maxY = Math.max(marquee.startWorld[1], pointer.worldY);
    const hits = bonesInRect(documentHost.current().model, minX, minY, maxX, maxY);
    selection.marquee(hits, marquee.additive);
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
    const world = worldById.get(bone) ?? identity();
    const origin = getTranslation(world);
    const ctx = editorContext();
    const others = buildGroupTargets(model, worldById, bone);

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
        others,
      };
      return;
    }

    if (handle === 'scale-x' || handle === 'scale-y' || handle === 'scale-uniform') {
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
        axisAngle: Math.atan2(axisX[1], axisX[0]),
        ctx,
        others,
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
      others,
    };
  }

  private applyMove(session: MoveSession, pointer: ViewportPointer): void {
    const targetX = pointer.worldX + session.grabWorld[0];
    const targetY = pointer.worldY + session.grabWorld[1];
    // Axis handles pin the off-axis world coordinate to the origin's; the free handle moves both.
    const worldX = session.handle === 'move-y' ? session.originWorld[0] : targetX;
    const worldY = session.handle === 'move-x' ? session.originWorld[1] : targetY;
    const host = documentHost.current();
    const local = transformPoint(session.parentInverse, worldX, worldY);
    dispatchBoneTransform(
      host.history,
      host.model,
      session.bone,
      { channel: 'translate', x: local[0], y: local[1] },
      session.ctx,
    );

    // Move the rest of the selection by the SAME world delta (each in its own parent-local space).
    const deltaX = worldX - session.originWorld[0];
    const deltaY = worldY - session.originWorld[1];
    for (const target of session.others) {
      const otherLocal = transformPoint(
        target.parentInverse,
        target.origin[0] + deltaX,
        target.origin[1] + deltaY,
      );
      dispatchBoneTransform(
        host.history,
        host.model,
        target.bone,
        { channel: 'translate', x: otherLocal[0], y: otherLocal[1] },
        session.ctx,
      );
    }
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

    // Orbit the rest of the selection about the primary pivot by the same accumulated angle.
    if (session.others.length > 0) {
      const pivot = rotationAboutPivot(
        session.centerWorld[0],
        session.centerWorld[1],
        session.total,
      );
      for (const target of session.others) this.applyReprojected(target, pivot, session.ctx);
    }
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

    // Scale the rest of the selection about the primary pivot along its axes, by the same factors.
    if (session.others.length > 0) {
      const pivot = scaleAboutPivot(
        session.originWorld[0],
        session.originWorld[1],
        session.axisAngle,
        scaleX / session.startScaleX,
        scaleY / session.startScaleY,
      );
      for (const target of session.others) this.applyReprojected(target, pivot, session.ctx);
    }
  }

  // Dispatch a non-primary bone's reprojected local for a group rotate/scale. Only the channels that
  // actually moved (compared to the decomposed start) are dispatched, so a pure translation never keys
  // rotation/scale/shear and a pure rotation never keys scale/shear. Every dispatch runs on the same
  // History session, so all bones collapse to ONE composite undo step (proven by the coalesce tests).
  private applyReprojected(
    target: GroupTarget,
    pivotWorld: Mat2x3,
    ctx: EditDispatchContext,
  ): void {
    const next = reprojectLocal(pivotWorld, target.oldWorld, target.parentWorld);
    const host = documentHost.current();
    const start = target.start;
    if (differs(next.x, start.x) || differs(next.y, start.y)) {
      dispatchBoneTransform(
        host.history,
        host.model,
        target.bone,
        { channel: 'translate', x: next.x, y: next.y },
        ctx,
      );
    }
    if (differs(next.rotationDeg, start.rotationDeg)) {
      dispatchBoneTransform(
        host.history,
        host.model,
        target.bone,
        { channel: 'rotate', rotation: next.rotationDeg },
        ctx,
      );
    }
    if (differs(next.scaleX, start.scaleX) || differs(next.scaleY, start.scaleY)) {
      dispatchBoneTransform(
        host.history,
        host.model,
        target.bone,
        { channel: 'scale', scaleX: next.scaleX, scaleY: next.scaleY },
        ctx,
      );
    }
    if (differs(next.shearXDeg, start.shearXDeg) || differs(next.shearYDeg, start.shearYDeg)) {
      dispatchBoneTransform(
        host.history,
        host.model,
        target.bone,
        { channel: 'shear', shearX: next.shearXDeg, shearY: next.shearYDeg },
        ctx,
      );
    }
  }
}

// Capture the non-primary selected bones at gesture start (multi-select). Skips the primary and any id
// that no longer solves. The decomposed start local is the baseline applyReprojected diffs against.
function buildGroupTargets(
  model: DocumentReadModel,
  worldById: Map<BoneId, Mat2x3>,
  primary: BoneId,
): readonly GroupTarget[] {
  const ids = useSelectionStore.getState().selectedBoneIds;
  const targets: GroupTarget[] = [];
  for (const id of ids) {
    if (id === primary) continue;
    const entity = model.getBone(id);
    const oldWorld = worldById.get(id);
    if (entity === undefined || oldWorld === undefined) continue;
    const parentWorld =
      entity.parent === null ? identity() : (worldById.get(entity.parent) ?? identity());
    const parentInverse = invert(parentWorld);
    targets.push({
      bone: id,
      oldWorld,
      parentWorld,
      parentInverse,
      origin: getTranslation(oldWorld),
      start: decompose(multiply(parentInverse, oldWorld)),
    });
  }
  return targets;
}

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > CHANNEL_EPS;
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
