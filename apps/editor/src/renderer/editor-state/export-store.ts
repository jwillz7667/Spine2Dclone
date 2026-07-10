import { create } from 'zustand';
import {
  defaultMediaDraft,
  type AnimationChoice,
  type ExportSection,
  type MediaDraft,
  type ProjectFormat,
} from '../export/export-options';
import type { ExportProfile } from '../../shared';

// Ephemeral editor state for the Export dialog (PP-D6): open/section, the per-section draft, the loaded
// export profile, and the in-flight export status (progress + cancel). This is the editor/document wall in
// action: it is NEVER undoable and NEVER serialized. The dialog reads it; actions/export.ts drives it (open
// captures the current animation list, the export handlers push progress + busy state). The document itself
// is untouched: exporting is a read of the model, never a mutation.

export interface ExportProgressState {
  readonly completed: number;
  readonly total: number;
}

interface ExportStore {
  readonly open: boolean;
  readonly section: ExportSection;
  readonly projectFormat: ProjectFormat;
  readonly animations: readonly AnimationChoice[];
  readonly media: MediaDraft;
  // The loaded/edited export profile, or null until the user loads a file or starts from the default.
  readonly profile: ExportProfile | null;
  // The last status line shown in the dialog (a saved path, a cancel notice, or an error), or null.
  readonly status: string | null;
  // True while an export is running; disables the export controls and shows the progress + cancel UI.
  readonly busy: boolean;
  // The current media-export job id (addresses progress + cancel), or null when idle.
  readonly jobId: string | null;
  readonly progress: ExportProgressState | null;

  show(animations: readonly AnimationChoice[]): void;
  dismiss(): void;
  setSection(section: ExportSection): void;
  setProjectFormat(format: ProjectFormat): void;
  updateMedia(patch: Partial<MediaDraft>): void;
  setProfile(profile: ExportProfile | null): void;
  setStatus(status: string | null): void;
  startJob(jobId: string): void;
  setProgress(progress: ExportProgressState | null): void;
  finishJob(status: string | null): void;
}

export const useExportStore = create<ExportStore>((set) => ({
  open: false,
  section: 'project',
  projectFormat: 'mrnt',
  animations: [],
  media: defaultMediaDraft([]),
  profile: null,
  status: null,
  busy: false,
  jobId: null,
  progress: null,

  show: (animations) =>
    set({
      open: true,
      section: 'project',
      animations,
      media: defaultMediaDraft(animations),
      status: null,
      busy: false,
      jobId: null,
      progress: null,
    }),
  dismiss: () => set({ open: false }),
  setSection: (section) => set({ section, status: null }),
  setProjectFormat: (projectFormat) => set({ projectFormat }),
  updateMedia: (patch) => set((state) => ({ media: { ...state.media, ...patch } })),
  setProfile: (profile) => set({ profile }),
  setStatus: (status) => set({ status }),
  startJob: (jobId) => set({ busy: true, jobId, progress: null, status: null }),
  setProgress: (progress) => set({ progress }),
  finishJob: (status) => set({ busy: false, jobId: null, progress: null, status }),
}));
