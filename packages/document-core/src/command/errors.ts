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

export type DocumentError =
  | CommandTargetMissingError
  | CommandNotAppliedError
  | DocumentInvariantError
  | HistoryReentrancyError
  | ExportValidationError;
