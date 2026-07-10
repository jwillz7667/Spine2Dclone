import { validateDocument } from '@marionette/format';
import { isAtlasError } from '@marionette/atlas-pack';
import { parseOra } from './ora-parse';
import { parsePsd } from './psd-parse';
import { assignRegionNames, buildRigFromLayers, packNamedLayers } from './layered-to-rig';
import { isLayeredParseError, type LayeredDocument } from './layered-types';
import type { LayeredImportResponse } from '../shared';

// The electron-free orchestration of the layered-file import (PP-D5): bytes in, a typed import response out.
// It runs the parse -> name -> pack -> build -> validate pipeline and never throws across the boundary (a
// structural parse failure, an unpackable layer, or a document that fails the format validator all become a
// typed `failed` response with a stable code). Kept separate from the Electron dialog wrapper so it is unit
// testable headless. LAW 3: the assembled document is emitted only after validateDocument accepts it.

export type LayeredFormat = 'psd' | 'ora';

function failed(
  code: string,
  message: string,
  diagnostics: LayeredDocument['diagnostics'],
): LayeredImportResponse {
  return { status: 'failed', errors: [{ code, path: '', message }], diagnostics: [...diagnostics] };
}

export function projectLayeredFile(
  bytes: Uint8Array,
  name: string,
  format: LayeredFormat,
): LayeredImportResponse {
  let parsed: LayeredDocument;
  try {
    parsed = format === 'ora' ? parseOra(bytes, name) : parsePsd(bytes, name);
  } catch (error) {
    const code = isLayeredParseError(error)
      ? error.code
      : format === 'ora'
        ? 'ORA_NOT_A_ZIP'
        : 'PSD_PARSE_FAILED';
    const message = error instanceof Error ? error.message : `could not parse the ${format} file`;
    return failed(code, message, []);
  }

  if (parsed.layers.length === 0) {
    return failed(
      'LAYERED_NO_LAYERS',
      `${name} has no usable raster layers to build a rig from`,
      parsed.diagnostics,
    );
  }

  const named = assignRegionNames(parsed.layers);
  let atlas;
  let pages;
  try {
    ({ atlas, pages } = packNamedLayers(named));
  } catch (error) {
    const code = isAtlasError(error) ? error.code : 'LAYERED_PACK_FAILED';
    const message = error instanceof Error ? error.message : 'could not pack the layer bitmaps';
    return failed(code, message, parsed.diagnostics);
  }

  const document = buildRigFromLayers(parsed, named, atlas);
  const report = validateDocument(document);
  if (!report.ok || report.document === null) {
    return {
      status: 'failed',
      errors: report.errors.map((error) => ({
        code: error.code,
        path: error.path,
        message: error.message,
      })),
      diagnostics: [...parsed.diagnostics],
    };
  }

  return {
    status: 'imported',
    name,
    document: report.document,
    pages,
    diagnostics: [...parsed.diagnostics],
  };
}
