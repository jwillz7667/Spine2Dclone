// The injected resolver the slot scene validator uses to reach OUTSIDE the SlotSceneDocument (format
// -contract section 15.4). The format package imports no Node built-ins, so it cannot read referenced
// SkeletonDocument or VFX preset files itself; the caller (which has FS access) supplies this resolver.
// This keeps `validateSlotScene` a pure function and the FS at the boundary, exactly as the effects
// ProjectManifest validator parameterizes its integrity step.
//
// `skeleton(name)` returns the referenced skeleton's animation-name set and content hash, or null when
// the skeleton is absent or unreadable. `vfxPreset(name)` returns the referenced preset's content hash,
// or null when absent. The validator never throws on a null; it reports a typed `skeletonRefMissing` /
// `vfxPresetMissing` (or, when the hash differs, `refHashMismatch`).
export interface ResolvedSkeleton {
  readonly animations: readonly string[];
  readonly hash: string;
}

export interface ResolvedVfxPreset {
  readonly hash: string;
}

export interface SceneResolver {
  skeleton(name: string): ResolvedSkeleton | null;
  vfxPreset(name: string): ResolvedVfxPreset | null;
}
