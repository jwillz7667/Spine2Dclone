import { BrowserWindow, dialog } from 'electron';
import { importGridAtlasFromImage, importPremadeAtlasFromDescriptor } from './atlas-premade-io';
import type { AtlasImportGridRequest, AtlasImportResponse, GridSpec, IpcResult } from '../shared';

// The Electron dialog wrapper for the pre-made atlas import (PP-D5). The renderer never supplies a
// filesystem path for the descriptor flow: main owns the open dialog (path-injection defense, mirroring
// atlas-import.ts and spine-import.ts). All the reading, decoding, and region assembly lives in the
// Electron-free atlas-premade-io.ts so it stays unit-testable; this module only turns the dialog choice into
// a descriptor path and delegates. The grid flow needs no dialog (the renderer ships the bytes), so it is
// re-exported straight through. Import only.

const DESCRIPTOR_FILTERS = [
  { name: 'Atlas Descriptor', extensions: ['json', 'atlas'] },
  { name: 'All Files', extensions: ['*'] },
];

export async function importPremadeAtlasFromFile(): Promise<IpcResult<AtlasImportResponse>> {
  const openOptions = {
    title: 'Import Atlas',
    properties: ['openFile' as const],
    filters: DESCRIPTOR_FILTERS,
  };
  const focused = BrowserWindow.getFocusedWindow();
  const result = focused
    ? await dialog.showOpenDialog(focused, openOptions)
    : await dialog.showOpenDialog(openOptions);
  const descriptorPath = result.filePaths[0];
  if (result.canceled || descriptorPath === undefined) {
    return { ok: true, data: { status: 'canceled' } };
  }
  return importPremadeAtlasFromDescriptor(descriptorPath);
}

export async function importGridAtlas(
  image: AtlasImportGridRequest['image'],
  grid: GridSpec,
): Promise<IpcResult<AtlasImportResponse>> {
  return importGridAtlasFromImage(image, grid);
}
