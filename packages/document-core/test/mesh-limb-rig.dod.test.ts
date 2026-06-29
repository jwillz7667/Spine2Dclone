import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CURRENT_FORMAT_VERSION, validateDocument, verifyContentHash } from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import {
  AddRegionAttachmentCommand,
  AutoWeightFromProximityCommand,
  BindMeshToBonesCommand,
  CreateAnimationCommand,
  CreateBoneCommand,
  CreateIkConstraintCommand,
  CreateSlotCommand,
  GenerateMeshFromRegionCommand,
  SetAtlasRefCommand,
  SetDeformKeyframeCommand,
  SetIkKeyframeCommand,
  SetKeyframeCommand,
  createDocument,
  exportDocument,
  loadDocument,
  makeIdFactory,
  newDocState,
  type DocumentEnvironment,
} from '../src';
import {
  buildMeshLimbRig,
  MESH_LIMB_RIG_ANIMATION,
  MESH_LIMB_RIG_NAME,
} from './mesh-limb-rig-builder';
import { makeTestEnv } from './seeds';

// WP-2.11 document-core Definition-of-Done: the integrated mesh-limb-rig milestone authored ENTIRELY
// through document-core commands (LAW 2), proving (a) the command-built rig validates with a verified
// content hash (TASK-2.11.1), (b) the committed asset is reproducible from the builder, and (c) the
// save/load/undo/redo round-trip is clean (TASK-2.11.4). The runtime parity half (editor solve ==
// runtime-web playback on bones AND mesh vertices) lives in runtime-web, which cannot import
// document-core; this test owns the authoring + persistence guarantees.

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repo root (pnpm-workspace.yaml) not found above the test file');
    }
    dir = parent;
  }
  return dir;
}

const ASSET_DIR = join(repoRoot(), 'packages', 'conformance', 'assets', 'mesh-limb-rig');
const RIG_PATH = join(ASSET_DIR, 'mesh-limb-rig.rig.json');

function readAsset(): unknown {
  return JSON.parse(readFileSync(RIG_PATH, 'utf8'));
}

describe('mesh-limb-rig Phase 2 DoD: authored through commands (WP-2.11)', () => {
  it('builds a rig that validates clean with a verified content hash (TASK-2.11.1)', () => {
    const built = buildMeshLimbRig();

    const report = validateDocument(built, { verifyHash: true });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(verifyContentHash(built)).toBe(true);
    expect(built.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(built.name).toBe(MESH_LIMB_RIG_NAME);
  });

  it('authors the milestone structure: a weighted IK-driven mesh limb with a wave animation', () => {
    const built = buildMeshLimbRig();

    // Bone chain (parent-before-child), with the IK chain [upper, lower] continuous.
    const byName = new Map(built.bones.map((b) => [b.name, b]));
    expect([...byName.keys()].sort()).toEqual(['ik-target', 'lower', 'root', 'target', 'upper']);
    expect(byName.get('upper')!.parent).toBe('root');
    expect(byName.get('lower')!.parent).toBe('upper');

    // The two-bone IK constraint reaches `target` through the upper/lower chain.
    expect(built.ikConstraints).toHaveLength(1);
    const ik = built.ikConstraints[0]!;
    expect(ik.bones).toEqual(['upper', 'lower']);
    expect(ik.target).toBe('target');

    // A WEIGHTED limb mesh on the default skin (its `bones` gather manifest is present), its region
    // path resolving to the atlas.
    const limb = built.skins.find((s) => s.name === 'default')!.attachments['limb']!['limb']!;
    expect(limb.type).toBe('mesh');
    if (limb.type === 'mesh') {
      expect(limb.bones).toBeDefined();
      expect(limb.bones!.length).toBeGreaterThan(0);
      expect(limb.path).toBe('limb');
      // Deform offsets are one (dx, dy) per logical vertex: offsets.length == uvs.length.
      const deform =
        built.animations[MESH_LIMB_RIG_ANIMATION]!.deform['default']!['limb']!['limb']!;
      for (const frame of deform) expect(frame.value.offsets.length).toBe(limb.uvs.length);
    }
    expect(built.atlas.pages[0]!.regions.some((r) => r.name === 'limb')).toBe(true);

    // The `wave` animation keys IK mix, two bone rotates, and a deform pose.
    const wave = built.animations[MESH_LIMB_RIG_ANIMATION]!;
    expect(wave.ik['limb-ik']!.length).toBeGreaterThanOrEqual(2);
    expect(wave.bones['upper']!.rotate!.length).toBeGreaterThanOrEqual(2);
    expect(wave.bones['lower']!.rotate!.length).toBeGreaterThanOrEqual(2);
    expect(wave.deform['default']!['limb']!['limb']!.length).toBeGreaterThanOrEqual(2);
  });

  it('reproduces the committed asset exactly from the builder (drift fails)', () => {
    const built = buildMeshLimbRig();
    const asset = readAsset();
    // The committed JSON deep-equals the freshly-built document: the asset is a pure function of the
    // command sequence, so any drift between the file and the builder fails here.
    expect(built).toEqual(asset);
  });

  it('the committed asset validates clean with a verified content hash', () => {
    const report = validateDocument(readAsset(), { verifyHash: true });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.document).not.toBeNull();
    expect(verifyContentHash(report.document!)).toBe(true);
  });
});

