import type { ValidationReport } from '@marionette/format';

// The document error model (command-history Section 4.2, 3.5). Every failure inside the spine is a
// typed member of the DocumentError union with a stable `code` discriminant and context fields. No
// bare strings are thrown; no `catch (e: unknown)` swallows. Callers narrow on `code` or `instanceof`.

export class CommandTargetMissingError extends Error {
  override readonly name = 'CommandTargetMissingError';
  readonly code = 'COMMAND_TARGET_MISSING' as const;
  constructor(
    readonly commandKind: string,
    readonly targetId: string,
  ) {
    super(`command "${commandKind}" target "${targetId}" does not exist`);
  }
}

export class CommandNotAppliedError extends Error {
  override readonly name = 'CommandNotAppliedError';
  readonly code = 'COMMAND_NOT_APPLIED' as const;
  constructor(readonly commandKind: string) {
    super(`command "${commandKind}" was asked to undo before it was applied`);
  }
}

export class DocumentInvariantError extends Error {
  override readonly name = 'DocumentInvariantError';
  readonly code = 'DOCUMENT_INVARIANT' as const;
  constructor(reason: string) {
    super(`document invariant violated: ${reason}`);
  }
}

export class HistoryReentrancyError extends Error {
  override readonly name = 'HistoryReentrancyError';
  readonly code = 'HISTORY_REENTRANCY' as const;
  constructor(readonly commandKind: string) {
    super(
      `a History listener mutated history while committing "${commandKind}"; ` +
        'listeners must not call execute/undo/redo',
    );
  }
}

export class ExportValidationError extends Error {
  override readonly name = 'ExportValidationError';
  readonly code = 'EXPORT_VALIDATION' as const;
  constructor(readonly report: ValidationReport) {
    super(`exported document failed format validation with ${report.errors.length} error(s)`);
  }
}

// An author-time reparent that would create a cycle (a bone reparented under itself or one of its
// descendants). It is a command-level guard surfaced to the UI, NOT a FormatErrorCode: the command
// throws this BEFORE any mutation, so no document change and no history entry result. The import-time
// equivalent for a hand-edited document is the format validator's BONE_ORDER_VIOLATION /
// BONE_PARENT_MISSING (a cycle cannot be topologically ordered).
export class ReparentCycleError extends Error {
  override readonly name = 'ReparentCycleError';
  readonly code = 'REPARENT_CYCLE' as const;
  constructor(
    readonly boneId: string,
    readonly newParentId: string,
  ) {
    super(`reparenting bone "${boneId}" under "${newParentId}" would create a cycle`);
  }
}

// An author-time SetAnimationDuration that would shrink an animation below its last keyframe time. A
// command-level guard surfaced to the UI, thrown BEFORE any mutation, so no document change and no
// history entry result. The import-time equivalent for a hand-edited document is the format validator's
// ANIM_DURATION (the duration must be >= the maximum keyframe time).
export class AnimationDurationError extends Error {
  override readonly name = 'AnimationDurationError';
  readonly code = 'ANIMATION_DURATION' as const;
  constructor(
    readonly animationId: string,
    readonly requestedDuration: number,
    readonly lastKeyframeTime: number,
  ) {
    super(
      `cannot set animation "${animationId}" duration to ${requestedDuration}; ` +
        `it is below the last keyframe time ${lastKeyframeTime}`,
    );
  }
}

// An author-time MoveKeyframe that would land a keyframe on a time another keyframe already occupies on
// the same channel. A command-level guard thrown BEFORE any mutation (channel times stay strictly
// ascending), so no document change and no history entry result. The UI/auto-key prevents collisions;
// this is the fail-loud backstop.
export class KeyframeCollisionError extends Error {
  override readonly name = 'KeyframeCollisionError';
  readonly code = 'KEYFRAME_COLLISION' as const;
  constructor(
    readonly keyframeId: string,
    readonly time: number,
  ) {
    super(
      `cannot move keyframe "${keyframeId}" to time ${time}; another keyframe already occupies it`,
    );
  }
}

export type DocumentError =
  | CommandTargetMissingError
  | CommandNotAppliedError
  | DocumentInvariantError
  | HistoryReentrancyError
  | ExportValidationError
  | ReparentCycleError
  | AnimationDurationError
  | KeyframeCollisionError;
