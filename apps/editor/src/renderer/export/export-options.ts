import {
  exportProfileSchema,
  type CompressionTarget,
  type ExportColor,
  type ExportProfile,
  type MediaExportOptions,
} from '../../shared';

// The PURE state + validation + projection for the Export dialog (PP-D6). It holds NO React and NO bridge:
// the Zustand store owns the mutable draft and the .tsx renders it, but every rule (option validation,
// frame-range resolution, the MediaExportOptions projection, and the profile validation/edit helpers)
// lives here so it is fully unit-testable. The renderer video path (WebM / MP4) shares the frame-range
// math; the video timing itself lives in video-timing.ts.

export type ExportSection = 'project' | 'media' | 'profile';
export const EXPORT_SECTIONS: readonly ExportSection[] = ['project', 'media', 'profile'];

export type ProjectFormat = 'mrnt' | 'json';

// The five media outputs. The first three are raster (rendered + encoded in the main process); webm/mp4
// are video (WebCodecs-encoded in a renderer worker, then written by main). isVideoFormat gates the path.
export type MediaFormat = 'png-sequence' | 'gif' | 'apng' | 'webm' | 'mp4';
export const MEDIA_FORMATS: readonly MediaFormat[] = ['png-sequence', 'gif', 'apng', 'webm', 'mp4'];

export function isVideoFormat(format: MediaFormat): format is 'webm' | 'mp4' {
  return format === 'webm' || format === 'mp4';
}

// One selectable animation for the media picker, plus its duration so the full-range end frame is known.
export interface AnimationChoice {
  readonly name: string;
  readonly duration: number;
}

// The editable media draft. Frame range is stored as explicit start/end frames plus a `useFullRange` flag;
// full range resolves to 0..ceil(duration * fps) for an animation. `animation` null renders the setup pose
// (then useFullRange is meaningless and an explicit endFrame is required). Background null is transparent.
export interface MediaDraft {
  readonly format: MediaFormat;
  readonly animation: string | null;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly useFullRange: boolean;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly transparent: boolean;
  readonly background: ExportColor;
  readonly gifPalette: 'global' | 'per-frame';
  readonly loopForever: boolean;
  readonly alphaThreshold: number;
}

export const DEFAULT_BACKGROUND: ExportColor = { r: 0, g: 0, b: 0, a: 1 };

export function defaultMediaDraft(animations: readonly AnimationChoice[]): MediaDraft {
  const first = animations[0] ?? null;
  const fps = 30;
  return {
    format: 'gif',
    animation: first?.name ?? null,
    fps,
    width: 512,
    height: 512,
    useFullRange: true,
    startFrame: 0,
    endFrame: first === null ? 30 : Math.max(1, Math.ceil(first.duration * fps)),
    transparent: true,
    background: DEFAULT_BACKGROUND,
    gifPalette: 'global',
    loopForever: true,
    alphaThreshold: 0.5,
  };
}

const MIN_FPS = 1;
const MAX_FPS = 120;
const MAX_DIMENSION = 4096;

function findAnimation(
  animations: readonly AnimationChoice[],
  name: string | null,
): AnimationChoice | null {
  if (name === null) return null;
  return animations.find((a) => a.name === name) ?? null;
}

// Resolve the concrete inclusive-start / exclusive-end frame range and the frame count from a draft. For a
// full-range animation the end is ceil(duration * fps); otherwise the explicit start/end are used.
export interface ResolvedRange {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameCount: number;
}

export function resolveFrameRange(
  draft: MediaDraft,
  animations: readonly AnimationChoice[],
): ResolvedRange {
  const animation = findAnimation(animations, draft.animation);
  if (draft.useFullRange && animation !== null) {
    const endFrame = Math.max(1, Math.ceil(animation.duration * draft.fps));
    return { startFrame: 0, endFrame, frameCount: endFrame };
  }
  return {
    startFrame: draft.startFrame,
    endFrame: draft.endFrame,
    frameCount: draft.endFrame - draft.startFrame,
  };
}