describe('mesh-limb-rig Phase 2 DoD: save / load / undo / redo round-trip (TASK-2.11.4)', () => {
  it('round-trips the committed asset through loadDocument + exportDocument deep-equal', () => {
    const report = validateDocument(readAsset(), { verifyHash: true });
    expect(report.ok).toBe(true);
    const asset: SkeletonDocument = report.document!;

    const loaded = loadDocument(asset, makeTestEnv().env);
    const exported = exportDocument(loaded.model);
    expect(exported).toEqual(asset); // lossless save/load round-trip, hash included
  });

  it('resets history on load: a freshly loaded asset has empty history', () => {
    const loaded = loadDocument(readAsset(), makeTestEnv().env);
    expect(loaded.history.canUndo).toBe(false);
    expect(loaded.history.canRedo).toBe(false);
  });

  it('undo-all returns to the empty document and redo-all returns to the built document', () => {
    // Build a SECOND time on a doc whose history we keep, so we can replay undo/redo over the SAME
    // command sequence the builder uses. (buildMeshLimbRig discards its doc, returning only the export.)
    const env: DocumentEnvironment = { now: () => 0, createIds: makeIdFactory };
    const doc = createDocument(newDocState(MESH_LIMB_RIG_NAME), env);

    const initialEmpty = doc.model.snapshot();
    expect(doc.history.canUndo).toBe(false);

    applyMeshLimbRigCommands(doc);

    const builtSnapshot = doc.model.snapshot();
    // The fully-built document differs from the empty one (the equalities below are not vacuous).
    expect(builtSnapshot).not.toEqual(initialEmpty);

    // Undo every step: the document returns to the initial empty snapshot.
    let undos = 0;
    while (doc.history.canUndo) {
      doc.history.undo();
      undos += 1;
    }
    expect(undos).toBeGreaterThan(0);
    expect(doc.model.snapshot()).toEqual(initialEmpty);

    // Redo every step: the document returns to the fully-built snapshot, exactly.
    let redos = 0;
    while (doc.history.canRedo) {
      doc.history.redo();
      redos += 1;
    }
    expect(redos).toBe(undos);
    expect(doc.model.snapshot()).toEqual(builtSnapshot);

    // And the redone document exports to the committed asset (end-to-end: commands -> export == asset).
    const report = validateDocument(readAsset(), { verifyHash: true });
    expect(exportDocument(doc.model)).toEqual(report.document!);
  });
});

