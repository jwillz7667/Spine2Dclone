// Generates the skeleton golden corpus (format-contract WP-F.10, phase-0-foundations.md WP-0.3):
// one canonical valid `minimal.json` plus one `invalid/<CODE>.json` per reachable error code, each
// invalid by exactly ONE fault. It also emits the WP-1.11 (phase-1-bone-puppet.md section 5) positive
// completeness fixture `phase1-complete.json`, the stage F1 (ADR-0008) positive completeness fixture
// `events-draworder.json` (event definitions, event and draw-order timelines, metadata), and the stage
// F2 (ADR-0009) positive completeness fixture `f2-complete.json` (constraint depth and order, a linked
// mesh, a sequence attachment, per-component and split-color and dark timelines, and skin scoping). The
// corpus is committed; this script is its provenance, so a reviewer can see precisely which single field
// each fixture breaks. Run: pnpm gen:fixtures.
//
// The valid fixtures carry a correct content hash (so they validate with zero warnings). The
// invalid semantic/structural fixtures carry an empty hash, which yields only a HASH_ABSENT warning
// (never a HASH error), so each invalid document trips exactly its targeted error family.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeContentHash } from '../src/hash/hash';
import { validateDocument } from '../src/validate';
import type { SkeletonDocument } from '../src/schema/document';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const invalidDir = join(fixturesDir, 'invalid');

// The minimal valid rig: 1 root bone, 1 slot, 1 region attachment, 1 one-second idle animation with
// two rotate keyframes (handoff section 12 step 2). Authored with an empty hash; the real hash is
// computed and embedded below.
function minimalDraft(): SkeletonDocument {
  return {
    formatVersion: '0.4.0',
    name: 'minimal',
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
    events: [],
    animations: {
      idle: {
        duration: 1,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 30 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [],
        events: [],
      },
    },
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
}

// Build the canonical valid document with its real content hash embedded.
function minimalValid(): SkeletonDocument {
  const draft = minimalDraft();
  return { ...draft, hash: computeContentHash(draft) };
}

// The WP-1.11 positive COMPLETENESS fixture (phase-1-bone-puppet.md section 5, TASK-1.11.3): a real
// rig (a root + child bone hierarchy, one slot, one region attachment in the default skin) whose
// idle animation authors EVERY Phase-1 channel: bone rotate/translate/scale/shear (across linear,
// stepped, and a valid in-range bezier curve) plus slot color. The animation is the strict
// `{ duration, bones, slots }` Animation shape only: the implemented format Animation
// (schema/animation.ts) is a `.strict()` object with exactly those three keys, so it carries NO
// ik/transform/deform/drawOrder/event collections (emitting any would fail the structural layer as
// SCHEMA_SHAPE). Authored with an empty hash; the real hash is embedded in phase1CompleteValid below
// so the fixture validates with zero errors and zero warnings.
function phase1CompleteDraft(): SkeletonDocument {
  return {
    formatVersion: '0.4.0',
    name: 'phase1-complete',
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
      {
        name: 'child',
        parent: 'root',
        length: 80,
        x: 100,
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
    events: [],
    animations: {
      idle: {
        duration: 1,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              {
                time: 0.5,
                value: { angle: 12 },
                curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
              },
              { time: 1, value: { angle: 0 }, curve: 'linear' },
            ],
            translate: [
              { time: 0, value: { x: 0, y: 0 }, curve: 'linear' },
              { time: 1, value: { x: 6, y: 0 }, curve: 'linear' },
            ],
          },
          child: {
            scale: [
              { time: 0, value: { x: 1, y: 1 }, curve: 'stepped' },
              { time: 1, value: { x: 1.1, y: 1.1 }, curve: 'linear' },
            ],
            shear: [
              { time: 0, value: { x: 0, y: 0 }, curve: 'linear' },
              { time: 1, value: { x: 4, y: 0 }, curve: 'linear' },
            ],
          },
        },
        slots: {
          body: {
            color: [
              { time: 0, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' },
              { time: 1, value: { color: { r: 1, g: 0.85, b: 0.7, a: 1 } }, curve: 'linear' },
            ],
          },
        },
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [],
        events: [],
      },
    },
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
}

// Build the Phase-1 completeness document with its real content hash embedded.
function phase1CompleteValid(): SkeletonDocument {
  const draft = phase1CompleteDraft();
  return { ...draft, hash: computeContentHash(draft) };
}

// The stage F1 (ADR-0008) positive COMPLETENESS fixture: a two-slot rig whose idle animation exercises
// every new 0.3.0 shape. Root events define an audio-backed event ('footstep') and a payload-carrying
// event ('spawn', with int/float/string defaults). The idle animation's draw-order timeline restores
// the setup order at time 0 (empty offsets) then swaps the two slots at 0.5 (offsets that resolve to a
// valid permutation). The event timeline fires 'footstep', then two coincident events at time 0.5 (one
// overriding the 'spawn' int payload), proving non-decreasing ordering and payload overrides. A
// metadata block carries the authoring frame rate and asset directories. Authored with an empty hash;
// the real hash is embedded in eventsDrawOrderValid below.
function eventsDrawOrderDraft(): SkeletonDocument {
  const region = (name: string) => ({
    type: 'region' as const,
    path: name,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
  });
  const slot = (name: string, attachment: string) => ({
    name,
    bone: 'root',
    color: { r: 1, g: 1, b: 1, a: 1 },
    attachment,
    blendMode: 'normal' as const,
  });
  const atlasRegion = (name: string, x: number) => ({
    name,
    x,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  });
  return {
    formatVersion: '0.4.0',
    name: 'events-draworder',
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
    slots: [slot('back', 'back'), slot('front', 'front')],
    skins: [
      {
        name: 'default',
        attachments: {
          back: { back: region('back') },
          front: { front: region('front') },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    events: [
      { name: 'footstep', audio: { path: 'sfx/step.wav', volume: 0.8, balance: 0 } },
      { name: 'spawn', int: 3, float: 1.5, string: 'hero' },
    ],
    animations: {
      idle: {
        duration: 1,
        bones: {},
        slots: {},
        ik: {},
        transform: {},
        deform: {},
        drawOrder: [
          { time: 0, offsets: [] },
          {
            time: 0.5,
            offsets: [
              { slot: 'back', offset: 1 },
              { slot: 'front', offset: -1 },
            ],
          },
        ],
        events: [
          { time: 0.25, name: 'footstep' },
          { time: 0.5, name: 'spawn', int: 9 },
          { time: 0.5, name: 'footstep' },
        ],
      },
    },
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('back', 0), atlasRegion('front', 64)],
        },
      ],
    },
    metadata: { fps: 30, imagesPath: 'images/', audioPath: 'audio/' },
  };
}

