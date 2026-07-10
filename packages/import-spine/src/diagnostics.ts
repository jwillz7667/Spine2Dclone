import type {
  SpineDiagnosticDetail,
  SpineImportError,
  SpineImportErrorCode,
  SpineImportWarning,
  SpineImportWarningFeature,
} from './types';

// A mutable accumulator threaded through the conversion. It collects ALL errors and warnings in one
// pass (matching the format package's collect-all validation philosophy) rather than throwing on the
// first fault, so a caller sees every problem at once. It is the ONE place the converters record
// diagnostics; the pure conversion functions never construct error objects directly.
export class Diagnostics {
  private readonly errorList: SpineImportError[] = [];
  private readonly warningList: SpineImportWarning[] = [];

  error(
    code: SpineImportErrorCode,
    path: string,
    message: string,
    detail?: SpineDiagnosticDetail,
  ): void {
    this.errorList.push(
      detail === undefined ? { code, path, message } : { code, path, message, detail },
    );
  }

  warn(
    feature: SpineImportWarningFeature,
    path: string,
    why: string,
    detail?: SpineDiagnosticDetail,
  ): void {
    this.warningList.push(
      detail === undefined ? { feature, path, why } : { feature, path, why, detail },
    );
  }

  get hasErrors(): boolean {
    return this.errorList.length > 0;
  }

  get errors(): readonly SpineImportError[] {
    return this.errorList;
  }

  get warnings(): readonly SpineImportWarning[] {
    return this.warningList;
  }
}
