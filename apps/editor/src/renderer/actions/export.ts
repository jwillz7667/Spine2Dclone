import { documentHost, exportDocument } from '../document';
import { atlasTextureStore } from '../editor-state/atlas-texture-store';
import { useExportStore } from '../editor-state/export-store';
import { bridge } from '../ipc-bridge';
import {
  isVideoFormat,
  mediaBaseName,
  resolveFrameRange,
  toMediaExportOptions,
  validateMediaDraft,
  type AnimationChoice,
  type MediaDraft,
  type ProjectFormat,
} from '../export/export-options';
import { suggestedBitrate, validateVideoTiming } from '../export/video-timing';
import type { VideoWorkerMessage } from '../export/video-encode-protocol';
import type { ExportColor, ExportProfile, ExportVideoContainer } from '../../shared';

// The Export dialog orchestration (PP-D6 / PP-C10 slice 2): it reads the live model (never mutates it, the
// math/document boundary), drives the export store's status/progress, and routes each request to the right
// backend. Project + raster media go to the main-process IPC handlers; WebM / MP4 go to the WebCodecs
// worker (off the UI thread) and the muxed bytes are then written by main. A missing bridge (failed
// preload) surfaces a real message rather than doing nothing.

// The single in-flight video worker, so cancelActiveExport can address it. Raster exports are addressed by
// their jobId through bridge().cancelExport instead.
let activeVideoWorker: Worker | null = null;

function currentAnimations(): AnimationChoice[] {
  return documentHost
    .current()
    .model.animations()
    .map((animation) => ({ name: animation.name, duration: animation.duration }));
}

