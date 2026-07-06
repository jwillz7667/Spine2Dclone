import { makeSpritePng } from '@marionette/atlas-pack/testing';
import { describe, expect, it } from 'vitest';
import { McpToolError, SessionRegistry, TOOLS, type FileStore, type ToolDeps } from '../src';

// BALL BOUNCE: the fine-mesh-detail physics proof. An AI speaking ONLY the MCP tool surface authors a
// bouncing ball with realistic dynamics (constant-gravity parabola, restitution-consistent rebound,
// volume-preserving squash-and-stretch, a deform-flattened contact patch), then VERIFIES the physics
// numerically through the same surface (document.getWorldTransforms at time t + mesh.sample). No
// document-core import, no runtime-core import: if this test passes, an external MCP client has full
// closed-loop control over detailed mesh animation.
//
// The rig separates channels so each gets its own easing (a vec2 keyframe shares one curve across x/y):
//   root -> carriage (linear horizontal velocity) -> ball (eased vertical drop + squash scale).
// The ball bone origin IS the contact point (the disc mesh sits on top of it), so scale squashes about
// the ground plane and the contact stays planted, exactly how a rigger builds a squash bone.

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

// An in-memory FileStore holding just the one atlas page PNG render_frame reads back.
function makeDeps(): ToolDeps {
  const binary = new Map<string, Uint8Array>();
  binary.set(
    'atlas0.png',
    makeSpritePng({ width: 8, height: 8, contentX: 0, contentY: 0, contentW: 8, contentH: 8 }),
  );
  const files: FileStore = {
    read: async (path) => {
      throw new Error(`no text file ${path}`);
    },
    write: async () => undefined,
    readBinary: async (path) => {
      const data = binary.get(path);
      if (data === undefined) throw new Error(`no binary file ${path}`);
      return data;
    },
    writeBinary: async (path, data) => {
      binary.set(path, data);
    },
    listDir: async () => [],
  };
  return { sessions: new SessionRegistry(), files };
}

// The 8x8 single-region atlas both tests attach their artwork path to (the format validator requires
// every region/mesh attachment path to resolve to a live atlas region).
function oneRegionAtlas(region: string): unknown {
  return {
    pages: [
      {
        file: 'atlas0.png',
        width: 8,
        height: 8,
        regions: [
          {
            name: region,
            x: 0,
            y: 0,
            w: 8,
            h: 8,
            rotated: false,
            offsetX: 0,
            offsetY: 0,
            originalW: 8,
            originalH: 8,
          },
        ],
      },
    ],
  };
}

async function call(
  deps: ToolDeps,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = byName.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  return (await tool.handler(deps, input)) as Record<string, unknown>;
}

// ---- physics constants of the authored shot ------------------------------------------------------
// Fall: y(t) = APEX1 - (G/2) t^2 hits the ground at T_IMPACT, so G = 2*APEX1 / T_IMPACT^2 = 2080 u/s^2.
// The dwell (contact) holds y = 0 while the squash plays; the rebound leaves at T_LIFT with apex
// APEX2 at T_APEX2, and T_APEX2 - T_LIFT = sqrt(2*APEX2/G) keeps the SAME gravity, which makes the
// measured restitution sqrt(APEX2/APEX1). The second descent reuses G through DROP2 over the tail.
const APEX1 = 260;
const T_IMPACT = 0.5;
const G = (2 * APEX1) / (T_IMPACT * T_IMPACT); // 2080
const T_LIFT = 0.6;
const APEX2 = 150;
const RISE = 0.38; // ~sqrt(2*APEX2/G), keeping gravity consistent on the way up
const T_APEX2 = T_LIFT + RISE; // 0.98
const DURATION = 1.2;
const TAIL = DURATION - T_APEX2; // 0.22
const G2 = (2 * APEX2) / (RISE * RISE); // rebound gravity, within 0.2% of G by the RISE choice
const DROP2 = (G2 / 2) * TAIL * TAIL; // how far the second fall gets by the end of the clip

