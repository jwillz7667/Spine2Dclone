import { readFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { decodePng, isAtlasError } from './atlas';
import { confinePagePath } from './project-textures';
import {
  buildGridAtlas,
  buildSinglePageAtlas,
  classifyDescriptor,
  validateAtlasRefPages,
  type GridSpec,
  type PageDimensions,
  type PremadeAtlasResult,
} from './atlas-premade';
import type {
  AtlasImportGridRequest,
  AtlasImportPage,
  AtlasImportResponse,
  IpcResult,
} from '../shared';

// The filesystem seam for the pre-made atlas import (PP-D5), with NO Electron import so it is unit-testable
// in the headless node test environment (the dialog wrapper that DOES import Electron is atlas-premade-import.ts,
// which delegates here after the user picks a file). The pure builders (atlas-premade.ts) hold the region
// math; this module reads the page image(s), decodes them for their true pixel size, and maps the pure
// result to a typed IPC response. A builder failure or an unreadable/undecodable page becomes a typed IPC
// handler error whose message carries the stable premade-atlas code (mirroring atlas-import.ts surfacing
// AtlasError codes). Import only.

function handlerError(message: string): IpcResult<never> {
  return { ok: false, error: { code: 'IPC_HANDLER_ERROR', message } };
}

// Map a pure builder failure to a typed IPC handler error, embedding the stable code so the renderer notice
// is actionable. On success it pairs the AtlasRef with the page bytes the sandboxed renderer needs to build
// textures.
function fromResult(
  result: PremadeAtlasResult,
  pages: AtlasImportPage[],
): IpcResult<AtlasImportResponse> {
  if (!result.ok) {
    return handlerError(`atlas import failed (${result.error.code}): ${result.error.message}`);
  }
  return { ok: true, data: { status: 'imported', atlas: result.atlas, pages } };
}

// Decode a page PNG the descriptor references, reading it from the descriptor's directory. The name is
// untrusted (a descriptor could carry a traversal), so confinePagePath rejects anything but a plain basename
// inside that directory. Returns the decoded pixel size plus the raw bytes to ship to the renderer, or a
// typed error message.
async function readPageImage(
  descriptorDir: string,
  pageFile: string,
): Promise<
  | { ok: true; width: number; height: number; data: Uint8Array<ArrayBuffer> }
  | { ok: false; message: string }
> {
  const full = confinePagePath(descriptorDir, pageFile);
  if (full === null) {
    return { ok: false, message: `page image name "${pageFile}" is not a plain file name` };
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(full));
  } catch {
    return { ok: false, message: `could not read page image "${pageFile}" next to the descriptor` };
  }
  try {
    const decoded = decodePng(bytes);
    return { ok: true, width: decoded.width, height: decoded.height, data: bytes };
  } catch (error) {
    if (isAtlasError(error)) {
      return { ok: false, message: `page image "${pageFile}" is not a valid PNG (${error.code})` };
    }
    return { ok: false, message: `page image "${pageFile}" could not be decoded` };
  }
}

// Build a pre-made atlas from a descriptor file on disk (the caller supplies the path from a main-process
// dialog; no renderer path ever reaches here). Reads the descriptor JSON, classifies it, reads and decodes
// the sibling page image(s), and returns the AtlasRef plus those page bytes, or a typed error.
export async function importPremadeAtlasFromDescriptor(
  descriptorPath: string,
): Promise<IpcResult<AtlasImportResponse>> {
  let text: string;
  try {
    text = await readFile(descriptorPath, 'utf8');
  } catch {
    return handlerError(`could not read atlas descriptor ${descriptorPath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return handlerError(
      `atlas import failed (ATLAS_DESCRIPTOR_INVALID): ${basename(descriptorPath)} is not valid JSON`,
    );
  }

  const parsed = classifyDescriptor(json);
  if (!parsed.ok) {
    return handlerError(`atlas import failed (${parsed.error.code}): ${parsed.error.message}`);
  }

  const descriptorDir = dirname(descriptorPath);
  const pageBytes: AtlasImportPage[] = [];

  if (parsed.parsed.kind === 'atlasRef') {
    // Our own descriptor shape lists one or more page files; read and decode each, then re-check every region
    // against the true image bounds.
    const dimensions = new Map<string, PageDimensions>();
    for (const page of parsed.parsed.atlas.pages) {
      const image = await readPageImage(descriptorDir, page.file);
      if (!image.ok) {
        return handlerError(`atlas import failed (ATLAS_REGION_INVALID): ${image.message}`);
      }
      dimensions.set(page.file, { width: image.width, height: image.height });
      pageBytes.push({ file: page.file, data: image.data });
    }
    return fromResult(validateAtlasRefPages(parsed.parsed.atlas, dimensions), pageBytes);
  }

  // Generic region list over a single page image: default the page to the descriptor's sibling PNG.
  const descriptorStem = basename(descriptorPath, extname(descriptorPath));
  const pageFile = parsed.parsed.descriptor.image ?? `${descriptorStem}.png`;
  const image = await readPageImage(descriptorDir, pageFile);
  if (!image.ok) {
    return handlerError(`atlas import failed (ATLAS_REGION_INVALID): ${image.message}`);
  }
  pageBytes.push({ file: pageFile, data: image.data });
  return fromResult(
    buildSinglePageAtlas(pageFile, image.width, image.height, parsed.parsed.descriptor.regions),
    pageBytes,
  );
}

// Slice a plain sprite sheet the renderer supplied as bytes (no descriptor). The image is decoded for its
// true pixel size, sliced by the grid parameters, and returned as the single page (no repack). The region
// name prefix is the image basename stem.
export async function importGridAtlasFromImage(
  image: AtlasImportGridRequest['image'],
  grid: GridSpec,
): Promise<IpcResult<AtlasImportResponse>> {
  let width: number;
  let height: number;
  try {
    const decoded = decodePng(image.data);
    width = decoded.width;
    height = decoded.height;
  } catch (error) {
    if (isAtlasError(error)) {
      return handlerError(`atlas import failed (${error.code}): ${image.name} is not a valid PNG`);
    }
    return handlerError(`atlas import failed: ${image.name} could not be decoded`);
  }

  const pageFile = image.name;
  const namePrefix = basename(pageFile, extname(pageFile)) || 'tile';
  return fromResult(buildGridAtlas(pageFile, width, height, grid, namePrefix), [
    { file: pageFile, data: image.data },
  ]);
}