// Open the Export dialog, snapshotting the current animation list for the media picker.
export function openExportDialog(): void {
  useExportStore.getState().show(currentAnimations());
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function describePaths(paths: readonly string[]): string {
  if (paths.length === 1) return paths[0]!;
  const [first] = paths;
  return `${paths.length} files (${first} ...)`;
}

// Export the current document as an .mrnt binary or format JSON.
export async function runProjectExport(format: ProjectFormat): Promise<void> {
  const store = useExportStore.getState();
  let exported: unknown;
  try {
    exported = exportDocument(documentHost.current().model);
  } catch (error) {
    store.setStatus(`Export failed: ${messageOf(error, 'could not export the document')}`);
    return;
  }
  try {
    const result = await bridge().exportProject(exported, format);
    if (!result.ok) {
      store.setStatus(`Export failed: ${result.error.message}`);
      return;
    }
    store.setStatus(
      result.data.status === 'canceled' ? 'Export canceled.' : `Saved to ${result.data.path}.`,
    );
  } catch (error) {
    store.setStatus(`Export failed: ${messageOf(error, 'export failed')}`);
  }
}

// Run a media export: raster media (PNG sequence / GIF / APNG) through the main IPC handler, or video
// (WebM / MP4) through the WebCodecs worker. Validates the draft first and surfaces every problem.
export async function runMediaExport(): Promise<void> {
  const store = useExportStore.getState();
  const { media, animations } = store;
  const problems = validateMediaDraft(media, animations);
  if (problems.length > 0) {
    store.setStatus(problems.join(' '));
    return;
  }
  if (isVideoFormat(media.format)) {
    startVideoExport(media, animations, media.format);
    return;
  }
  await runRasterExport(media, animations);
}

async function runRasterExport(
  media: MediaDraft,
  animations: readonly AnimationChoice[],
): Promise<void> {
  const store = useExportStore.getState();
  let exported: unknown;
  try {
    exported = exportDocument(documentHost.current().model);
  } catch (error) {
    store.setStatus(`Export failed: ${messageOf(error, 'could not export the document')}`);
    return;
  }
  const pages = atlasTextureStore.getPageBytes();
  const options = toMediaExportOptions(media, animations);
  const jobId = crypto.randomUUID();

  store.startJob(jobId);
  const unsubscribe = bridge().onExportProgress((progress) => {
    if (progress.jobId === jobId) {
      useExportStore
        .getState()
        .setProgress({ completed: progress.completed, total: progress.total });
    }
  });
  try {
    const result = await bridge().exportMedia(jobId, exported, pages, options);
    if (!result.ok) {
      useExportStore.getState().finishJob(`Export failed: ${result.error.message}`);
      return;
    }
    if (result.data.status === 'canceled') {
      useExportStore.getState().finishJob('Export canceled.');
      return;
    }
    useExportStore
      .getState()
      .finishJob(
        `Saved ${result.data.frameCount} frame(s) to ${describePaths(result.data.paths)}.`,
      );
  } catch (error) {
    useExportStore.getState().finishJob(`Export failed: ${messageOf(error, 'export failed')}`);
  } finally {
    unsubscribe();
  }
}

// Opaque background for video (H.264 has no alpha; VP9 alpha is avoided for compatibility).
function opaqueBackground(media: MediaDraft): ExportColor {
  return media.transparent ? { r: 0, g: 0, b: 0, a: 1 } : { ...media.background, a: 1 };
}

function startVideoExport(
  media: MediaDraft,
  animations: readonly AnimationChoice[],
  container: ExportVideoContainer,
): void {
  const store = useExportStore.getState();
  const range = resolveFrameRange(media, animations);
  const problems = validateVideoTiming({
    fps: media.fps,
    frameCount: range.frameCount,
    width: media.width,
    height: media.height,
  });
  if (problems.length > 0) {
    store.setStatus(problems.join(' '));
    return;
  }

  let exported: unknown;
  try {
    exported = exportDocument(documentHost.current().model);
  } catch (error) {
    store.setStatus(`Export failed: ${messageOf(error, 'could not export the document')}`);
    return;
  }
  const pages = atlasTextureStore.getPageBytes();
  const jobId = crypto.randomUUID();
  store.startJob(jobId);

  const worker = new Worker(new URL('../export/video-encoder.worker.ts', import.meta.url), {
    type: 'module',
  });
  activeVideoWorker = worker;

  worker.addEventListener('message', (event: MessageEvent<VideoWorkerMessage>) => {
    const message = event.data;
    const live = useExportStore.getState();
    if (message.type === 'progress') {
      live.setProgress({ completed: message.completed, total: message.total });
      return;
    }
    if (message.type === 'canceled') {
      teardownWorker(worker);
      live.finishJob('Export canceled.');
      return;
    }
    if (message.type === 'error') {
      teardownWorker(worker);
      live.finishJob(`Export failed: ${message.message}`);
      return;
    }
    // done: hand the muxed container bytes to main to write.
    teardownWorker(worker);
    void writeVideoBytes(
      new Uint8Array(message.data),
      container,
      `${mediaBaseName(media)}.${container}`,
    );
  });

  worker.postMessage({
    type: 'encode',
    document: exported,
    pages: pages.map((page) => ({ file: page.file, data: page.data })),
    container,
    animation: media.animation,
    fps: media.fps,
    width: media.width,
    height: media.height,
    fromFrame: range.startFrame,
    toFrame: range.endFrame,
    background: opaqueBackground(media),
    bitrate: suggestedBitrate(media.width, media.height, media.fps),
  });
}

async function writeVideoBytes(
  data: Uint8Array,
  container: ExportVideoContainer,
  defaultName: string,
): Promise<void> {
  const store = useExportStore.getState();
  try {
    const result = await bridge().writeVideo(data, container, defaultName);
    if (!result.ok) {
      store.finishJob(`Save failed: ${result.error.message}`);
      return;
    }
    store.finishJob(
      result.data.status === 'canceled'
        ? 'Export canceled.'
        : `Saved ${defaultName} to ${result.data.path}.`,
    );
  } catch (error) {
    store.finishJob(`Save failed: ${messageOf(error, 'save failed')}`);
  }
}

function teardownWorker(worker: Worker): void {
  worker.terminate();
  if (activeVideoWorker === worker) activeVideoWorker = null;
}

// Cancel the in-flight export: signal the video worker, or abort the raster job through main.
export function cancelActiveExport(): void {
  const store = useExportStore.getState();
  if (activeVideoWorker !== null) {
    activeVideoWorker.postMessage({ type: 'cancel' });
    return;
  }
  if (store.jobId !== null) {
    void bridge().cancelExport(store.jobId);
  }
}

// Load an export profile through the main-owned dialog; the returned value is schema-validated in main.
export async function loadExportProfile(): Promise<void> {
  const store = useExportStore.getState();
  try {
    const result = await bridge().loadExportProfile();
    if (!result.ok) {
      store.setStatus(`Load failed: ${result.error.message}`);
      return;
    }
    if (result.data.status === 'canceled') return;
    // main validated the profile against exportProfileSchema; it is the ExportProfile shape.
    store.setProfile(result.data.profile as ExportProfile);
    store.setStatus(`Loaded profile from ${result.data.path}.`);
  } catch (error) {
    store.setStatus(`Load failed: ${messageOf(error, 'load failed')}`);
  }
}

// Run the shipping-atlas export driven by the current profile (WP-5.2). Main owns the source-sprites and
// output dialogs; the ATLAS_COMPRESSION_UNSUPPORTED diagnostics are surfaced in the status, not swallowed.
export async function runAtlasProfileExport(): Promise<void> {
  const store = useExportStore.getState();
  const profile = store.profile;
  if (profile === null) {
    store.setStatus('Load or start a profile before exporting an atlas.');
    return;
  }
  try {
    const result = await bridge().exportAtlas(profile);
    if (!result.ok) {
      store.setStatus(`Atlas export failed: ${result.error.message}`);
      return;
    }
    if (result.data.status === 'canceled') {
      store.setStatus('Atlas export canceled.');
      return;
    }
    const { pageFiles, outputDir, diagnostics } = result.data;
    const unsupported = [...new Set(diagnostics.map((d) => d.target))];
    const note =
      unsupported.length > 0
        ? ` (${unsupported.length} compression target(s) unsupported: ${unsupported.join(', ')})`
        : '';
    store.setStatus(`Exported ${pageFiles.length} atlas page(s) to ${outputDir}${note}.`);
  } catch (error) {
    store.setStatus(`Atlas export failed: ${messageOf(error, 'atlas export failed')}`);
  }
}

// Save the edited export profile through the main-owned dialog (main re-validates before writing).
export async function saveExportProfile(): Promise<void> {
  const store = useExportStore.getState();
  const profile = store.profile;
  if (profile === null) {
    store.setStatus('No profile to save.');
    return;
  }
  try {
    const result = await bridge().saveExportProfile(profile);
    if (!result.ok) {
      store.setStatus(`Save failed: ${result.error.message}`);
      return;
    }
    store.setStatus(
      result.data.status === 'canceled'
        ? 'Save canceled.'
        : `Saved profile to ${result.data.path}.`,
    );
  } catch (error) {
    store.setStatus(`Save failed: ${messageOf(error, 'save failed')}`);
  }
}