// Build the stage F1 completeness document with its real content hash embedded.
function eventsDrawOrderValid(): SkeletonDocument {
  const draft = eventsDrawOrderDraft();
  return { ...draft, hash: computeContentHash(draft) };
}

// The stage F2 (ADR-0009) positive COMPLETENESS fixture: a rig that exercises every new 0.4.0 shape end
// to end. Two IK constraints carry softness/stretch/compress/uniform and a signed bend with an explicit
// order; a transform constraint carries the local variant and closes the dense order [0, 3). A mesh on
// the `limb` slot has a linked mesh child that reuses its geometry, and the animation deforms the linked
// mesh (its V resolved through the parent). The `body` region carries a frame sequence, and the animation
// keys per-component bone tracks (with a per-component bezier), split slot rgb/alpha and a two-color dark
// timeline (the slot defines a setup darkColor), a sequence timeline, and a keyed IK frame with softness.
// The default skin scopes a bone and constraints. Authored with an empty hash; the real hash is embedded
// in f2CompleteValid below so the fixture validates with zero errors and zero warnings.
function f2CompleteDraft(): SkeletonDocument {
  const bone = (name: string, parent: string | null, x: number) => ({
    name,
    parent,
    length: 100,
    x,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal' as const,
  });
  const atlasRegion = (name: string, x: number) => ({
    name,
    x,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  });
  const white = { r: 1, g: 1, b: 1, a: 1 };
  return {
    formatVersion: '0.4.0',
    name: 'f2-complete',
    hash: '',
    bones: [bone('root', null, 0), bone('child', 'root', 100), bone('target', 'root', 200)],
    slots: [
      { name: 'body', bone: 'root', color: white, darkColor: { r: 0, g: 0, b: 0, a: 1 }, attachment: 'body', blendMode: 'normal' },
      { name: 'limb', bone: 'child', color: white, attachment: 'baseMesh', blendMode: 'normal' },
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
              color: white,
              sequence: { count: 3, start: 1, digits: 2, setupIndex: 1 },
            },
          },
          limb: {
            baseMesh: {
              type: 'mesh',
              path: 'baseRegion',
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              hullLength: 4,
              width: 64,
              height: 64,
              color: white,
              vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
            },
            linkedLimb: {
              type: 'linkedmesh',
              path: 'linkedRegion',
              parent: 'baseMesh',
              timelines: false,
              width: 64,
              height: 64,
              color: white,
            },
          },
        },
        bones: ['child'],
        constraints: ['ik1', 'tc1'],
      },
    ],
    ikConstraints: [
      {
        name: 'ik1',
        bones: ['root', 'child'],
        target: 'target',
        mix: 1,
        bend: 1,
        softness: 8,
        stretch: true,
        compress: false,
        uniform: true,
        order: 0,
      },
      {
        name: 'ik2',
        bones: ['child'],
        target: 'target',
        mix: 0.5,
        bend: -1,
        softness: 0,
        stretch: false,
        compress: true,
        uniform: false,
        order: 1,
      },
    ],
    transformConstraints: [
      {
        name: 'tc1',
        bones: ['child'],
        target: 'root',
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
        relative: false,
        order: 2,
      },
    ],
    events: [],
    animations: {
      idle: {
        duration: 1,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 10 }, curve: 'linear' },
            ],
          },
          child: {
            translateX: [
              {
                time: 0,
                value: { value: 0 },
                curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
              },
              { time: 1, value: { value: 5 }, curve: 'linear' },
            ],
            translateY: [{ time: 0, value: { value: 0 }, curve: 'linear' }],
            scaleX: [{ time: 0, value: { value: 1 }, curve: 'stepped' }],
            scaleY: [{ time: 0, value: { value: 1 }, curve: 'linear' }],
            shearX: [{ time: 0, value: { value: 0 }, curve: 'linear' }],
            shearY: [{ time: 0, value: { value: 0 }, curve: 'linear' }],
          },
        },
        slots: {
          body: {
            rgb: [
              { time: 0, value: { rgb: { r: 1, g: 1, b: 1 } }, curve: 'linear' },
              { time: 1, value: { rgb: { r: 1, g: 0.5, b: 0.2 } }, curve: 'linear' },
            ],
            alpha: [
              { time: 0, value: { alpha: 1 }, curve: 'linear' },
              { time: 1, value: { alpha: 0.5 }, curve: 'linear' },
            ],
            dark: [
              { time: 0, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' },
              { time: 1, value: { color: { r: 0.1, g: 0.1, b: 0.2, a: 1 } }, curve: 'linear' },
            ],
            sequence: [{ time: 0, mode: 'loop', index: 0, delay: 0.1 }],
          },
        },
        ik: {
          ik1: [
            {
              time: 0,
              value: { mix: 1, bend: 1, softness: 8, stretch: true, compress: false },
              curve: 'stepped',
            },
          ],
        },
        transform: {
          tc1: [{ time: 0, value: { mixRotate: 1 }, curve: 'linear' }],
        },
        deform: {
          default: {
            limb: {
              linkedLimb: [
                { time: 0, value: { offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, curve: 'linear' },
              ],
            },
          },
        },
        drawOrder: [{ time: 0, offsets: [] }],
        events: [],
      },
    },
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 256,
          height: 256,
          regions: [atlasRegion('body', 0), atlasRegion('baseRegion', 64), atlasRegion('linkedRegion', 128)],
        },
      ],
    },
    metadata: { fps: 30 },
  };
}