// Exact-quadratic easings: with cx1=1/3, cx2=2/3 the bezier x(s) == s, and cy1=0, cy2=1/3 gives
// y(s) = s^2 (accelerating, gravity), while cy1=2/3, cy2=1 gives y(s) = 2s - s^2 (decelerating rise).
// The solve samples the cubic into a 10-segment table, so the played parabola is that curve chorded
// at 0.1 steps; the tolerance below is the exact chord-error bound (dx^2/8 * f'' = 0.0025) times APEX1.
const QUAD_IN = { type: 'bezier', cx1: 1 / 3, cy1: 0, cx2: 2 / 3, cy2: 1 / 3 } as const;
const QUAD_OUT = { type: 'bezier', cx1: 1 / 3, cy1: 2 / 3, cx2: 2 / 3, cy2: 1 } as const;

// ---- the disc mesh: 12 hull vertices + center, bottom vertex exactly at the bone origin -----------
const R = 50;
const HULL = 12;
function discGeometry(): { vertices: number[]; uvs: number[]; triangles: number[] } {
  const vertices: number[] = [];
  const uvs: number[] = [];
  for (let k = 0; k < HULL; k += 1) {
    const theta = (k / HULL) * 2 * Math.PI;
    const x = R * Math.sin(theta);
    const y = R - R * Math.cos(theta); // k=0 -> (0,0): the contact vertex sits on the bone origin
    vertices.push(x, y);
    uvs.push((x + R) / (2 * R), y / (2 * R));
  }
  vertices.push(0, R); // center vertex, index 12
  uvs.push(0.5, 0.5);
  const triangles: number[] = [];
  for (let k = 0; k < HULL; k += 1) triangles.push(k, (k + 1) % HULL, HULL);
  return { vertices, uvs, triangles };
}

// Shoelace area over the sampled triangle list (consistent fan orientation, so |sum| is the area).
function meshArea(vertices: number[], triangles: number[]): number {
  let sum = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i]! * 2;
    const b = triangles[i + 1]! * 2;
    const c = triangles[i + 2]! * 2;
    sum +=
      (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!) -
      (vertices[c]! - vertices[a]!) * (vertices[b + 1]! - vertices[a + 1]!);
  }
  return Math.abs(sum / 2);
}

function extents(vertices: number[]): { width: number; height: number; minY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    minX = Math.min(minX, vertices[i]!);
    maxX = Math.max(maxX, vertices[i]!);
    minY = Math.min(minY, vertices[i + 1]!);
    maxY = Math.max(maxY, vertices[i + 1]!);
  }
  return { width: maxX - minX, height: maxY - minY, minY };
}

