import type {
  Animation,
  AtlasRegion,
  Bone,
  IkConstraint,
  MeshAttachment,
  RegionAttachment,
  SkeletonDocument,
  Slot,
  TransformConstraint,
} from '@marionette/format/types';
import { CURRENT_FORMAT_VERSION } from '@marionette/format';
import { makeIdFactory, type DocumentEnvironment } from '../src';

// In-memory format seed documents for the round-trip harness and command tests. They are valid
// SkeletonDocuments (default skin present, bones >= 1) carried as drafts (hash ''), so loadDocument
// accepts them with verifyHash off. They stand in for the packages/format golden fixtures without
// coupling the document-core tests to that package's test files.
function bone(name: string, parent: string | null, overrides: Partial<Bone> = {}): Bone {
  return {
    name,
    parent,
    length: 100,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    transformMode: 'normal',
    ...overrides,
  };
}

function slot(name: string, boneName: string, overrides: Partial<Slot> = {}): Slot {
  return {
    name,
    bone: boneName,
    color: { r: 1, g: 1, b: 1, a: 1 },
    attachment: null,
    blendMode: 'normal',
    ...overrides,
  };
}

function region(path: string): RegionAttachment {
  return {
    type: 'region',
    path,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
  };
}

// A valid UNWEIGHTED mesh attachment: a 4-corner quad hull (hullLength 4) plus one interior center
// vertex (5 vertices total), fan-triangulated, with flat [x,y,...] vertices and no `bones` (unweighted)
// and no `edges`. This is the WP-2.1 mesh-edit seed: every mesh command can target it (add/delete change
// the interior vertex; delete returns it to the 4-corner quad).
function mesh(path: string): MeshAttachment {
  return {
    type: 'mesh',
    path,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1, 0.5, 0.5],
    triangles: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
    hullLength: 4,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [0, 0, 64, 0, 64, 64, 0, 64, 32, 32],
  };
}

// A valid WEIGHTED mesh attachment: a 4-corner quad bound to GLOBAL bones 0 (root, setup world identity)
// and 1 (arm, setup world translate(50, 0)) at every vertex. Per-vertex weights are 0.5 / 0.49995, which
// sum to 0.99995: DELIBERATELY within WEIGHT_SUM_EPSILON (1e-4) of 1 but not exactly 1, so
// NormalizeMeshWeights produces a real delta while every other weighted command re-normalizes regardless.
// The arm bind-local vx is (worldX - 50) because arm sits at x = 50. boneIndex is GLOBAL (ADR-0002).
function weightedMesh(path: string): MeshAttachment {
  return {
    type: 'mesh',
    path,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [
      2, 0, 0, 0, 0.5, 1, -50, 0, 0.49995, 2, 0, 64, 0, 0.5, 1, 14, 0, 0.49995, 2, 0, 64, 64, 0.5,
      1, 14, 64, 0.49995, 2, 0, 0, 64, 0.5, 1, -50, 64, 0.49995,
    ],
    bones: [0, 1],
  };
}

function atlasRegion(name: string): AtlasRegion {
  return {
    name,
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    rotated: false,
    offsetX: 0,
    offsetY: 0,
    originalW: 64,
    originalH: 64,
  };
}

// A weighted quad bound to two GLOBAL bones (indices passed in), each vertex split 0.5 / 0.5. The bind
// coords are simple finite values (the validator checks arity/range/sum/finiteness, not geometry). The
// `bones` manifest is the ascending de-duplicated index set. Used by the `rigged` seed below.
function weightedQuad(path: string, boneA: number, boneB: number): MeshAttachment {
  // Weights 0.5 / 0.49995 sum to 0.99995: within WEIGHT_SUM_EPSILON (1e-4) of 1 so the document is valid,
  // but NOT exactly 1, so NormalizeMeshWeights produces a real delta on this seed (matching the `weighted`
  // seed convention) while every other weighted command re-normalizes regardless.
  const v = (vx: number, vy: number): number[] => [2, boneA, vx, vy, 0.5, boneB, vx, vy, 0.49995];
  return {
    type: 'mesh',
    path,
    uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    triangles: [0, 1, 2, 0, 2, 3],
    hullLength: 4,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
    vertices: [...v(0, 0), ...v(64, 0), ...v(64, 64), ...v(0, 64)],
    bones: [boneA, boneB].sort((a, b) => a - b),
  };
}

