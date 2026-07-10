import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AtlasImportResponse,
  ExportCancelResponse,
  ExportMediaResponse,
  ExportProfileLoadResponse,
  ExportProfileSaveResponse,
  ExportProjectResponse,
  ExportWriteVideoResponse,
  FileOpenResponse,
  FileSaveResponse,
  GetVersionResponse,
  IpcResult,
  MarionetteApi,
  SpineImportResponse,
} from '../../shared';
import { useSelectionStore } from '../editor-state/selection-store';
import {
  CreateBoneCommand,
  documentHost,
  exportDocument,
  openDocumentFromDialog,
  saveCurrentDocument,
} from '.';

// Behavior the fake preload bridge should exhibit for one test. Defaults: save succeeds, open cancels.
interface Behavior {
  save?: (document: unknown) => IpcResult<FileSaveResponse>;
  open?: () => IpcResult<FileOpenResponse>;
}

// Install a fake window.marionette. file-actions reads the bridge at call time (never at import), so
// stubbing window before invoking the actions is sufficient; afterEach restores the real globals.
function installApi(behavior: Behavior): { savedDocument: () => unknown } {
  let saved: unknown;
  const api: MarionetteApi = {
    getVersion: async (): Promise<IpcResult<GetVersionResponse>> => ({
      ok: true,
      data: { version: '0.0.0' },
    }),
    saveDocument: async (document): Promise<IpcResult<FileSaveResponse>> => {
      saved = document;
      return (
        behavior.save?.(document) ?? { ok: true, data: { status: 'saved', path: '/rig.json' } }
      );
    },
    openDocument: async (): Promise<IpcResult<FileOpenResponse>> =>
      behavior.open?.() ?? { ok: true, data: { status: 'canceled' } },
    // These file-action tests never import an atlas; a canceled default keeps the bridge complete after
    // the MarionetteApi contract gained importAtlas (atlas:import, WP-1.3).
    importAtlas: async (): Promise<IpcResult<AtlasImportResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    // These file-action tests never import images; a bounded stub keeps the MarionetteApi contract complete
    // after it gained importAtlasImages (atlas:importImages, PP-D5 drag-drop / file-picker import).
    importAtlasImages: async (): Promise<IpcResult<AtlasImportResponse>> => ({
      ok: true,
      data: { status: 'imported', atlas: { pages: [] }, pages: [] },
    }),
    // The MarionetteApi contract gained onMenuAction (menu:action push, application menu). These file
    // actions never subscribe, so a no-op stub returning a no-op unsubscribe satisfies the contract.
    onMenuAction: () => () => {},
    // The MarionetteApi contract gained importSpineProject (spine:import, PP-A5). These file actions never
    // import a Spine project; a canceled default keeps the bridge complete.
    importSpineProject: async (): Promise<IpcResult<SpineImportResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    // The MarionetteApi contract gained the export surface (PP-D6 / PP-C10 slice 2). These file actions
    // never export; canceled / no-op stubs keep the bridge contract complete.
    exportProject: async (): Promise<IpcResult<ExportProjectResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    exportMedia: async (): Promise<IpcResult<ExportMediaResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    cancelExport: async (): Promise<IpcResult<ExportCancelResponse>> => ({
      ok: true,
      data: { canceled: false },
    }),
    onExportProgress: () => () => {},
    writeVideo: async (): Promise<IpcResult<ExportWriteVideoResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    loadExportProfile: async (): Promise<IpcResult<ExportProfileLoadResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    saveExportProfile: async (): Promise<IpcResult<ExportProfileSaveResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    // The MarionetteApi contract gained importPremadeAtlas and importGridAtlas (atlas:importPremade /
    // atlas:importGrid, PP-D5). These file actions never import a pre-made atlas; canceled defaults keep the
    // bridge complete.
    importPremadeAtlas: async (): Promise<IpcResult<AtlasImportResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
    importGridAtlas: async (): Promise<IpcResult<AtlasImportResponse>> => ({
      ok: true,
      data: { status: 'canceled' },
    }),
  };
  vi.stubGlobal('window', { marionette: api });
  return { savedDocument: () => saved };
}

// Add a root bone through the command spine so the live document is always exportable (the format
// requires at least one bone). The bone is named by its minted id (the create tool's convention) so
// repeated calls across tests on the shared singleton never collide on the unique-name contract.
function addRootBone(): void {
  const document = documentHost.current();
  const id = document.ids.mint('bone');
  document.history.execute(
    new CreateBoneCommand(id, null, {
      name: id,
      length: 100,
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      transformMode: 'normal',
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSelectionStore.getState().clear();
});

describe('WP-0.8 renderer file actions', () => {
  it('round-trips save then open, swapping in a fresh document with reset history and cleared selection', async () => {
    const api = installApi({});
    addRootBone();
    const exported = exportDocument(documentHost.current().model);

    const saveResult = await saveCurrentDocument();
    expect(saveResult).toEqual({ kind: 'saved', path: '/rig.json' });
    // What main received is exactly the validated, hashed export (the renderer never sends a path).
    expect(api.savedDocument()).toEqual(exported);

    // Select a bone and confirm the live document has undo depth, so we can prove load resets both.
    const selectedId = documentHost.current().model.bones()[0]!.id;
    useSelectionStore.getState().select([selectedId]);
    expect(documentHost.current().history.canUndo).toBe(true);
    expect(useSelectionStore.getState().selectedBoneIds).toHaveLength(1);

    // Open returns the document main just "wrote"; the host rebuilds and swaps it in atomically.
    installApi({
      open: () => ({
        ok: true,
        data: { status: 'opened', name: 'rig.json', document: exported, pages: [] },
      }),
    });
    const openResult = await openDocumentFromDialog();
    expect(openResult).toEqual({ kind: 'opened', name: 'rig.json' });

    // Reload-to-same-state: the swapped document re-exports byte-for-byte to what was saved.
    expect(exportDocument(documentHost.current().model)).toEqual(exported);
    // Load is not a command: the new document starts with empty history and no selection.
    expect(documentHost.current().history.canUndo).toBe(false);
    expect(useSelectionStore.getState().selectedBoneIds).toHaveLength(0);
  });

  it('propagates an IPC save error without throwing', async () => {
    installApi({
      save: () => ({ ok: false, error: { code: 'IPC_HANDLER_ERROR', message: 'disk full' } }),
    });
    addRootBone();
    expect(await saveCurrentDocument()).toEqual({ kind: 'error', message: 'disk full' });
  });

  it('reports a user cancel on save as a non-error outcome', async () => {
    installApi({ save: () => ({ ok: true, data: { status: 'canceled' } }) });
    addRootBone();
    expect(await saveCurrentDocument()).toEqual({ kind: 'canceled' });
  });

  it('propagates an IPC open error and leaves the current document untouched', async () => {
    installApi({
      open: () => ({ ok: false, error: { code: 'IPC_HANDLER_ERROR', message: 'no such file' } }),
    });
    addRootBone();
    const before = exportDocument(documentHost.current().model);

    expect(await openDocumentFromDialog()).toEqual({ kind: 'error', message: 'no such file' });
    // A failed open never swaps: the live document is exactly what it was.
    expect(exportDocument(documentHost.current().model)).toEqual(before);
  });
});