describe('ball bounce: MCP-authored squash/stretch with verifiable physics (DoD)', () => {
  it('authors the shot over MCP tools only and the numeric read-back confirms the dynamics', async () => {
    const deps = makeDeps();
    const { documentId } = await call(deps, 'document.new', { name: 'ball-bounce' });
    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas('ball-tex') });

    // ---- rig -------------------------------------------------------------------------------------
    const { boneId: root } = await call(deps, 'bone.create', {
      documentId,
      name: 'root',
      length: 10,
    });
    const { boneId: carriage } = await call(deps, 'bone.create', {
      documentId,
      parentId: root,
      name: 'carriage',
      length: 10,
    });
    const { boneId: ball } = await call(deps, 'bone.create', {
      documentId,
      parentId: carriage,
      name: 'ball',
      y: APEX1,
      length: 10,
    });
    const { slotId } = await call(deps, 'slot.create', {
      documentId,
      boneId: ball,
      name: 'ball',
    });
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'ball',
      path: 'ball-tex',
      width: 2 * R,
      height: 2 * R,
    });
    const disc = discGeometry();
    await call(deps, 'mesh.generateFromRegion', {
      documentId,
      slotId,
      name: 'ball',
      uvs: disc.uvs,
      triangles: disc.triangles,
      hullLength: HULL,
      width: 2 * R,
      height: 2 * R,
      vertices: disc.vertices,
    });
    await call(deps, 'slot.activeAttachment', { documentId, slotId, attachment: 'ball' });

    // ---- animation -------------------------------------------------------------------------------
    const { animationId } = await call(deps, 'anim.create', {
      documentId,
      name: 'bounce',
      duration: DURATION,
    });
    const kf = (
      channel: string,
      boneId: unknown,
      time: number,
      value: Record<string, number>,
      curve?: unknown,
    ): Promise<Record<string, unknown>> =>
      call(deps, 'kf.set', {
        documentId,
        animationId,
        channel,
        boneId,
        time,
        value,
        ...(curve === undefined ? {} : { curve }),
      });

    // Horizontal: constant velocity on the carriage (its own track, so the eased vertical curve
    // never bends it).
    await kf('translate', carriage, 0, { x: -120, y: 0 });
    await kf('translate', carriage, DURATION, { x: 120, y: 0 });

    // Vertical on the ball bone: parabola down, dwell, restitution-consistent parabola up, tail drop.
    // Translate keys are offsets from the setup pose (the solve samples setup + key), so with the
    // bone's setup y at APEX1 the apex keys 0 and the ground keys -APEX1.
    await kf('translate', ball, 0, { x: 0, y: 0 }, QUAD_IN);
    await kf('translate', ball, T_IMPACT, { x: 0, y: -APEX1 }, 'linear'); // ground contact
    await kf('translate', ball, T_LIFT, { x: 0, y: -APEX1 }, QUAD_OUT); // dwell (contact)
    await kf('translate', ball, T_APEX2, { x: 0, y: -APEX1 + APEX2 }, QUAD_IN); // rebound apex
    await kf('translate', ball, DURATION, { x: 0, y: -APEX1 + APEX2 - DROP2 }, 'linear'); // tail

    // Squash and stretch about the contact point: stretched along motion in flight, maximum squash
    // mid-dwell. The scale product at max squash is 1.32 * 0.72 = 0.95: deliberately 5% UNDER unity,
    // because the flattened contact patch keyed below bulges that displaced volume back out sideways;
    // scale and deform together preserve the ball's area (asserted at the bottom of this test).
    await kf('scale', ball, 0, { x: 1, y: 1 }, 'linear');
    await kf('scale', ball, 0.4, { x: 0.94, y: 1.1 }, 'linear');
    await kf('scale', ball, T_IMPACT, { x: 0.98, y: 1.04 }, 'linear');
    await kf('scale', ball, 0.55, { x: 1.32, y: 0.72 }, 'linear');
    await kf('scale', ball, T_LIFT, { x: 0.95, y: 1.08 }, QUAD_OUT);
    await kf('scale', ball, 0.85, { x: 1, y: 1 }, 'linear');

    // ---- the closed loop: read the solved squash pose back, then author the contact patch --------
    // A rigid scale keeps the disc round; the WEIGHT of the ball shows in the flat contact patch,
    // which is per-vertex deform detail. Sample the solved (skinned, scaled) vertices at max squash,
    // compute world-space offsets that press the three lowest vertices onto the ground plane and
    // spread them outward, and key those offsets. This is exactly the read-modify-write loop the
    // mesh.sample tool exists for.
    const squashPose = await call(deps, 'mesh.sample', {
      documentId,
      slotId,
      name: 'ball',
      animationId,
      time: 0.55,
    });
    const skinned = squashPose.vertices as number[];
    const centerX = skinned[HULL * 2]!; // vertex 12, the disc center, carries the bone's world x
    const zeros = new Array<number>((HULL + 1) * 2).fill(0);
    const flatten = zeros.slice();
    for (const v of [0, 1, HULL - 1]) {
      flatten[v * 2] = (skinned[v * 2]! - centerX) * 0.15; // spread the patch outward
      flatten[v * 2 + 1] = -skinned[v * 2 + 1]!; // press onto the ground plane exactly
    }
    const deformKf = (time: number, offsets: number[]): Promise<Record<string, unknown>> =>
      call(deps, 'deform.setKeyframe', {
        documentId,
        animationId,
        skin: 'default',
        slotId,
        name: 'ball',
        time,
        offsets,
      });
    await deformKf(T_IMPACT, zeros);
    await deformKf(0.55, flatten);
    await deformKf(T_LIFT, zeros);

    // Re-ease the impact->squash deform segment in place with the new deform.setCurve, addressing the
    // key by id from anim.get (which now returns the deform timeline).
    const animView = (await call(deps, 'anim.get', { documentId, animationId })).animation as {
      deform: Array<{
        attachment: string;
        keyframes: Array<{ id: string; time: number; curve: unknown; offsets: number[] }>;
      }>;
    };
    const deformTrack = animView.deform.find((t) => t.attachment === 'ball');
    expect(deformTrack).toBeDefined();
    expect(deformTrack!.keyframes.map((k) => k.time)).toEqual([T_IMPACT, 0.55, T_LIFT]);
    const impactKey = deformTrack!.keyframes[0]!;
    await call(deps, 'deform.setCurve', {
      documentId,
      animationId,
      skin: 'default',
      slotId,
      name: 'ball',
      keyframeId: impactKey.id,
      curve: QUAD_OUT,
    });
    const reread = (await call(deps, 'anim.get', { documentId, animationId })).animation as {
      deform: Array<{ keyframes: Array<{ id: string; time: number; curve: unknown }> }>;
    };
    const rereadKey = reread.deform[0]!.keyframes[0]!;
    expect(rereadKey.id).toBe(impactKey.id); // same key, re-eased in place
    expect(rereadKey.curve).toEqual(QUAD_OUT);
    expect(impactKey.curve).toBe('linear'); // and it really was linear before the setCurve

    // The document this produced is valid by the format contract.
    expect((await call(deps, 'document.validate', { documentId })).ok).toBe(true);

    // ---- verification 1: gravity. The fall must match y = APEX1 - (G/2) t^2 within the pinned
    // 10-segment bezier chord error (0.0025 * APEX1 = 0.65), for which 0.75 is the honest bound.
    const ballY = async (time: number): Promise<number> => {
      const res = await call(deps, 'document.getWorldTransforms', {
        documentId,
        animationId,
        time,
      });
      const row = (res.transforms as Array<{ name: string; world: number[] }>).find(
        (t) => t.name === 'ball',
      );
      if (!row) throw new Error('no ball bone in transforms');
      return row.world[5]!;
    };
    for (let i = 0; i <= 20; i += 1) {
      const t = (i / 20) * T_IMPACT;
      const expected = APEX1 - (G / 2) * t * t;
      expect(Math.abs((await ballY(t)) - expected)).toBeLessThanOrEqual(0.75);
    }

    // Constant horizontal velocity: the carriage x is exactly linear.
    const carriageX = async (time: number): Promise<number> => {
      const res = await call(deps, 'document.getWorldTransforms', {
        documentId,
        animationId,
        time,
      });
      const row = (res.transforms as Array<{ name: string; world: number[] }>).find(
        (t) => t.name === 'carriage',
      );
      return row!.world[4]!;
    };
    const x0 = await carriageX(0.1);
    const x1 = await carriageX(0.2);
    const x2 = await carriageX(0.3);
    expect(Math.abs(x2 - x1 - (x1 - x0))).toBeLessThanOrEqual(1e-9);

    // ---- verification 2: contact dwell and restitution. y == 0 through the dwell; the measured
    // liftoff/impact speed ratio equals sqrt(APEX2/APEX1) (the bezier chord factors cancel in the
    // ratio because both speeds are measured one facet from the ground).
    for (const t of [T_IMPACT, 0.52, 0.55, 0.58, T_LIFT]) {
      expect(Math.abs(await ballY(t))).toBeLessThanOrEqual(1e-9);
    }
    const vImpact = ((await ballY(0.46)) - (await ballY(0.49))) / 0.03;
    const vLift = ((await ballY(0.63)) - (await ballY(0.61))) / 0.02;
    const restitution = vLift / vImpact;
    expect(Math.abs(restitution - Math.sqrt(APEX2 / APEX1))).toBeLessThanOrEqual(0.02);

    // The rebound apex is where it should be under the same gravity.
    expect(Math.abs((await ballY(T_APEX2)) - APEX2)).toBeLessThanOrEqual(0.75);

    // ---- verification 3: squash, weight, and the contact patch, via solved mesh vertices ---------
    const sampleMesh = async (time: number): Promise<{ vertices: number[]; triangles: number[] }> => {
      const res = await call(deps, 'mesh.sample', {
        documentId,
        slotId,
        name: 'ball',
        animationId,
        time,
      });
      return { vertices: res.vertices as number[], triangles: res.triangles as number[] };
    };

    const rest = await sampleMesh(0); // scale (1,1), before the first deform key: the pure disc
    const squash = await sampleMesh(0.55); // max squash + flattened patch
    const restExt = extents(rest.vertices);
    const squashExt = extents(squash.vertices);

    // Squashed wide and low, about the planted contact point.
    expect(squashExt.width / squashExt.height).toBeGreaterThan(1.6);
    expect(squashExt.width).toBeGreaterThan(1.25 * restExt.width);
    expect(squashExt.height).toBeLessThan(0.82 * restExt.height);

    // The ball has volume, not just outline: area preserved within 5% at maximum squash.
    const areaRatio = meshArea(squash.vertices, squash.triangles) / meshArea(rest.vertices, rest.triangles);
    expect(Math.abs(areaRatio - 1)).toBeLessThanOrEqual(0.05);

    // The contact patch is FLAT (three vertices pressed to the ground plane exactly): per-vertex
    // deform detail a rigid scale cannot produce; a round disc touches at a single point.
    const patchYs = [0, 1, HULL - 1].map((v) => squash.vertices[v * 2 + 1]!);
    for (const y of patchYs) expect(Math.abs(y)).toBeLessThanOrEqual(1e-3);
    const patchXs = [1, HULL - 1].map((v) => squash.vertices[v * 2]!);
    const skinnedXs = [1, HULL - 1].map((v) => skinned[v * 2]!);
    expect(Math.abs(patchXs[0]! - patchXs[1]!)).toBeGreaterThan(
      Math.abs(skinnedXs[0]! - skinnedXs[1]!) * 1.1,
    ); // and spread outward under the pressure

    // No ground penetration anywhere in the dwell.
    for (const t of [T_IMPACT, 0.52, 0.55, 0.58, T_LIFT]) {
      expect((await sampleMesh(t)).vertices.filter((_, i) => i % 2 === 1).every((y) => y >= -1e-3)).toBe(
        true,
      );
    }

    // Just after liftoff the mesh is stretched tall again (deform back at zero, scale 0.95/1.08-ish).
    const flight = await sampleMesh(0.65);
    const flightExt = extents(flight.vertices);
    expect(flightExt.height).toBeGreaterThan(1.05 * flightExt.width);

    // ---- verification 4: determinism (LAW 1 discipline: same document, same time, same numbers) --
    const again = await sampleMesh(0.55);
    expect(again.vertices).toEqual(squash.vertices);

    // ---- verification 5: the visual twin renders the same document headlessly -------------------
    const frame = await call(deps, 'render_frame', {
      documentId,
      animation: 'bounce',
      time: 0.55,
      width: 128,
      height: 128,
    });
    expect(frame.placeholders).toBe(false); // real atlas pixels, not placeholders
    expect(frame.bytes as number).toBeGreaterThan(0);
  });

  it('rejects mesh.moveVertex on a weighted mesh loudly (MESH_TOPOLOGY_LOCKED, no silent corruption)', async () => {
    const deps = makeDeps();
    const { documentId } = await call(deps, 'document.new', { name: 'weighted-guard' });
    await call(deps, 'atlas.set', { documentId, atlas: oneRegionAtlas('tex') });
    const { boneId: root } = await call(deps, 'bone.create', {
      documentId,
      name: 'root',
      length: 10,
    });
    const { boneId: arm } = await call(deps, 'bone.create', {
      documentId,
      parentId: root,
      name: 'arm',
      x: 32,
      length: 10,
    });
    const { slotId } = await call(deps, 'slot.create', { documentId, boneId: root, name: 'panel' });
    await call(deps, 'attach.region.add', {
      documentId,
      slotId,
      name: 'panel',
      path: 'tex',
      width: 64,
      height: 64,
    });
    await call(deps, 'mesh.generateFromRegion', {
      documentId,
      slotId,
      name: 'panel',
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hullLength: 4,
      width: 64,
      height: 64,
      vertices: [0, 0, 64, 0, 64, 64, 0, 64],
    });

    // Unweighted: move works.
    await call(deps, 'mesh.moveVertex', { documentId, slotId, name: 'panel', vertexIndex: 0, x: 1, y: 2 });

    // Weighted: the flat vertices become the bone-influence stream, so move must fail loudly.
    await call(deps, 'mesh.bindToBones', {
      documentId,
      slotId,
      name: 'panel',
      boneIds: [root, arm],
      weightMode: 'equalSplit',
    });
    await expect(
      call(deps, 'mesh.moveVertex', { documentId, slotId, name: 'panel', vertexIndex: 0, x: 9, y: 9 }),
    ).rejects.toMatchObject({ code: 'MESH_TOPOLOGY_LOCKED' });
    await expect(
      call(deps, 'mesh.moveVertex', { documentId, slotId, name: 'panel', vertexIndex: 0, x: 9, y: 9 }),
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