// A fully-rigged Phase-2 document at formatVersion 0.2.0: a two-bone IK chain (upper, lower) reaching a
// target, a transform constraint (follower follows driver in world rotation), a weighted mesh on the
// default skin, a NAMED variant skin, and an animation that keys a bone rotate, an IK mix ramp with a
// bendPositive flag, a transform mixRotate ramp, and a deform timeline on the default skin's mesh. This is
// the seed the WP-2.6/2.7/2.8/2.9 commands target: every constraint/skin/deform command is applicable here
// with a real delta, and the keyed commands (Set*Keyframe/Delete*Keyframe) have an existing track to edit.
// Bone GLOBAL indices: root 0, upper 1, lower 2, target 3, driver 4, follower 5.
function riggedDoc(): SkeletonDocument {
  const bones: Bone[] = [
    bone('root', null, { length: 50 }),
    bone('upper', 'root', { x: 50, length: 50 }),
    bone('lower', 'upper', { x: 50, length: 50 }),
    bone('target', 'root', { x: 120, y: 20, length: 20 }),
    bone('driver', 'root', { x: 0, y: 80, length: 20 }),
    bone('follower', 'root', { x: 0, y: -80, length: 20 }),
  ];
  const ikConstraints: IkConstraint[] = [
    {
      name: 'limb-ik',
      bones: ['upper', 'lower'],
      target: 'target',
      mix: 1,
      bend: 1,
      softness: 0,
      stretch: false,
      compress: false,
      uniform: false,
    },
  ];
  const transformConstraints: TransformConstraint[] = [
    {
      name: 'follow',
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
      local: false,
      relative: false,
    },
  ];
  const moveAnimation: Animation = {
    duration: 1,
    bones: {
      upper: {
        rotate: [
          { time: 0, value: { angle: 0 }, curve: 'linear' },
          { time: 1, value: { angle: 20 }, curve: 'linear' },
        ],
      },
    },
    slots: {
      // A stepped attachment-swap timeline on mesh_slot: show 'panel' at t=0, hide the slot at t=1. This
      // gives the WP attachment-keyframe commands (Set/DeleteAttachmentKeyframe) an existing track to edit
      // and lets DeleteSlot exercise the attachment-track prune cascade.
      mesh_slot: {
        attachment: [
          { time: 0, name: 'panel' },
          { time: 1, name: null },
        ],
        // A frame-sequence timeline (Stage F2) so the PP-D10 anim.sequence.* commands have keys to
        // set/move/delete (two keys give move a free midpoint and delete a target).
        sequence: [
          { time: 0, mode: 'loop', index: 0, delay: 0.1 },
          { time: 1, mode: 'hold', index: 2, delay: 0 },
        ],
      },
    },
    ik: {
      'limb-ik': [
        { time: 0, value: { mix: 0, bend: 1 }, curve: 'linear' },
        { time: 1, value: { mix: 1, bend: -1 }, curve: 'stepped' },
      ],
    },
    transform: {
      follow: [
        { time: 0, value: { mixRotate: 0 }, curve: 'linear' },
        { time: 1, value: { mixRotate: 1 }, curve: 'linear' },
      ],
    },
    deform: {
      default: {
        mesh_slot: {
          panel: [
            { time: 0, value: { offsets: [0, 0, 0, 0, 0, 0, 0, 0] }, curve: 'linear' },
            { time: 1, value: { offsets: [2, 0, 2, 0, 2, 0, 2, 0] }, curve: 'linear' },
          ],
        },
      },
    },
    // Stage F1 (ADR-0008, formatVersion 0.3.0) required timelines: this seed reorders no slots and fires
    // no events, so both are empty. Present because the doc is stamped at the CURRENT version (no migration
    // injects them, unlike the 0.1.0 doc() builder below).
    drawOrder: [],
    events: [],
    // Stage F3 (ADR-0011, formatVersion 0.5.0) required path timeline: keys no path constraint, so empty.
    path: {},
    // Stage F4 (ADR-0014, formatVersion 0.6.0) required physics timeline: keys no physics constraint, empty.
    physics: {},
  };
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'rigged',
    hash: '',
    bones,
    slots: [slot('mesh_slot', 'root', { attachment: 'panel' })],
    skins: [
      { name: 'default', attachments: { mesh_slot: { panel: weightedQuad('skin_panel', 1, 2) } } },
      {
        name: 'variant',
        // Stage F2 (ADR-0009 section 5) skin scoping: this named skin activates the 'follower' bone and the
        // 'follow' transform constraint only while it is the active skin. Gives the PP-D10 skin-scope
        // add/remove commands a pre-scoped target on a real seed.
        bones: ['follower'],
        constraints: ['follow'],
        attachments: { mesh_slot: { alt: region('skin_variant') } },
      },
    ],
    ikConstraints,
    transformConstraints,
    pathConstraints: [],
    physicsConstraints: [],
    events: [],
    animations: { move: moveAnimation },
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_panel'), atlasRegion('skin_variant')],
        },
      ],
    },
  };
}

