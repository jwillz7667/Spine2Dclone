import {
  computeContentHash,
  CURRENT_FORMAT_VERSION,
  FormatValidationError,
  verifyContentHash,
} from '@marionette/format';
import type { SkeletonDocument } from '@marionette/format/types';
import { buildPose, sampleSkeleton, SLOT_COLOR_STRIDE } from '@marionette/runtime-core';
import { describe, expect, it } from 'vitest';
import {
  CreateBoneCommand,
  DeleteBoneCommand,
  ExportValidationError,
  assertInvariants,
  createDocument,
  exportDocument,
  loadDocument,
  newDocState,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

const GEOM = {
  length: 80,
  x: 0,
  y: 0,
  rotation: 10,
  scaleX: 1,
  scaleY: 1,
  shearX: 0,
  shearY: 0,
  transformMode: 'normal',
} as const;

// A rich document (slot, region attachment, atlas, animation) carrying the format's own content hash,
// so exportDocument(loadDocument(R)) must reproduce R exactly, preserved body included.
function richDocument(): SkeletonDocument {
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'rich',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 100,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 'body',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'body',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: {
            body: {
              type: 'region',
              path: 'body',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 64,
              height: 64,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [],
    events: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'body',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
  return { ...draft, hash: computeContentHash(draft) };
}

// A document carrying BOTH an unweighted mesh (with an `edges` wireframe) and a single-bone weighted
// (rigid) mesh, so the WP-2.1 MeshAttachmentEntity must round-trip losslessly: load promotes each format
// mesh to an editable entity, export projects it back, and the result is deep-equal to the original
// (edges present on the unweighted mesh, `bones` present on the weighted one, neither leaking onto the
// other).
function meshDocument(): SkeletonDocument {
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'meshes',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 100,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [
      {
        name: 'plain',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'plainmesh',
        blendMode: 'normal',
      },
      {
        name: 'rigid',
        bone: 'root',
        color: { r: 1, g: 1, b: 1, a: 1 },
        attachment: 'rigidmesh',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          plain: {
            plainmesh: {
              type: 'mesh',
              path: 'tex_plain',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
              triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
              hullLength: 4,
              width: 64,
              height: 64,
              color: { r: 1, g: 1, b: 1, a: 1 },
              edges: [0, 1, 1, 2, 2, 3, 3, 0],
              vertices: [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
            },
          },
          rigid: {
            rigidmesh: {
              type: 'mesh',
              path: 'tex_rigid',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              hullLength: 4,
              width: 64,
              height: 64,
              color: { r: 1, g: 1, b: 1, a: 1 },
              vertices: [1, 0, 0, 0, 1, 1, 0, 64, 0, 1, 1, 0, 64, 64, 1, 1, 0, 0, 64, 1],
              bones: [0],
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [],
    events: [],
    animations: {},
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [
            {
              name: 'tex_plain',
              x: 0,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
            {
              name: 'tex_rigid',
              x: 64,
              y: 0,
              w: 64,
              h: 64,
              rotated: false,
              offsetX: 0,
              offsetY: 0,
              originalW: 64,
              originalH: 64,
            },
          ],
        },
      ],
    },
  };
  return { ...draft, hash: computeContentHash(draft) };
}

describe('save / load seam', () => {
  it('round-trips a command-built document through the format projection', () => {
    const { env } = makeTestEnv();
    const doc = createDocument(newDocState('built'), env);
    const root = doc.ids.mint('bone');
    const child = doc.ids.mint('bone');
    doc.history.execute(new CreateBoneCommand(root, null, { name: 'root', ...GEOM }));
    doc.history.execute(new CreateBoneCommand(child, root, { name: 'child', ...GEOM, x: 50 }));

    const json1 = exportDocument(doc.model);
    expect(json1.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(verifyContentHash(json1)).toBe(true);
    // Only format keys are present: no camera/selection/tool (editor state never serializes).
    expect(Object.keys(json1).sort()).toEqual(
      [
        'atlas',
        'bones',
        'formatVersion',
        'hash',
        'ikConstraints',
        'name',
        'skins',
        'slots',
        'transformConstraints',
        'pathConstraints',
        'events',
        'animations',
      ].sort(),
    );

    const reloaded = loadDocument(json1, makeTestEnv().env);
    const json2 = exportDocument(reloaded.model);
    expect(json2).toEqual(json1); // format-projection round-trip, hash included
  });

  it('preserves the non-bone body (slots, skins, attachments, atlas) across a round-trip', () => {
    const original = richDocument();
    const doc = loadDocument(original, makeTestEnv().env);
    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original);
  });

  it('round-trips editable mesh attachments (unweighted with edges, and weighted) deep-equal', () => {
    const original = meshDocument();
    const doc = loadDocument(original, makeTestEnv().env);

    // Loaded as first-class editable mesh entities (no longer preserved verbatim).
    const plain = doc.model.slots().find((s) => s.name === 'plain')!;
    const plainMesh = doc.model.getAttachment(plain.id, 'plainmesh');
    expect(plainMesh?.kind).toBe('mesh');
    if (plainMesh?.kind === 'mesh') {
      expect(plainMesh.edges).toEqual([0, 1, 1, 2, 2, 3, 3, 0]); // unweighted carries its wireframe
      expect(plainMesh.bones).toBeUndefined(); // and is unweighted
    }
    const rigid = doc.model.slots().find((s) => s.name === 'rigid')!;
    const rigidMesh = doc.model.getAttachment(rigid.id, 'rigidmesh');
    if (rigidMesh?.kind === 'mesh') {
      expect(rigidMesh.bones).toEqual([0]); // weighted manifest present
      expect(rigidMesh.edges).toBeUndefined(); // no wireframe leaked onto it
    }

    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original); // lossless, hash included
  });

  it('round-trips a fully-rigged Phase-2 document (constraints, named skin, ik/transform/deform timelines) deep-equal', () => {
    // The seed is authored at 0.2.0 with real constraints and timelines; loadDocument promotes them to
    // first-class editable entities and exportDocument projects them back. Hash it first so the format
    // projection (which stamps the hash) reproduces the input exactly.
    const original = { ...seeds.rigged, hash: computeContentHash({ ...seeds.rigged, hash: '' }) };
    const doc = loadDocument(original, makeTestEnv().env);

    // Constraints and the named skin load as first-class entities (not preserved verbatim).
    expect(doc.model.ikConstraints().map((c) => c.name)).toEqual(['limb-ik']);
    expect(doc.model.transformConstraints().map((c) => c.name)).toEqual(['follow']);
    expect(doc.model.skins().map((s) => s.name)).toEqual(['variant']); // default is implicit
    const move = doc.model.animations().find((a) => a.name === 'move')!;
    expect(move.ik.size).toBe(1); // the limb-ik timeline
    expect(move.transform.size).toBe(1); // the follow timeline
    expect(move.deform.size).toBe(1); // the default-skin deform track

    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original); // lossless, hash included
  });

  it('cascades the slot and attachment when its bone is deleted, restoring them on undo', () => {
    // WP-1.2: DeleteBone now cascades the slots riding deleted bones and their attachments (the slice
    // of TASK-1.1.2 for slots/attachments), so deleting a slot-referenced bone leaves NO orphan: the
    // model stays consistent (assertInvariants passes). richDocument has only one bone, so the export
    // boundary still fails loudly here, not because of a dangling slot but because the format requires
    // at least one bone. Undo restores the full document exactly.
    const doc = loadDocument(richDocument(), makeTestEnv().env);
    const before = doc.model.snapshot();
    const root = doc.model.bones()[0]!;
    doc.history.execute(new DeleteBoneCommand(root.id));

    expect(doc.model.slots()).toHaveLength(0); // the slot riding root cascaded away
    expect(() => assertInvariants(doc.model)).not.toThrow(); // no orphaned slot or attachment
    expect(() => exportDocument(doc.model)).toThrow(ExportValidationError); // zero bones remain

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // exact restore, slot + attachment included
    expect(exportDocument(doc.model)).toEqual(richDocument()); // and exportable again
  });

  it('round-trips an animation with keyframes through the projection, deep-equal', () => {
    const doc = loadDocument(seeds.animated, makeTestEnv().env);
    const json1 = exportDocument(doc.model);

    // Phase 2 (ADR-0004) plus Stage F1 (ADR-0008) plus Stage F3 (ADR-0011): the format Animation is now
    // { duration, bones, slots, ik, transform, deform, drawOrder, events, path }. The model authors only
    // bone/slot timelines today, so ik/transform/deform/path export empty and drawOrder/events as empty arrays.
    expect(Object.keys(json1.animations)).toEqual(['idle']);
    expect(Object.keys(json1.animations.idle!).sort()).toEqual([
      'bones',
      'deform',
      'drawOrder',
      'duration',
      'events',
      'ik',
      'path',
      'slots',
      'transform',
    ]);
    expect(json1.animations.idle!.bones.root!.rotate).toHaveLength(3);
    expect(json1.animations.idle!.bones.root!.translate).toHaveLength(2);
    expect(json1.animations.idle!.slots.body!.color).toHaveLength(2);

    // Reloading and re-exporting reproduces the projection exactly (keyframe ids are minted fresh on
    // load but never serialized, so the format JSON is identical).
    const reloaded = loadDocument(json1, makeTestEnv().env);
    const json2 = exportDocument(reloaded.model);
    expect(json2).toEqual(json1);
  });

  it('round-trips a 0.3.0 document carrying events, draw-order keys, and metadata, deep-equal', () => {
    // Stage F1 (ADR-0008, PP-D9): event definitions, per-animation draw-order/event timelines, and the
    // metadata block are FIRST-CLASS model state. loadDocument resolves the on-disk NAMES (a draw-order
    // offset's slot, an event key's event) to internal ids and mints a KeyframeId per key; exportDocument
    // resolves them back. This proves that round-trip reproduces a 0.3.0 document with real events (payload
    // defaults + audio + a per-key override), a draw-order reorder, and metadata EXACTLY, hash included.
    const draft: SkeletonDocument = {
      formatVersion: CURRENT_FORMAT_VERSION,
      name: 'events-and-draworder',
      hash: '',
      bones: [{ name: 'root', parent: null, ...GEOM, rotation: 0 }],
      slots: [
        {
          name: 'back',
          bone: 'root',
          color: { r: 1, g: 1, b: 1, a: 1 },
          attachment: null,
          blendMode: 'normal',
        },
        {
          name: 'front',
          bone: 'root',
          color: { r: 1, g: 1, b: 1, a: 1 },
          attachment: null,
          blendMode: 'normal',
        },
      ],
      skins: [{ name: 'default', attachments: {} }],
      ikConstraints: [],
      transformConstraints: [],
      pathConstraints: [],
      // A named event with an int payload and an audio hint, referenced by the animation's event timeline.
      events: [
        {
          name: 'footstep',
          int: 3,
          audio: { path: 'sfx/footstep.wav', volume: 0.8, balance: -0.25 },
        },
      ],
      animations: {
        walk: {
          duration: 1,
          bones: {},
          slots: {},
          ik: {},
          transform: {},
          deform: {},
          // At t=0.5 move `back` forward one position (target index 1); `front` implicitly fills index 0.
          // A consistent single-slot reorder (no colliding or out-of-range offsets).
          drawOrder: [{ time: 0.5, offsets: [{ slot: 'back', offset: 1 }] }],
          // Fire `footstep` twice (coincident-legal ordering), overriding the int payload on the second.
          events: [
            { time: 0.25, name: 'footstep' },
            { time: 0.75, name: 'footstep', int: 7 },
          ],
          path: {},
        },
      },
      atlas: { pages: [] },
      metadata: { fps: 30, imagesPath: 'art/images', audioPath: 'art/audio' },
    };
    const original: SkeletonDocument = { ...draft, hash: computeContentHash(draft) };

    const doc = loadDocument(original, makeTestEnv().env);

    // Promoted to first-class model state (no longer preserved verbatim): the event definition, the
    // per-animation timelines, and the metadata are all reachable through the read model.
    expect(doc.model.eventDefs().map((d) => d.name)).toEqual(['footstep']);
    expect(doc.model.metadata()).toEqual({
      fps: 30,
      imagesPath: 'art/images',
      audioPath: 'art/audio',
    });
    const walk = doc.model.animations().find((a) => a.name === 'walk')!;
    expect(walk.events).toHaveLength(2);
    expect(walk.drawOrder).toHaveLength(1);

    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original); // lossless, events + draw-order + metadata + hash included
    // And re-loading the export reproduces it again (idempotent projection).
    const reloaded = loadDocument(exported, makeTestEnv().env);
    expect(exportDocument(reloaded.model)).toEqual(original);
  });

  it('exports an animation the WP-1.4 sampler consumes without throwing and to a sane pose', () => {
    // The sampler reads the EXPORTED format (animation.bones[name].rotate[i].value.angle, slots[name]
    // .color, ...), so this proves the editable model projects to exactly what runtime-core consumes.
    const doc = loadDocument(seeds.animated, makeTestEnv().env);
    const exported = exportDocument(doc.model);
    const pose = buildPose(exported);

    expect(() => sampleSkeleton(exported, 'idle', 0.5, pose)).not.toThrow();
    for (const value of pose.world) expect(Number.isFinite(value)).toBe(true);

    // At t=1.0 the body slot color reaches the final red keyframe (per-component RGBA, replacing setup).
    sampleSkeleton(exported, 'idle', 1, pose);
    const bodyIndex = pose.slotNames.indexOf('body');
    expect(bodyIndex).toBeGreaterThanOrEqual(0);
    const base = bodyIndex * SLOT_COLOR_STRIDE;
    expect(pose.slotColor[base]).toBeCloseTo(1); // r
    expect(pose.slotColor[base + 1]).toBeCloseTo(0); // g
    expect(pose.slotColor[base + 2]).toBeCloseTo(0); // b
    expect(pose.slotColor[base + 3]).toBeCloseTo(1); // a
  });

  it('rejects malformed JSON with a typed error and builds no Document', () => {
    const { env } = makeTestEnv();
    expect(() => loadDocument({ formatVersion: '0.1.0', name: 'broken' }, env)).toThrow(
      FormatValidationError,
    );
    expect(() => loadDocument(null, env)).toThrow(FormatValidationError);
  });

  it('resets history on load: a new Document has empty history regardless of a prior edit', () => {
    const { env } = makeTestEnv();
    const first = loadDocument(seeds.minimal, env);
    first.history.execute(
      new CreateBoneCommand(first.ids.mint('bone'), null, { name: 'x', ...GEOM }),
    );
    expect(first.history.canUndo).toBe(true);

    const second = loadDocument(seeds.minimal, env);
    expect(second.history.canUndo).toBe(false);
    expect(second.history.canRedo).toBe(false);
  });
});

// A document that exercises EVERY Stage F2 (ADR-0009, formatVersion 0.4.0) shape at once: IK depth
// (signed bend, softness, stretch/compress/uniform) and explicit constraint `order`; transform local /
// relative variants; a linked mesh; region and mesh frame `sequence`; per-component split bone tracks;
// split slot rgb/alpha, keyable dark, and sequence timelines; and skin-scoped bones/constraints. Carried
// verbatim by document-core (no authoring command yet, PP-D10), so exportDocument(loadDocument(R)) === R.
function f2Document(): SkeletonDocument {
  const white = { r: 1, g: 1, b: 1, a: 1 } as const;
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'f2',
    hash: '',
    bones: [
      { name: 'root', parent: null, ...GEOM },
      { name: 'upper', parent: 'root', ...GEOM },
      { name: 'lower', parent: 'upper', ...GEOM },
      { name: 'target', parent: 'root', ...GEOM },
      { name: 'driver', parent: 'root', ...GEOM },
      { name: 'follower', parent: 'root', ...GEOM },
    ],
    slots: [
      { name: 'slot_a', bone: 'root', color: white, attachment: 'reg', blendMode: 'normal' },
      // slot_body carries a setup darkColor so the animation may key a `dark` (two-color) track.
      {
        name: 'slot_body',
        bone: 'root',
        color: white,
        darkColor: { r: 0, g: 0, b: 0, a: 1 },
        attachment: 'body',
        blendMode: 'normal',
      },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          slot_a: {
            // A region attachment with a frame sequence (ADR-0009 section 3).
            reg: {
              type: 'region',
              path: 'reg',
              x: 0,
              y: 0,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              width: 32,
              height: 32,
              color: white,
              sequence: { count: 4, start: 0, digits: 2, setupIndex: 1 },
            },
          },
          slot_body: {
            // A mesh with its own sequence, plus a linked mesh that reuses its geometry.
            body: {
              type: 'mesh',
              path: 'body',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              hullLength: 4,
              width: 32,
              height: 32,
              color: white,
              vertices: [0, 0, 32, 0, 32, 32, 0, 32],
              sequence: { count: 2, start: 3, digits: 1, setupIndex: 0 },
            },
            bodyLink: {
              type: 'linkedmesh',
              path: 'bodyLink',
              parent: 'body',
              timelines: false,
              width: 32,
              height: 32,
              color: white,
            },
          },
        },
      },
      // A named skin with scoped bones and constraints (ADR-0009 section 5).
      { name: 'variant', attachments: {}, bones: ['upper'], constraints: ['ik1', 'tc1'] },
    ],
    ikConstraints: [
      {
        name: 'ik1',
        bones: ['upper', 'lower'],
        target: 'target',
        mix: 1,
        bend: -1,
        softness: 5,
        stretch: true,
        compress: true,
        uniform: true,
        order: 0,
      },
    ],
    transformConstraints: [
      {
        name: 'tc1',
        bones: ['follower'],
        target: 'driver',
        mixRotate: 1,
        mixX: 0,
        mixY: 0,
        mixScaleX: 0,
        mixScaleY: 0,
        mixShearY: 0,
        offsetRotation: 0,
        offsetX: 0,
        offsetY: 0,
        offsetScaleX: 0,
        offsetScaleY: 0,
        offsetShearY: 0,
        local: true,
        relative: true,
        order: 1,
      },
    ],
    pathConstraints: [],
    events: [],
    animations: {
      a1: {
        duration: 1,
        bones: {
          // A joint channel (rotate) on one bone and per-component SPLIT tracks on another (ADR-0009 4.1).
          upper: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 0.5, value: { angle: 20 }, curve: 'linear' },
            ],
          },
          lower: {
            translateX: [
              { time: 0, value: { value: 0 }, curve: 'linear' },
              {
                time: 0.5,
                value: { value: 4 },
                curve: { type: 'bezier', cx1: 0.25, cy1: 0, cx2: 0.75, cy2: 1 },
              },
            ],
            scaleY: [{ time: 0, value: { value: 1 }, curve: 'stepped' }],
            shearX: [{ time: 0, value: { value: 2 }, curve: 'linear' }],
          },
        },
        slots: {
          // Split rgb/alpha on one slot (ADR-0009 4.2); keyable dark + sequence on another (4.3, 3).
          slot_a: {
            rgb: [{ time: 0, value: { rgb: { r: 1, g: 0.5, b: 0 } }, curve: 'linear' }],
            alpha: [{ time: 0, value: { alpha: 0.5 }, curve: 'linear' }],
          },
          slot_body: {
            dark: [
              { time: 0, value: { color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } }, curve: 'linear' },
            ],
            sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }],
          },
        },
        ik: {
          // A keyed IK frame carries the signed bend plus optional depth channels (ADR-0009 section 1).
          ik1: [
            {
              time: 0,
              value: { mix: 1, bend: -1, softness: 5, stretch: true, compress: false },
              curve: 'stepped',
            },
          ],
        },
        transform: {
          tc1: [{ time: 0, value: { mixRotate: 1 }, curve: 'linear' }],
        },
        deform: {},
        drawOrder: [],
        events: [],
        path: {},
      },
    },
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: (['reg', 'body', 'bodyLink'] as const).map((name, index) => ({
            name,
            x: index * 32,
            y: 0,
            w: 32,
            h: 32,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            originalW: 32,
            originalH: 32,
          })),
        },
      ],
    },
  };
  return { ...draft, hash: computeContentHash(draft) };
}

