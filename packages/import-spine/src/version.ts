// Version gating. The importer accepts the Spine 4.x JSON shape documented publicly and rejects any
// other major version with a typed error, rather than silently mis-parsing an older or newer layout.
// The version lives in `skeleton.spine`, e.g. "4.1.24".

export const SUPPORTED_SPINE_MAJOR = 4;

// Parse the MAJOR component of a Spine version string ("4.1.24" -> 4). Returns null when the string
// does not begin with an integer major component.
export function parseMajorVersion(version: string): number | null {
  const match = /^(\d+)\./.exec(version.trim());
  if (match === null) return null;
  const major = Number.parseInt(match[1]!, 10);
  return Number.isNaN(major) ? null : major;
}

// True when the version string is a supported Spine major version (4.x).
export function isSupportedVersion(version: string): boolean {
  return parseMajorVersion(version) === SUPPORTED_SPINE_MAJOR;
}