// A Stage F1 (0.3.0) document exercising the PP-D9 event + draw-order authoring commands: two slots (so a
// draw-order key can reorder one over the other), two event definitions (one with an int payload and an
// audio hint, one with a float default), an animation carrying an existing draw-order key and two event
// keys (one overriding the float payload), and a metadata block. This is the representative seed for every
// event.* / draworder.* / document.setMetadata command: each is applicable here with a real delta, and the
// keyed edit/delete/move commands have an existing key to target.
function eventedDoc(): SkeletonDocument {
  const walk: Animation = {
    duration: 1,
    bones: {},
    slots: {},
    ik: {},
    transform: {},
    deform: {},
    // Move `back` forward one position at t=0.5 (target index 1); `front` implicitly fills index 0.
    drawOrder: [{ time: 0.5, offsets: [{ slot: 'back', offset: 1 }] }],
    // Fire `footstep` at t=0.25 and `landing` at t=0.75 (overriding its float default for this firing).
    events: [
      { time: 0.25, name: 'footstep' },
      { time: 0.75, name: 'landing', float: 2.5 },
    ],
    // Stage F3 (ADR-0011, formatVersion 0.5.0) required path timeline: keys no path constraint, so empty.
    path: {},
    // Stage F4 (ADR-0014, formatVersion 0.6.0) required physics timeline: keys no physics constraint, empty.
    physics: {},
  };
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'evented',
    hash: '',
    bones: [bone('root', null)],
    slots: [slot('back', 'root'), slot('front', 'root')],
    skins: [{ name: 'default', attachments: {} }],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [],
    physicsConstraints: [],
    events: [
      {
        name: 'footstep',
        int: 3,
        audio: { path: 'sfx/footstep.wav', volume: 0.8, balance: -0.25 },
      },
      { name: 'landing', float: 1.5 },
    ],
    animations: { walk },
    atlas: { pages: [] },
    metadata: { fps: 30, imagesPath: 'art/images' },
  };
}

interface DocBody {
  readonly slots?: Slot[];
  readonly skins?: SkeletonDocument['skins'];
  readonly atlas?: SkeletonDocument['atlas'];
  readonly animations?: Record<string, Animation>;
}

function doc(name: string, bones: Bone[], body: DocBody = {}): SkeletonDocument {
  return {
    formatVersion: '0.1.0',
    name,
    hash: '',
    bones,
    slots: body.slots ?? [],
    skins: body.skins ?? [{ name: 'default', attachments: {} }],
    animations: body.animations ?? {},
    atlas: body.atlas ?? { pages: [] },
  };
}

// A single idle animation exercising every authored channel across the seed's bone and slot: a bezier-
// eased rotate, a translate, and a slot color tint, in strict time order within [0, duration]. It makes
// every WP-1.5 animation/keyframe command applicable with a real delta and lets DeleteBone/DeleteSlot
// exercise the animation-track prune cascade.
const idleAnimation: Animation = {
  duration: 1,
  bones: {
    root: {
      rotate: [
        { time: 0, value: { angle: 0 }, curve: 'linear' },
        {
          time: 0.5,
          value: { angle: 30 },
          curve: { type: 'bezier', cx1: 0.25, cy1: 0.1, cx2: 0.75, cy2: 0.9 },
        },
        { time: 1, value: { angle: 0 }, curve: 'linear' },
      ],
      translate: [
        { time: 0, value: { x: 0, y: 0 }, curve: 'linear' },
        { time: 1, value: { x: 10, y: 0 }, curve: 'stepped' },
      ],
    },
  },
  slots: {
    body: {
      color: [
        { time: 0, value: { color: { r: 1, g: 1, b: 1, a: 1 } }, curve: 'linear' },
        { time: 1, value: { color: { r: 1, g: 0, b: 0, a: 1 } }, curve: 'linear' },
      ],
    },
  },
};