describe('Stage F2 (0.4.0) carry through load and export', () => {
  it('round-trips every new F2 shape deep-equal (hash included)', () => {
    const original = f2Document();

    const doc = loadDocument(original, makeTestEnv().env);
    const exported = exportDocument(doc.model);

    // Lossless: the projection reproduces the source byte for byte (content hash included). The F2 shapes
    // are stamped at the CURRENT version (the builder uses CURRENT_FORMAT_VERSION, now 0.5.0).
    expect(exported).toEqual(original);
    expect(exported.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(verifyContentHash(exported)).toBe(true);
  });

  it('survives a History snapshot round-trip without dropping carried F2 data', () => {
    const original = f2Document();
    const doc = loadDocument(original, makeTestEnv().env);

    // A non-F2 edit forces a full-state snapshot/restore; undo must return the carried data intact.
    const before = doc.model.snapshot();
    doc.history.execute(
      new CreateBoneCommand(doc.ids.mint('bone'), null, { name: 'tmp', ...GEOM }),
    );
    doc.history.undo();

    expect(doc.model.snapshot()).toEqual(before);
    expect(exportDocument(doc.model)).toEqual(original);
  });
});

// A document that exercises EVERY Stage F3 (ADR-0011, formatVersion 0.5.0) path shape at once: a `path`
// ATTACHMENT (a one-curve open cubic spline carried on a slot as its setup-active attachment), a root
// path CONSTRAINT that distributes a bone along that slot's path, and a per-animation `path` TIMELINE that
// keys the constraint. document-core carries all three verbatim (no authoring command yet, PP-D11): the
// path attachment rides the preserved-attachment kind, the constraint rides preserved.pathConstraints, and
// the timeline rides the AnimationEntity.path record, so exportDocument(loadDocument(R)) === R.
function f3Document(): SkeletonDocument {
  const white = { r: 1, g: 1, b: 1, a: 1 } as const;
  const draft: SkeletonDocument = {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'f3',
    hash: '',
    bones: [
      { name: 'root', parent: null, ...GEOM, rotation: 0 },
      { name: 'rider', parent: 'root', ...GEOM, rotation: 0 },
    ],
    // The slot carries the path attachment as its setup-active attachment, so the constraint target
    // statically resolves to a path (exercising PATH_TARGET_NOT_PATH's satisfied branch on load).
    slots: [
      { name: 'rail', bone: 'root', color: white, attachment: 'spline', blendMode: 'normal' },
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          rail: {
            // An OPEN one-curve cubic spline: V = 4 control points (8 coords), so (V-1) % 3 == 0 and
            // curveCount == 1; one cumulative arc length in `lengths`. Unweighted (no `bones`).
            spline: {
              type: 'path',
              closed: false,
              constantSpeed: true,
              lengths: [100],
              vertices: [0, 0, 33, 0, 66, 0, 100, 0],
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [
      {
        name: 'pc1',
        target: 'rail',
        bones: ['rider'],
        positionMode: 'percent',
        spacingMode: 'length',
        rotateMode: 'tangent',
        position: 0,
        spacing: 0,
        offsetRotation: 0,
        mixRotate: 1,
        mixX: 1,
        mixY: 1,
      },
    ],
    events: [],
    animations: {
      glide: {
        duration: 1,
        bones: {},
        slots: {},
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [],
        events: [],
        // A path timeline keying the base position and the rotate mix over time (partial frames).
        path: {
          pc1: [
            { time: 0, value: { position: 0, mixRotate: 1 }, curve: 'linear' },
            { time: 1, value: { position: 1, mixRotate: 0 }, curve: 'stepped' },
          ],
        },
      },
    },
    atlas: { pages: [] },
  };
  return { ...draft, hash: computeContentHash(draft) };
}

describe('Stage F3 (0.5.0) path carry through load and export', () => {
  it('round-trips a path attachment, path constraint, and path timeline deep-equal (hash included)', () => {
    const original = f3Document();

    const doc = loadDocument(original, makeTestEnv().env);

    // The UNWEIGHTED path attachment is promoted to an editable path entity (PP-D11); its control points
    // and recomputed-on-edit arc-length table are first-class, and it exports back deep-equal (below).
    const rail = doc.model.slots().find((s) => s.name === 'rail')!;
    const spline = doc.model.getAttachment(rail.id, 'spline');
    expect(spline?.kind).toBe('path');
    if (spline?.kind === 'path') {
      expect(spline.closed).toBe(false);
      expect(spline.constantSpeed).toBe(true);
      expect(spline.lengths).toEqual([100]);
      expect(spline.vertices).toEqual([0, 0, 33, 0, 66, 0, 100, 0]);
    }
    // The path constraint is promoted to an editable entity (PP-D11) and its bones/target resolve to ids;
    // the per-animation path timeline is still carried by name. Both export deep-equal (below).
    expect(doc.model.pathConstraints().map((c) => c.name)).toEqual(['pc1']);
    const glide = doc.model.animations().find((a) => a.name === 'glide')!;
    expect(Object.keys(glide.path)).toEqual(['pc1']);
    expect(glide.path['pc1']).toHaveLength(2);

    const exported = exportDocument(doc.model);
    expect(exported).toEqual(original); // lossless, hash included
    expect(exported.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(verifyContentHash(exported)).toBe(true);
  });

  it('survives a History snapshot round-trip without dropping carried path data', () => {
    const original = f3Document();
    const doc = loadDocument(original, makeTestEnv().env);

    // A non-path edit forces a full-state snapshot/restore; undo must return the carried path data intact.
    const before = doc.model.snapshot();
    doc.history.execute(
      new CreateBoneCommand(doc.ids.mint('bone'), null, { name: 'tmp', ...GEOM }),
    );
    doc.history.undo();

    expect(doc.model.snapshot()).toEqual(before);
    expect(exportDocument(doc.model)).toEqual(original);
  });
});
