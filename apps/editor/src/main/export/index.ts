// Public barrel for the main-process export surface (PP-D6 / PP-C10 slice 2). The IPC layer imports only
// from here. The pure cores (buildProjectExport, runMediaExport) are re-exported so their headless tests
// import them through the barrel too.
export { buildProjectExport } from './project-export-build';
export type { ProjectExportArtifact, BuildProjectExportResult } from './project-export-build';
export { exportProjectToFile } from './export-project';

export {
  runMediaExport,
  MediaExportAbortedError,
  type MediaExportSink,
  type MediaExportControl,
  type MediaExportResult,
  type RunMediaExportParams,
} from './media-export-core';
export { exportMediaToFile, cancelMediaExport } from './media-export';

export { writeVideoToFile } from './export-video';

export { loadExportProfileFromDialog, saveExportProfileFromDialog } from './export-profile-io';
