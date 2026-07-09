import { basename, dirname, extname, join, resolve, sep } from 'node:path';

// Project-relative atlas texture persistence paths (PP-D5), factored out as pure functions so the
// path-confinement rules are unit-tested independently of the Electron filesystem seam (file-io.ts). The
// atlas page PNGs for a saved project live in a sibling directory next to the project JSON, so opening the
// project reloads the pixels instead of falling back to placeholders. Every path here is derived from the
// MAIN-controlled dialog path, never from renderer input; the page names come from the document and are
// treated as untrusted (a hostile document could carry a traversal), so confinePagePath rejects anything
// that is not a plain basename resolving inside the textures directory.

export const TEXTURES_DIR_SUFFIX = '.textures';

// The directory holding a project's atlas page PNGs: "<project>.textures" beside the project file. Derived
// entirely from the dialog-provided project path, so it always sits inside the user's chosen directory.
export function texturesDirFor(projectPath: string): string {
  const dir = dirname(projectPath);
  const stem = basename(projectPath, extname(projectPath));
  return join(dir, `${stem}${TEXTURES_DIR_SUFFIX}`);
}

// Resolve a document-supplied page file name to an absolute path CONFINED to texturesDir, or null when the
// name is unsafe. Atlas page names are plain basenames; a name carrying any directory component, a
// traversal, or a dot entry is rejected outright (defense against a hostile document escaping the textures
// directory). The final containment check is belt-and-suspenders over the basename check.
export function confinePagePath(texturesDir: string, pageFile: string): string | null {
  const name = basename(pageFile);
  if (name !== pageFile) return null; // carried a directory component or traversal
  if (name === '' || name === '.' || name === '..') return null;
  const root = resolve(texturesDir);
  const full = resolve(root, name);
  if (full !== join(root, name)) return null;
  if (!full.startsWith(root + sep)) return null;
  return full;
}