// Drive the exact mesh-limb-rig command sequence on a caller-owned Document so the undo/redo test can
// keep the history. This MIRRORS buildMeshLimbRig (which discards its doc); the reproduction test above
// proves the export of this sequence equals the builder's output, so the two cannot silently diverge.
function applyMeshLimbRigCommands(doc: ReturnType<typeof createDocument>): void {
  const LIMB_W = 64;
  const LIMB_H = 128;
  const root = doc.ids.mint('bone');
  const upper = doc.ids.mint('bone');
  const lower = doc.ids.mint('bone');
  const target = doc.ids.mint('bone');
  const ikTarget = doc.ids.mint('bone');
  const g = (over: Record<string, number | string>) => ({
    name: 'bone',
    length: 50,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal' as const,
    ...over,
  });
  doc.history.execute(new CreateBoneCommand(root, null, g({ name: 'root', length: 50 })));
  doc.history.execute(new CreateBoneCommand(upper, root, g({ name: 'upper', x: 50, length: 50 })));
  doc.history.execute(new CreateBoneCommand(lower, upper, g({ name: 'lower', x: 50, length: 50 })));
  doc.history.execute(
    new CreateBoneCommand(target, root, g({ name: 'target', x: 120, y: 20, length: 20 })),
  );
  doc.history.execute(
    new CreateBoneCommand(ikTarget, root, g({ name: 'ik-target', x: 120, y: -20, length: 20 })),
  );
  doc.history.execute(
    new SetAtlasRefCommand({
      pages: [
        {
          file: 'mesh-limb-rig.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'limb',
              x: 0,
              y: 0,
              w: LIMB_W,
              h: LIMB_H,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: LIMB_W,
              originalH: LIMB_H,
            },
          ],
        },
      ],
    }),
  );
  const limbSlot = doc.ids.mint('slot');
  doc.history.execute(
    new CreateSlotCommand(limbSlot, {
      name: 'limb',
      bone: upper,
      color: { r: 1, g: 1, b: 1, a: 1 },
      darkColor: null,
      attachment: 'limb',
      blendMode: 'normal',
    }),
  );
  doc.history.execute(
    new AddRegionAttachmentCommand(limbSlot, {
      name: 'limb',
      path: 'limb',
      x: 0,
      y: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      width: LIMB_W,
      height: LIMB_H,
      color: { r: 1, g: 1, b: 1, a: 1 },
    }),
  );
  doc.history.execute(
    new GenerateMeshFromRegionCommand(limbSlot, 'limb', {
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: LIMB_W,
      height: LIMB_H,
      color: { r: 1, g: 1, b: 1, a: 1 },
      vertices: [0, 0, LIMB_W, 0, LIMB_W, LIMB_H, 0, LIMB_H],
    }),
  );
  doc.history.execute(new BindMeshToBonesCommand(limbSlot, 'limb', [upper, lower], 'equalSplit'));
  doc.history.execute(new AutoWeightFromProximityCommand(limbSlot, 'limb'));
  const ik = doc.ids.mint('ikConstraint');
  doc.history.execute(
    new CreateIkConstraintCommand(ik, 'limb-ik', [upper, lower], target, 1, true),
  );
  const wave = doc.ids.mint('animation');
  doc.history.execute(new CreateAnimationCommand(wave, MESH_LIMB_RIG_ANIMATION, 1));
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 0, 0, true));
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 0.5, 1, true));
  doc.history.execute(new SetIkKeyframeCommand(wave, ik, 1, 0, true));
  const upperRotate = { kind: 'bone' as const, boneId: upper, channel: 'rotate' as const };
  const lowerRotate = { kind: 'bone' as const, boneId: lower, channel: 'rotate' as const };
  doc.history.execute(new SetKeyframeCommand(wave, upperRotate, 0, { angle: 0 }));
  doc.history.execute(new SetKeyframeCommand(wave, upperRotate, 0.5, { angle: 25 }));
  doc.history.execute(new SetKeyframeCommand(wave, upperRotate, 1, { angle: 0 }));
  doc.history.execute(new SetKeyframeCommand(wave, lowerRotate, 0, { angle: 0 }));
  doc.history.execute(new SetKeyframeCommand(wave, lowerRotate, 0.5, { angle: -15 }));
  doc.history.execute(new SetKeyframeCommand(wave, lowerRotate, 1, { angle: 0 }));
  const flat = [0, 0, 0, 0, 0, 0, 0, 0];
  const wobble = [0, 4, 6, 0, 6, 0, 0, 4];
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 0, flat));
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 0.5, wobble));
  doc.history.execute(new SetDeformKeyframeCommand(wave, 'default', limbSlot, 'limb', 1, flat));
}