export const seeds = {
  // One root bone (normalized rotation), the common seed.
  minimal: doc('minimal', [bone('root', null)]),
  // A parent plus child, so DeleteBone exercises the subtree cascade.
  rig: doc('rig', [bone('root', null), bone('child', 'root', { x: 100 })]),
  // A bone with an out-of-range rotation, so NormalizeBoneRotation produces a real delta.
  rotated: doc('rotated', [bone('root', null, { rotation: 270 })]),
  // Two bones, two slots (one carrying a region attachment whose name differs from its atlas path),
  // and two atlas regions. This is the slot/attachment seed: it makes every WP-1.2 command applicable
  // with a real delta and lets DeleteBone exercise the slot + attachment cascade.
  slotted: doc('slotted', [bone('root', null), bone('arm', 'root', { x: 50 })], {
    slots: [slot('body', 'root', { attachment: 'body' }), slot('hand', 'arm')],
    skins: [{ name: 'default', attachments: { body: { body: region('skin_body') } } }],
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_body'), atlasRegion('skin_hand')],
        },
      ],
    },
  }),
  // One bone, one slot, and one idle animation with keyframes across channels (incl. a bezier). The
  // WP-1.5 animation/keyframe seed: every keyframe command is applicable here with a real delta.
  animated: doc('animated', [bone('root', null)], {
    slots: [slot('body', 'root')],
    animations: { idle: idleAnimation },
  }),
  // Two bones, a region attachment ('body') for GenerateMeshFromRegion to target, and an UNWEIGHTED mesh
  // attachment ('panel' on 'mesh_slot', its active setup attachment) for the WP-2.1 mesh-edit commands.
  // The atlas carries both referenced regions (every region/mesh path must resolve, ATTACHMENT_REGION_
  // MISSING). This makes every WP-2.1 command applicable here with a real delta.
  meshed: doc('meshed', [bone('root', null), bone('arm', 'root', { x: 50 })], {
    slots: [
      slot('body', 'root', { attachment: 'body' }),
      slot('mesh_slot', 'arm', { attachment: 'panel' }),
    ],
    skins: [
      {
        name: 'default',
        attachments: {
          body: { body: region('skin_body') },
          mesh_slot: { panel: mesh('skin_panel') },
        },
      },
    ],
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_body'), atlasRegion('skin_panel')],
        },
      ],
    },
  }),
  // Three bones (root, arm under root at x=50, tip under arm at x=50) and a WEIGHTED mesh ('panel' on
  // 'mesh_slot', riding root) bound to GLOBAL bones [root, arm]. 'tip' is in the document but unbound, so
  // AddBoneToMeshBinding has a bone to add; the two bound bones let RemoveBoneFromMeshBinding drop one and
  // keep the other. The WP-2.3/2.4 weighted-mesh commands all target this seed.
  weighted: doc(
    'weighted',
    [bone('root', null), bone('arm', 'root', { x: 50 }), bone('tip', 'arm', { x: 50 })],
    {
      slots: [slot('mesh_slot', 'root', { attachment: 'panel' })],
      skins: [
        { name: 'default', attachments: { mesh_slot: { panel: weightedMesh('skin_panel') } } },
      ],
      // Two regions (one unused) so the atlas shape (1 page, 2 regions) differs from the atlas.set
      // fixture's (1 page, 1 region), per the convention every seed's atlas is distinguishable from it.
      atlas: {
        pages: [
          {
            file: 'atlas.png',
            width: 128,
            height: 128,
            regions: [atlasRegion('skin_panel'), atlasRegion('skin_extra')],
          },
        ],
      },
    },
  ),
  // The fully-rigged Phase-2 seed (0.2.0): two-bone IK, a transform constraint, a weighted mesh, a named
  // variant skin, and an animation with ik/transform/deform timelines. Target of the WP-2.6/2.7/2.8/2.9
  // constraint, skin, and deform commands.
  rigged: riggedDoc(),
  // The Stage F1 (0.3.0) event + draw-order seed: two slots, two event definitions, an animation carrying a
  // draw-order key and two event keys, and a metadata block. Target of the PP-D9 event.* / draworder.* /
  // document.setMetadata commands.
  evented: eventedDoc(),
  // A Stage F2 (0.4.0) seed carrying a LINKED MESH ('panel_ref' on 'mesh_slot') whose parent is the real mesh
  // 'panel' on the same slot. Target of the PP-D10 linked-mesh commands: UnlinkMesh has a linked mesh to bake,
  // and CreateLinkedMesh has a mesh to reference (its 'panel_ref' name is free elsewhere).
  linked: doc('linked', [bone('root', null), bone('arm', 'root', { x: 50 })], {
    slots: [slot('mesh_slot', 'arm', { attachment: 'panel' })],
    skins: [
      {
        name: 'default',
        attachments: {
          mesh_slot: {
            panel: mesh('skin_panel'),
            panel_ref: {
              type: 'linkedmesh',
              path: 'skin_panel',
              parent: 'panel',
              timelines: true,
              width: 32,
              height: 32,
              color: { r: 1, g: 1, b: 1, a: 1 },
            },
          },
        },
      },
    ],
    // Two regions (one unused) so the atlas shape (1 page, 2 regions) differs from the atlas.set fixture's
    // (1 page, 1 region), per the convention every seed's atlas is distinguishable from it.
    atlas: {
      pages: [
        {
          file: 'atlas.png',
          width: 128,
          height: 128,
          regions: [atlasRegion('skin_panel'), atlasRegion('skin_extra')],
        },
      ],
    },
  }),
} as const;