// Build the stage F2 completeness document with its real content hash embedded.
function f2CompleteValid(): SkeletonDocument {
  const draft = f2CompleteDraft();
  return { ...draft, hash: computeContentHash(draft) };
}

// Each invalid case clones the minimal draft (empty hash) and applies exactly one fault. The
// returned value is serialized verbatim; some faults are intentionally off-type (an unknown key, a
// bad bezier), which is why a few builders return a looser object than SkeletonDocument.
interface InvalidCase {
  readonly code: string;
  readonly build: () => unknown;
}

function draft(): SkeletonDocument {
  return minimalDraft();
}

// A base with a `limb` slot carrying a mesh `baseMesh` and a linked mesh `dst` (parent `baseMesh`), plus
// the atlas regions they reference. Valid until a linked-mesh case mutates the link.
function linkedMeshBase(): SkeletonDocument {
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const region = (name: string, x: number) => ({
    name,
    x,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  });
  const doc = draft();
  doc.slots.push({
    name: 'limb',
    bone: 'root',
    color: white,
    attachment: 'baseMesh',
    blendMode: 'normal',
  });
  doc.skins[0]!.attachments['limb'] = {
    baseMesh: {
      type: 'mesh',
      path: 'baseRegion',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      color: white,
      vertices: [-10, -10, 10, -10, 10, 10, -10, 10],
    },
    dst: {
      type: 'linkedmesh',
      path: 'linkedRegion',
      parent: 'baseMesh',
      timelines: false,
      width: 64,
      height: 64,
      color: white,
    },
  };
  doc.atlas.pages[0]!.regions.push(region('baseRegion', 64), region('linkedRegion', 128));
  return doc;
}

