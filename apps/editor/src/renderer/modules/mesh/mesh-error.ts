// The typed, discriminated failure for the editor-side mesh authoring geometry (TASK-2.1.4 / 2.1.7). The
// pure geometry modules (triangulation, silhouette trace, grid fill) FAIL LOUDLY on input they cannot
// turn into a valid mesh rather than returning a silent empty / degenerate result that would later trip
// the format validator far from the cause. Mirrors the document-core typed-error convention (errors.ts):
// a `code` discriminant plus a human message, so a panel can branch on the cause (show "the outline is a
// straight line, add a point off the line") and a test can assert the exact code.
export type MeshErrorCode =
  | 'degenerate' // the input polygon has < 3 non-collinear points (no positive area to triangulate)
  | 'collinear' // every point lies on one line (a special, common degenerate case worth its own code)
  | 'notSimple' // ear-clipping made no progress: a self-intersecting / non-simple polygon
  | 'emptyMask'; // the silhouette trace found no opaque pixel above threshold (nothing to trace)

export class MeshError extends Error {
  readonly code: MeshErrorCode;

  constructor(code: MeshErrorCode, message: string) {
    super(message);
    this.name = 'MeshError';
    this.code = code;
    // Restore the prototype chain so `instanceof MeshError` holds after transpilation to ES5-class
    // semantics (the standard TS extends-Error guard; harmless under ES2022 targets too).
    Object.setPrototypeOf(this, MeshError.prototype);
  }
}
