import {
  MoveBoneCommand,
  RotateBoneCommand,
  ScaleBoneCommand,
  SetBoneShearCommand,
  SetKeyframeCommand,
  type AnimationId,
  type BoneId,
  type Command,
  type DocumentReadModel,
  type History,
  type KeyframeTarget,
} from '../document';
import type { PlaybackMode } from '../editor-state/playback-store';
import { setupDelta, type BoneTransformEdit } from './setup-delta';

// The channels a gizmo or numeric-field edit can route to a SETUP-pose command. All four bone transform
// channels now have a setup-pose command (Move/Rotate/Scale/SetBoneShear, PP-D1), so the dispatcher is
// total over BoneTransformEdit and setupDelta's inverse (which was already total) is fully reachable.
export type DispatchableBoneEdit = BoneTransformEdit;

// The ephemeral editor state the dispatcher routes on (section 6), passed EXPLICITLY (no hidden global,
// no Zustand reach-in here): mode picks setup-vs-keyframe, autoKey gates keying, and activeAnimation +
// playhead address the keyframe. The caller (the tool) reads these from the playback store and hands
// them in, which keeps the dispatcher a pure function of its inputs and trivially testable.
export interface EditDispatchContext {
  readonly mode: PlaybackMode;
  readonly autoKey: boolean;
  readonly activeAnimation: AnimationId | null;
  readonly playhead: number;
}

// What the dispatcher did, so the tool/UI can reflect it and tests can assert the routing without
// reaching into History internals. Exactly one outcome per call; only 'setup' and 'keyed' mutate.
export type EditOutcome =
  | { readonly kind: 'setup' } // issued a setup-pose command (Move / Rotate / Scale / SetBoneShear)
  | { readonly kind: 'keyed' } // issued a SetKeyframe at the playhead (the setup-relative delta)
  | { readonly kind: 'not-keying' } // animation mode, autoKey off: no command, no mutation
  | { readonly kind: 'no-active-animation' } // animation mode, autoKey on, no active animation: no-op
  | { readonly kind: 'no-target' }; // the bone no longer resolves (defensive, mid-gesture): no-op

// The SINGLE edit path (TASK-1.8.1 / 1.8.5): the ONLY code that turns a gizmo bone-transform edit into a
// setup-pose command OR a keyframe command. In `setup` mode it issues the setup-pose command for the
// channel. In `animation` mode with autoKey on and an active animation it stores the setup-relative DELTA
// (setupDelta, the exact inverse of the sampler) as a SetKeyframe at the playhead, which SetKeyframe
// inserts-or-updates in place. With autoKey off it does nothing and reports it so the UI can show "not
// keying". Every mutation is a Command on the passed History (LAW 2); a drag collapses to one coalesced
// undo step because the caller wraps the repeated calls in one History interaction session.
export function dispatchBoneTransform(
  history: History,
  model: DocumentReadModel,
  boneId: BoneId,
  edit: DispatchableBoneEdit,
  ctx: EditDispatchContext,
): EditOutcome {
  if (ctx.mode === 'setup') {
    history.execute(setupCommand(boneId, edit));
    return { kind: 'setup' };
  }

  // animation mode: edits become keyframes (the setup pose is never mutated here).
  if (!ctx.autoKey) return { kind: 'not-keying' };
  if (ctx.activeAnimation === null) return { kind: 'no-active-animation' };
  const setup = model.getBone(boneId);
  if (setup === undefined) return { kind: 'no-target' };

  const target: KeyframeTarget = { kind: 'bone', boneId, channel: edit.channel };
  const value = setupDelta(edit, setup);
  history.execute(new SetKeyframeCommand(ctx.activeAnimation, target, ctx.playhead, value));
  return { kind: 'keyed' };
}

// Build the setup-pose command for a channel. The setup commands read the bone's current field and store
// it as their own undo memento, so this only needs the target id and the desired absolute local value.
function setupCommand(boneId: BoneId, edit: DispatchableBoneEdit): Command {
  switch (edit.channel) {
    case 'rotate':
      return new RotateBoneCommand(boneId, edit.rotation);
    case 'translate':
      return new MoveBoneCommand(boneId, { x: edit.x, y: edit.y });
    case 'scale':
      return new ScaleBoneCommand(boneId, { scaleX: edit.scaleX, scaleY: edit.scaleY });
    case 'shear':
      return new SetBoneShearCommand(boneId, { shearX: edit.shearX, shearY: edit.shearY });
  }
}
