import { describe, expect, it } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { confinePagePath, texturesDirFor, TEXTURES_DIR_SUFFIX } from './project-textures';

describe('project textures paths (PP-D5)', () => {
  it('derives a sibling textures directory from the project path', () => {
    const dir = texturesDirFor(join(sep, 'projects', 'hero.json'));
    expect(dir).toBe(join(sep, 'projects', `hero${TEXTURES_DIR_SUFFIX}`));
    // The stem drops the extension, not just ".json".
    expect(texturesDirFor(join(sep, 'a', 'b.marionette'))).toBe(
      join(sep, 'a', `b${TEXTURES_DIR_SUFFIX}`),
    );
  });

  it('confines a plain page basename inside the textures directory', () => {
    const root = join(sep, 'projects', `hero${TEXTURES_DIR_SUFFIX}`);
    expect(confinePagePath(root, 'atlas-0.png')).toBe(resolve(root, 'atlas-0.png'));
  });

  it('rejects any page name that would escape the textures directory', () => {
    const root = join(sep, 'projects', `hero${TEXTURES_DIR_SUFFIX}`);
    expect(confinePagePath(root, '../secret.png')).toBeNull();
    expect(confinePagePath(root, join('..', '..', 'etc', 'passwd'))).toBeNull();
    expect(confinePagePath(root, join('sub', 'page.png'))).toBeNull();
    expect(confinePagePath(root, resolve(sep, 'etc', 'passwd'))).toBeNull();
    expect(confinePagePath(root, '')).toBeNull();
    expect(confinePagePath(root, '.')).toBeNull();
    expect(confinePagePath(root, '..')).toBeNull();
  });
});
