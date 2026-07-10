import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult, MarionetteApi, SpineImportResponse } from '../../shared';
import { CreateBoneCommand, documentHost, exportDocument } from '../document';
import { useSpineImportStore } from '../editor-state/spine-import-store';
import { importSpineProjectFromDialog } from './import-spine';

// Renderer-side Import Spine Project action tests: the bridge is stubbed, so this exercises the pure
// glue (branching on the IPC result, loading a converted document through documentHost.load, and
// publishing the report) without Electron. Node env, no DOM render (the results component is presentation
// only and not collected by the .test.ts glob).

function installBridge(response: () => IpcResult<SpineImportResponse>): void {
  const api = { importSpineProject: async () => response() } as unknown as MarionetteApi;
  vi.stubGlobal('window', { marionette: api });
}

// A valid exported format document to stand in for a converted Spine import (documentHost.load
// re-validates it). Built through the command spine so it always satisfies the format's one-bone rule.
function validExportedDocument(): unknown {
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
  return exportDocument(document.model);
}

afterEach(() => {
  vi.unstubAllGlobals();
  useSpineImportStore.setState({ open: false, report: null });
});

describe('importSpineProjectFromDialog', () => {
  it('loads a converted document and publishes an imported report with warnings', async () => {
    const document = validExportedDocument();
    const warnings = [
      { feature: 'atlas-synthesized', path: '', why: 'placeholder atlas synthesized' },
    ];
    installBridge(() => ({
      ok: true,
      data: { status: 'imported', name: 'hero', document, warnings },
    }));

    const outcome = await importSpineProjectFromDialog();

    expect(outcome).toEqual({ kind: 'imported', name: 'hero', warnings });
    // The converted document swapped in (its history reset, so no undo depth) and the report is visible.
    expect(documentHost.current().history.canUndo).toBe(false);
    const state = useSpineImportStore.getState();
    expect(state.open).toBe(true);
    expect(state.report).toMatchObject({ status: 'imported', name: 'hero' });
  });

  it('publishes a failed report and returns a failed outcome without loading a document', async () => {
    const errors = [
      { code: 'SPINE_VERSION_UNSUPPORTED', path: '/skeleton/spine', message: 'unsupported' },
    ];
    installBridge(() => ({ ok: true, data: { status: 'failed', errors, warnings: [] } }));

    const outcome = await importSpineProjectFromDialog();

    expect(outcome).toEqual({ kind: 'failed', errors, warnings: [] });
    const state = useSpineImportStore.getState();
    expect(state.open).toBe(true);
    expect(state.report).toMatchObject({ status: 'failed', errors });
  });

  it('reports a user cancel without opening the results dialog', async () => {
    installBridge(() => ({ ok: true, data: { status: 'canceled' } }));
    expect(await importSpineProjectFromDialog()).toEqual({ kind: 'canceled' });
    expect(useSpineImportStore.getState().open).toBe(false);
  });

  it('propagates an IPC handler error as a typed error outcome', async () => {
    installBridge(() => ({
      ok: false,
      error: { code: 'IPC_HANDLER_ERROR', message: 'could not read file' },
    }));
    expect(await importSpineProjectFromDialog()).toEqual({
      kind: 'error',
      message: 'could not read file',
    });
    expect(useSpineImportStore.getState().open).toBe(false);
  });
});