// A Stage F3 (0.5.0) seed carrying an UNWEIGHTED PATH attachment ('rail' on 'path_slot'), a PATH CONSTRAINT
// ('rail-follow' distributing 'rider' along the rail), and an animation ('glide') that keys the path
// timeline. The rail is a straight two-curve open spline along the x axis with hand-computed cumulative arc
// lengths [90, 180] (each straight, evenly-spaced curve is 90 long). Target of BOTH the PP-D11 path
// attachment commands (MovePathControlPoint drags control points, AddPathCurve/RemovePathCurve grow and
// shrink the spline, SetPathClosed/SetPathConstantSpeed flip flags) AND the path constraint commands
// (CreatePathConstraint adds a second, SetPathConstraintParams edits, DeletePathConstraint cascades the
// carried path timeline). Built at the current version (0.5.0) so no migration injects the collections.
// A path renders no pixels, so it references no atlas region.
function pathedDoc(): SkeletonDocument {
  const glide: Animation = {
    duration: 1,
    // One authored bone track so anim.duplicate (which counts bone/slot/event/drawOrder keyframes, not the
    // carried path timeline) has real keyframes to copy on this seed.
    bones: {
      rider: {
        rotate: [
          { time: 0, value: { angle: 0 }, curve: 'linear' },
          { time: 1, value: { angle: 10 }, curve: 'linear' },
        ],
      },
    },
    slots: {},
    ik: {},
    transform: {},
    // The carried path timeline keying the base position and the rotate mix over time (partial frames),
    // so DeletePathConstraint exercises the carried-track prune cascade.
    path: {
      'rail-follow': [
        { time: 0, value: { position: 0, mixRotate: 1 }, curve: 'linear' },
        { time: 1, value: { position: 1, mixRotate: 0 }, curve: 'stepped' },
      ],
    },
    deform: {},
    drawOrder: [],
    events: [],
    // Stage F4 (ADR-0014, formatVersion 0.6.0) required physics timeline: keys no physics constraint, empty.
    physics: {},
  };
  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    name: 'pathed',
    hash: '',
    bones: [bone('root', null), bone('arm', 'root', { x: 50 }), bone('rider', 'root', { x: 20 })],
    slots: [slot('body', 'root'), slot('path_slot', 'arm', { attachment: 'rail' })],
    skins: [
      {
        name: 'default',
        attachments: {
          path_slot: {
            rail: {
              type: 'path',
              closed: false,
              constantSpeed: true,
              lengths: [90, 180],
              vertices: [0, 0, 30, 0, 60, 0, 90, 0, 120, 0, 150, 0, 180, 0],
            },
          },
        },
      },
    ],
    ikConstraints: [],
    transformConstraints: [],
    pathConstraints: [
      {
        name: 'rail-follow',
        target: 'path_slot',
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
    physicsConstraints: [],
    events: [],
    animations: { glide },
    atlas: { pages: [] },
  };
}

export const pathedSeed = pathedDoc();

export interface Seed {
  readonly id: string;
  readonly json: SkeletonDocument;
}

export const seedList: readonly Seed[] = [
  { id: 'minimal', json: seeds.minimal },
  { id: 'rig', json: seeds.rig },
  { id: 'rotated', json: seeds.rotated },
  { id: 'slotted', json: seeds.slotted },
  { id: 'animated', json: seeds.animated },
  { id: 'meshed', json: seeds.meshed },
  { id: 'weighted', json: seeds.weighted },
  { id: 'rigged', json: seeds.rigged },
  { id: 'evented', json: seeds.evented },
  { id: 'linked', json: seeds.linked },
  { id: 'pathed', json: pathedSeed },
];

// A deterministic test environment: a controllable fake clock (so coalescing-window tests are
// reproducible) and a fresh monotonic IdFactory per loaded Document. No performance.now anywhere.
export interface TestEnv {
  readonly env: DocumentEnvironment;
  setNow(ms: number): void;
  advance(ms: number): void;
}

export function makeTestEnv(start = 0): TestEnv {
  let now = start;
  return {
    env: { now: () => now, createIds: makeIdFactory },
    setNow: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
  };
}
