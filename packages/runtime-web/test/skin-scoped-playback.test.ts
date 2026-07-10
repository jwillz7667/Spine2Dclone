import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '@marionette/format';
import type { Mat2x3, SkeletonDocument } from '@marionette/runtime-core';
import { samplePlaybackWorlds } from '@marionette/runtime-web';

// Skin-scoped constraints (ADR-0009 section 5) solve only while the skin that scopes them is active. This
// verifies that the active skin flows through PLAYBACK: samplePlaybackWorlds forwards it to the same
// sampleSkeleton call SkeletonView.syncAnimated uses, so the headless harness and the on-screen player agree
// on the scoped solve. The committed conformance rig `rig-skin-scoped` scopes constraint `tcGold` (which
// drives boneA) to skin `gold`, and leaves `tcAlways` (which drives boneB) unscoped.

function skinScopedRig(): SkeletonDocument {
  const path = fileURLToPath(
    new URL('../../conformance/src/rigs/rig-skin-scoped.json', import.meta.url),
  );
  return parseDocument(JSON.parse(readFileSync(path, 'utf8')), { verifyHash: false });
}

function boneIndex(doc: SkeletonDocument, name: string): number {
  return doc.bones.findIndex((bone) => bone.name === name);
}

function worldsEqual(a: Mat2x3, b: Mat2x3): boolean {
  for (let i = 0; i < 6; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

describe('skin-scoped constraints through playback', () => {
  it('activates a scoped constraint only under its skin', () => {
    const doc = skinScopedRig();
    const times = [0, 0.5, 1];
    const a = boneIndex(doc, 'boneA');
    const b = boneIndex(doc, 'boneB');

    const withDefault = samplePlaybackWorlds(doc, 'default', times);
    const withGold = samplePlaybackWorlds(doc, 'default', times, 'gold');

    // boneA is driven by tcGold, scoped to `gold`: its world differs once the gold skin is active.
    const boneADiffers = times.some(
      (_, frame) => !worldsEqual(withDefault[frame]!.worlds[a]!, withGold[frame]!.worlds[a]!),
    );
    expect(boneADiffers).toBe(true);

    // boneB is driven by tcAlways (unscoped): its world is identical under either skin.
    for (let frame = 0; frame < times.length; frame += 1) {
      expect(worldsEqual(withDefault[frame]!.worlds[b]!, withGold[frame]!.worlds[b]!)).toBe(true);
    }
  });

  it('defaults to only the default skin active (no-arg equals null equals "default")', () => {
    const doc = skinScopedRig();
    const times = [0, 0.5, 1];

    const noArg = samplePlaybackWorlds(doc, 'default', times);
    const explicitNull = samplePlaybackWorlds(doc, 'default', times, null);
    const explicitDefault = samplePlaybackWorlds(doc, 'default', times, 'default');

    for (let frame = 0; frame < times.length; frame += 1) {
      for (let bone = 0; bone < doc.bones.length; bone += 1) {
        expect(worldsEqual(noArg[frame]!.worlds[bone]!, explicitNull[frame]!.worlds[bone]!)).toBe(
          true,
        );
        expect(
          worldsEqual(noArg[frame]!.worlds[bone]!, explicitDefault[frame]!.worlds[bone]!),
        ).toBe(true);
      }
    }
  });
});
