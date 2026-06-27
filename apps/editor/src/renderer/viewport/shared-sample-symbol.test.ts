import { describe, expect, it } from 'vitest';
import viewportContentSource from './viewport-panel-content.tsx?raw';
import skeletonViewSource from '../../../../../packages/runtime-web/src/scene/skeleton-view.ts?raw';

// TASK-1.10.3 import-graph guard: the editor viewport and the web runtime MUST sample an animation through
// ONE symbol. The viewport does NOT reimplement sampling; it renders the animated pose by calling
// SkeletonView.syncAnimated, and SkeletonView is the single place that calls runtime-core's sampleSkeleton.
// This proves the shared path by reading source TEXT (Vite ?raw), so it needs no PixiJS or WebGL context
// and cannot be fooled by a passing render. Node built-ins are banned in the sandboxed renderer even in
// tests (eslint.config.mjs), so this uses the same ?raw mechanism the other viewport source guards use.

describe('the editor viewport samples through the shared SkeletonView (TASK-1.10.3)', () => {
  it('renders animation through the runtime-web SkeletonView, not a local sampler', () => {
    // The viewport content reaches the shared view through the runtime-web barrel (one public surface).
    expect(viewportContentSource).toMatch(
      /import\s*\{[^}]*\bSkeletonView\b[^}]*\}\s*from\s*'@marionette\/runtime-web'/,
    );
    // Its animation render path is syncAnimated, and it never names runtime-core's sampler itself.
    expect(viewportContentSource).toContain('syncAnimated');
    expect(viewportContentSource).not.toMatch(/\bsampleSkeleton\b/);
  });

  it('routes SkeletonView.syncAnimated through runtime-core sampleSkeleton (the single sampler)', () => {
    // runtime-web imports the sampler from runtime-core (it does not reimplement the solve)...
    expect(skeletonViewSource).toMatch(
      /import\s*\{[\s\S]*?\bsampleSkeleton\b[\s\S]*?\}\s*from\s*'@marionette\/runtime-core'/,
    );
    // ...and the animated path is where it is called, so the editor and the player share one code path.
    expect(syncAnimatedBody(skeletonViewSource)).toContain('sampleSkeleton(');
  });
});

// Extract the brace-balanced body of `syncAnimated(...): void { ... }` from runtime-web source text, so the
// assertion targets that method specifically rather than any comment mention of sampleSkeleton elsewhere in
// the file. Throws (failing the test loudly) if the signature or a balanced body is not found, which keeps
// the guard from silently passing should the method be renamed or removed.
function syncAnimatedBody(source: string): string {
  const signature = /\bsyncAnimated\s*\([^)]*\)\s*:\s*void\s*\{/.exec(source);
  if (signature === null)
    throw new Error('syncAnimated signature not found in skeleton-view source');

  const open = signature.index + signature[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error('syncAnimated body is not brace-balanced');
}
