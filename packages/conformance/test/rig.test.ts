import { describe, expect, it } from 'vitest';
import { validateDocument } from '@marionette/format';
import type { CurveType } from '@marionette/format/types';
import { loadRig, readJson, rigPath } from '../src/io';

// rig-2bone is a valid SkeletonDocument and exercises the AMEND-V-1 coverage (conformance A.2 /
// phase-1-bone-puppet.md WP-1.12): rotate on both bones, translate on root, scale on child, and the
// curve types linear, stepped, and bezier. This is the rig's own coverage check; the Phase 2 A.2
// coverage meta-test (which spans the full catalog) is skipped until the catalog lands.

function curveKind(curve: CurveType): 'linear' | 'stepped' | 'bezier' {
  return typeof curve === 'object' ? 'bezier' : curve;
}

describe('rig-2bone (WP-V.1, A.2)', () => {
  it('is a valid SkeletonDocument (Law 3)', () => {
    const report = validateDocument(readJson(rigPath('rig-2bone')), { verifyHash: false });

    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('has root and child (child at x=100 in root-local, both length 100)', () => {
    const doc = loadRig('rig-2bone');

    expect(doc.bones.map((b) => b.name)).toEqual(['root', 'child']);
    const root = doc.bones[0]!;
    const child = doc.bones[1]!;

    expect(root.parent).toBeNull();
    expect(child.parent).toBe('root');
    expect(child.x).toBe(100);
    expect(child.y).toBe(0);
    expect(root.length).toBe(100);
    expect(child.length).toBe(100);
  });

  it('keys rotate on both bones, translate on root, scale on child (AMEND-V-1)', () => {
    const doc = loadRig('rig-2bone');
    const anim = doc.animations['default'];
    expect(anim).toBeDefined();

    expect(anim!.bones['root']?.rotate).toBeDefined();
    expect(anim!.bones['root']?.translate).toBeDefined();
    expect(anim!.bones['child']?.rotate).toBeDefined();
    expect(anim!.bones['child']?.scale).toBeDefined();
  });

  it('exercises linear, stepped, and bezier curves (AMEND-V-1, first bezier in the catalog)', () => {
    const doc = loadRig('rig-2bone');
    const anim = doc.animations['default'];
    expect(anim).toBeDefined();

    const kinds = new Set<string>();
    for (const timelines of Object.values(anim!.bones)) {
      for (const channel of [
        timelines.rotate,
        timelines.translate,
        timelines.scale,
        timelines.shear,
      ]) {
        if (channel === undefined) continue;
        for (const keyframe of channel) kinds.add(curveKind(keyframe.curve));
      }
    }

    expect(kinds.has('linear')).toBe(true);
    expect(kinds.has('stepped')).toBe(true);
    expect(kinds.has('bezier')).toBe(true);
  });
});