// Validate a media draft against an animation list. Returns every problem (not just the first) so the
// dialog can surface a complete list. An empty array means the draft is exportable.
export function validateMediaDraft(
  draft: MediaDraft,
  animations: readonly AnimationChoice[],
): string[] {
  const errors: string[] = [];

  if (!Number.isInteger(draft.fps) || draft.fps < MIN_FPS || draft.fps > MAX_FPS) {
    errors.push(`Frame rate must be a whole number between ${MIN_FPS} and ${MAX_FPS}.`);
  }
  for (const [label, value] of [
    ['Width', draft.width],
    ['Height', draft.height],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
      errors.push(`${label} must be a whole number between 1 and ${MAX_DIMENSION}.`);
    }
  }

  if (draft.animation !== null && findAnimation(animations, draft.animation) === null) {
    errors.push(`Animation "${draft.animation}" is not in this document.`);
  }
  if (draft.animation === null && draft.useFullRange) {
    errors.push('The setup pose has no duration; set an explicit frame range.');
  }

  const range = resolveFrameRange(draft, animations);
  if (!(draft.useFullRange && draft.animation !== null)) {
    if (!Number.isInteger(draft.startFrame) || draft.startFrame < 0) {
      errors.push('Start frame must be a non-negative whole number.');
    }
    if (!Number.isInteger(draft.endFrame)) {
      errors.push('End frame must be a whole number.');
    }
  }
  if (range.frameCount < 1) {
    errors.push('The frame range must contain at least one frame (end after start).');
  }

  if (draft.format === 'gif' && (draft.alphaThreshold < 0 || draft.alphaThreshold > 1)) {
    errors.push('GIF alpha threshold must be between 0 and 1.');
  }

  return errors;
}

// Project a VALID raster draft (png-sequence / gif / apng) into the main-process MediaExportOptions. The
// caller must have checked isVideoFormat(draft.format) === false and validateMediaDraft returned []. The
// video formats do not project here: they go through video-timing.ts + the renderer worker.
export function toMediaExportOptions(
  draft: MediaDraft,
  animations: readonly AnimationChoice[],
): MediaExportOptions {
  const range = resolveFrameRange(draft, animations);
  const loopCount = draft.loopForever ? 0 : 1;
  return {
    medium: draft.format as 'png-sequence' | 'gif' | 'apng',
    animation: draft.animation,
    fps: draft.fps,
    width: draft.width,
    height: draft.height,
    from: { frame: range.startFrame },
    to: { frame: range.endFrame },
    background: draft.transparent ? null : draft.background,
    ...(draft.format === 'gif'
      ? {
          gif: {
            palette: draft.gifPalette,
            loopCount,
            alphaThreshold: draft.alphaThreshold,
          },
        }
      : {}),
    ...(draft.format === 'apng' ? { apng: { loopCount } } : {}),
  };
}

// A stable default suffix for a media/video output filename.
export function mediaBaseName(draft: MediaDraft): string {
  return draft.animation ?? 'setup-pose';
}

// ---- Export profile (the third store) form helpers -------------------------------------------------

// A sensible starting profile (mirrors the frozen ship values) so a user can author one without loading a
// file first. Validated by exportProfileSchema in tests, so it can never drift out of the schema.
export function defaultExportProfile(): ExportProfile {
  return {
    exportProfileVersion: '1.0.0',
    atlasExport: {
      maxPageSize: 2048,
      padding: 2,
      allowRotation: true,
      blendBinning: true,
      textureTransport: 'uastc-ktx2',
      compressionTargets: ['astc6x6', 'bc7', 'etc2'],
    },
    particleProfiles: {
      mobile: { maxLiveParticles: 600, ambientQualityTier: 'medium' },
      desktop: { maxLiveParticles: 2000, ambientQualityTier: 'high' },
    },
    coldStartBudgets: {
      unityIosNativeMs: 1500,
      webWarmFirstFrameMs: 1500,
      webColdInteractiveMs: 4000,
    },
  };
}

export type ValidateProfileResult =
  | { readonly ok: true; readonly profile: ExportProfile }
  | { readonly ok: false; readonly errors: string[] };

// Validate an unknown value (a loaded file or an edited draft) against the authoritative schema.
export function validateExportProfile(value: unknown): ValidateProfileResult {
  const parsed = exportProfileSchema.safeParse(value);
  if (parsed.success) return { ok: true, profile: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

// Toggle a compression target (texture variant) in the profile, preserving the schema's nonempty
// invariant: the last remaining target cannot be removed. Returns a new profile (immutable update).
export function toggleCompressionTarget(
  profile: ExportProfile,
  target: CompressionTarget,
): ExportProfile {
  const present = profile.atlasExport.compressionTargets.includes(target);
  if (present && profile.atlasExport.compressionTargets.length === 1) return profile;
  const next = present
    ? profile.atlasExport.compressionTargets.filter((t) => t !== target)
    : [...profile.atlasExport.compressionTargets, target];
  // filter preserves the tuple's non-emptiness at runtime (guarded above); assert the nonempty type.
  const targets = next as [CompressionTarget, ...CompressionTarget[]];
  return { ...profile, atlasExport: { ...profile.atlasExport, compressionTargets: targets } };
}
