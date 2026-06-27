// Generates the Phase-0 golden corpus (format-contract WP-F.10, phase-0-foundations.md WP-0.3):
// one canonical valid `minimal.json` plus one `invalid/<CODE>.json` per Phase-0-reachable error
// code, each invalid by exactly ONE fault. It also emits the WP-1.11 (phase-1-bone-puppet.md
// section 5) positive completeness fixture `phase1-complete.json`. The corpus is committed; this
// script is its provenance, so a reviewer can see precisely which single field each fixture breaks.
// Run: pnpm gen:fixtures.
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
    formatVersion: '0.2.0',
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
    formatVersion: '0.2.0',
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
    `generated minimal.json + phase1-complete.json + ${invalidCases.length} invalid fixtures`,
  );
}

main();