const invalidCases: readonly InvalidCase[] = [
  {
    code: 'SCHEMA_SHAPE',
    build: () => ({ ...draft(), unexpectedKey: true }),
  },
  {
    code: 'UNSUPPORTED_FORMAT_VERSION',
    build: () => ({ ...draft(), formatVersion: '1.0.0' }),
  },
  {
    code: 'COLOR_RANGE',
    build: () => {
      const doc = draft();
      doc.slots[0]!.color = { r: 2, g: 1, b: 1, a: 1 };
      return doc;
    },
  },
  {
    code: 'CURVE_BEZIER_X_RANGE',
    build: () => {
      const doc = draft();
      doc.animations.idle!.bones.root!.rotate![1]!.curve = {
        type: 'bezier',
        cx1: 2,
        cy1: 0,
        cx2: 0.5,
        cy2: 1,
      };
      return doc;
    },
  },
  {
    code: 'BONE_NAME_DUPLICATE',
    build: () => {
      const doc = draft();
      doc.bones.push({ ...doc.bones[0]!, parent: null });
      return doc;
    },
  },
  {
    code: 'BONE_PARENT_MISSING',
    build: () => {
      const doc = draft();
      doc.bones.push({ ...doc.bones[0]!, name: 'child', parent: 'ghost' });
      return doc;
    },
  },
  {
    code: 'BONE_ORDER_VIOLATION',
    build: () => {
      const doc = draft();
      const root = doc.bones[0]!;
      doc.bones = [{ ...root, name: 'child', parent: 'root' }, root];
      return doc;
    },
  },
  {
    code: 'SLOT_NAME_DUPLICATE',
    build: () => {
      const doc = draft();
      doc.slots.push({ ...doc.slots[0]!, attachment: null });
      return doc;
    },
  },
  {
    code: 'SLOT_BONE_MISSING',
    build: () => {
      const doc = draft();
      doc.slots[0]!.bone = 'ghost';
      return doc;
    },
  },
  {
    code: 'SLOT_ATTACHMENT_MISSING',
    build: () => {
      const doc = draft();
      doc.slots[0]!.attachment = 'missing';
      return doc;
    },
  },
  {
    code: 'SKIN_DEFAULT_MISSING',
    build: () => {
      const doc = draft();
      doc.skins[0]!.name = 'other';
      return doc;
    },
  },
  {
    code: 'SKIN_SLOT_UNKNOWN',
    build: () => {
      const doc = draft();
      doc.skins[0]!.attachments['ghostSlot'] = {};
      return doc;
    },
  },
  {
    code: 'ATLAS_REGION_DUPLICATE',
    build: () => {
      const doc = draft();
      doc.atlas.pages[0]!.regions.push({ ...doc.atlas.pages[0]!.regions[0]! });
      return doc;
    },
  },
  {
    code: 'ATTACHMENT_REGION_MISSING',
    build: () => {
      const doc = draft();
      const attachment = doc.skins[0]!.attachments['body']!['body']!;
      if (attachment.type === 'region') attachment.path = 'ghostRegion';
      return doc;
    },
  },
  {
    code: 'ANIM_BONE_UNKNOWN',
    build: () => {
      const doc = draft();
      doc.animations.idle!.bones = {
        ghost: {
          rotate: [
            { time: 0, value: { angle: 0 }, curve: 'linear' },
            { time: 1, value: { angle: 10 }, curve: 'linear' },
          ],
        },
      };
      return doc;
    },
  },
  {
    code: 'ANIM_SLOT_UNKNOWN',
    build: () => {
      const doc = draft();
      doc.animations.idle!.slots = {
        ghostSlot: {
          color: [{ time: 0, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' }],
        },
      };
      return doc;
    },
  },
  {
    code: 'ANIM_TIME_ORDER',
    build: () => {
      const doc = draft();
      doc.animations.idle!.bones.root!.rotate = [
        { time: 0, value: { angle: 0 }, curve: 'linear' },
        { time: 0, value: { angle: 30 }, curve: 'linear' },
      ];
      return doc;
    },
  },
  {
    code: 'ANIM_TIME_RANGE',
    build: () => {
      const doc = draft();
      doc.animations.idle!.bones.root!.rotate = [
        { time: -1, value: { angle: 0 }, curve: 'linear' },
        { time: 0.5, value: { angle: 30 }, curve: 'linear' },
      ];
      return doc;
    },
  },
  {
    code: 'ANIM_DURATION',
    build: () => {
      // duration 0 with a single keyframe at time 0 isolates ANIM_DURATION (duration must be > 0 when
      // the animation has keyframes) with no ANIM_TIME_RANGE: time 0 is within [0, 0].
      const doc = draft();
      doc.animations.idle!.duration = 0;
      doc.animations.idle!.bones.root!.rotate = [{ time: 0, value: { angle: 0 }, curve: 'linear' }];
      return doc;
    },
  },
  {
    code: 'EVENT_NAME_DUPLICATE',
    build: () => {
      const doc = draft();
      doc.events = [{ name: 'hit' }, { name: 'hit' }];
      return doc;
    },
  },
  {
    code: 'ANIM_EVENT_UNKNOWN',
    build: () => {
      // The document defines no events, so the idle animation firing "ghost" is an unknown reference.
      const doc = draft();
      doc.animations.idle!.events = [{ time: 0, name: 'ghost' }];
      return doc;
    },
  },
  {
    code: 'EVENT_AUDIO_RANGE',
    build: () => {
      const doc = draft();
      doc.events = [{ name: 'hit', audio: { path: 'sfx/hit.wav', volume: 2, balance: 0 } }];
      return doc;
    },
  },
  {
    code: 'DRAWORDER_INCOMPLETE',
    build: () => {
      // One slot with an offset that moves it outside [0, slotCount) is an inconsistent reordering.
      const doc = draft();
      doc.animations.idle!.drawOrder = [{ time: 0, offsets: [{ slot: 'body', offset: 3 }] }];
      return doc;
    },
  },
  {
    code: 'IK_SOFTNESS_RANGE',
    build: () => {
      const doc = draft();
      doc.ikConstraints.push({
        name: 'ik',
        bones: ['root'],
        target: 'root',
        mix: 1,
        bend: 1,
        softness: -1,
        stretch: false,
        compress: false,
        uniform: false,
      });
      return doc;
    },
  },
  {
    code: 'CONSTRAINT_ORDER_INVALID',
    build: () => {
      // Order is set on one of two constraints (all-or-none violation).
      const doc = draft();
      const base = {
        bones: ['root'],
        target: 'root',
        mix: 1,
        bend: 1 as const,
        softness: 0,
        stretch: false,
        compress: false,
        uniform: false,
      };
      doc.ikConstraints.push({ name: 'ikA', ...base, order: 0 }, { name: 'ikB', ...base });
      return doc;
    },
  },
  {
    code: 'LINKED_MESH_PARENT_MISSING',
    build: () => {
      const doc = linkedMeshBase();
      const dst = doc.skins[0]!.attachments['limb']!['dst']!;
      if (dst.type === 'linkedmesh') dst.parent = 'ghost';
      return doc;
    },
  },
  {
    code: 'LINKED_MESH_PARENT_INVALID',
    build: () => {
      // The parent resolves but is a region (no geometry to inherit).
      const doc = linkedMeshBase();
      doc.skins[0]!.attachments['limb']!['baseMesh'] = {
        type: 'region',
        path: 'baseRegion',
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
      };
      return doc;
    },
  },
  {
    code: 'LINKED_MESH_CYCLE',
    build: () => {
      // baseMesh becomes a linked mesh pointing at dst, and dst points at baseMesh (a cycle).
      const doc = linkedMeshBase();
      doc.skins[0]!.attachments['limb']!['baseMesh'] = {
        type: 'linkedmesh',
        path: 'baseRegion',
        parent: 'dst',
        timelines: false,
        width: 64,
        height: 64,
        color: { r: 1, g: 1, b: 1, a: 1 },
      };
      return doc;
    },
  },
  {
    code: 'SEQUENCE_SETUP_RANGE',
    build: () => {
      const doc = draft();
      const att = doc.skins[0]!.attachments['body']!['body']!;
      if (att.type === 'region') att.sequence = { count: 2, start: 0, digits: 2, setupIndex: 5 };
      return doc;
    },
  },
  {
    code: 'TIMELINE_COMPONENT_CONFLICT',
    build: () => {
      // Both the joint translate track and a split translateX track on one bone.
      const doc = draft();
      doc.animations.idle!.bones.root = {
        translate: [{ time: 0, value: { x: 0, y: 0 }, curve: 'linear' }],
        translateX: [{ time: 0, value: { value: 0 }, curve: 'linear' }],
      };
      return doc;
    },
  },
  {
    code: 'ANIM_DARK_NO_SETUP',
    build: () => {
      // A dark timeline on a slot with no setup darkColor.
      const doc = draft();
      doc.animations.idle!.slots.body = {
        dark: [{ time: 0, value: { color: { r: 0, g: 0, b: 0, a: 1 } }, curve: 'linear' }],
      };
      return doc;
    },
  },
  {
    code: 'SKIN_BONE_UNKNOWN',
    build: () => {
      const doc = draft();
      doc.skins[0]!.bones = ['ghost'];
      return doc;
    },
  },
  {
    code: 'SKIN_CONSTRAINT_UNKNOWN',
    build: () => {
      const doc = draft();
      doc.skins[0]!.constraints = ['ghost'];
      return doc;
    },
  },
  {
    code: 'HASH_MISMATCH',
    build: () => {
      const doc = minimalValid();
      const firstChar = doc.hash[0] === '0' ? '1' : '0';
      return { ...doc, hash: `${firstChar}${doc.hash.slice(1)}` };
    },
  },
];

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main(): void {
  rmSync(invalidDir, { recursive: true, force: true });
  mkdirSync(invalidDir, { recursive: true });

  const valid = minimalValid();
  writeJson(join(fixturesDir, 'minimal.json'), valid);
  const validReport = validateDocument(valid);
  if (!validReport.ok || validReport.warnings.length > 0) {
    throw new Error(
      `minimal.json did not validate clean: ok=${validReport.ok}, errors=${validReport.errors.length}, warnings=${validReport.warnings.length}`,
    );
  }

  const phase1Complete = phase1CompleteValid();
  writeJson(join(fixturesDir, 'phase1-complete.json'), phase1Complete);
  const phase1Report = validateDocument(phase1Complete);
  if (!phase1Report.ok || phase1Report.warnings.length > 0) {
    throw new Error(
      `phase1-complete.json did not validate clean: ok=${phase1Report.ok}, errors=${phase1Report.errors.length}, warnings=${phase1Report.warnings.length}`,
    );
  }

  const eventsDrawOrder = eventsDrawOrderValid();
  writeJson(join(fixturesDir, 'events-draworder.json'), eventsDrawOrder);
  const eventsReport = validateDocument(eventsDrawOrder);
  if (!eventsReport.ok || eventsReport.warnings.length > 0) {
    throw new Error(
      `events-draworder.json did not validate clean: ok=${eventsReport.ok}, errors=${eventsReport.errors.length}, warnings=${eventsReport.warnings.length}`,
    );
  }

  const f2Complete = f2CompleteValid();
  writeJson(join(fixturesDir, 'f2-complete.json'), f2Complete);
  const f2Report = validateDocument(f2Complete);
  if (!f2Report.ok || f2Report.warnings.length > 0) {
    throw new Error(
      `f2-complete.json did not validate clean: ok=${f2Report.ok}, errors=${f2Report.errors.length}, warnings=${f2Report.warnings.length}, codes=[${f2Report.errors.map((e) => e.code).join(', ')}]`,
    );
  }

  for (const testCase of invalidCases) {
    const document = testCase.build();
    writeJson(join(invalidDir, `${testCase.code}.json`), document);
    const report = validateDocument(document);
    const codes = report.errors.map((error) => error.code);
    if (!codes.includes(testCase.code as (typeof codes)[number])) {
      throw new Error(
        `fixture ${testCase.code}.json expected code ${testCase.code}, got [${codes.join(', ')}]`,
      );
    }
  }

  console.log(
    `generated minimal.json + phase1-complete.json + events-draworder.json + f2-complete.json + ${invalidCases.length} invalid fixtures`,
  );
}

main();
