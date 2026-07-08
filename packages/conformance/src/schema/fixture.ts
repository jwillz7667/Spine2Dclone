import { z } from 'zod';

// The committed expected-output fixture schema (conformance-and-ci.md A.3, WP-V.2). A fixture is the
// canonical serialized result of running runtime-core over a rig at the sample-spec times; it is the
// contract every runtime must reproduce within the A.5 tolerance. Validate on import / fail loudly
// (Law 3): a fixture that does not match this schema is rejected with a typed FixtureValidationError.
//
// Phase 1 scope (rig-2bone, phase-1-bone-puppet.md WP-1.12): a sample stores ONLY the canonical raw
// world affine per bone in document order. Decomposed local rotation and a separately computed tip
// position are NOT stored, because atan2/acos differ across language math libs and decomposition would
// re-introduce that noise on read (A.3). The vertices / slots / drawOrder / events members of the full
// A.3 shape arrive with the Phase 2 rigs (weighted mesh, blend modes, draw order, events) and extend
// this schema as optional members; the schema is `.strict()` so an unexpected member fails loudly
// until it is added. PP-B1 adds the optional per-slot capture (blendMode + resolved color) that
// rig-blendmodes needs to make solve-order step 6 (per-slot blend mode and color) observable.

// A 2x3 affine [a, b, c, d, tx, ty] (runtime-core math/affine.ts layout): columns [a c tx; b d ty].
const affineSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

// One mesh attachment's FINAL world-space vertices at a sample time (Phase 2, A.3): skin (LBS) then
// deform (post-skin, additive), the result runtime-core's sampleMeshVertices produces. `positions` is the
// flat [x0, y0, x1, y1, ...] world-space stream (length 2 * vertexCount). Keyed by the (skin, slot,
// attachment) triple it was sampled for; emitted in sorted triple order for stable diffs. Locks the
// skinning (FIX-2.RM rigid fast path, FIX-2.W weighted) and deform (FIX-2.DF skin-then-deform) solve.
const meshVerticesSchema = z
  .object({
    skin: z.string().min(1),
    slot: z.string().min(1),
    attachment: z.string().min(1),
    positions: z.array(z.number().finite()),
  })
  .strict();

// Per-slot blend mode (handoff section 6 step 6): the four modes the renderer maps to GPU blend
// functions. Defined here (not imported from format) so the fixture schema is the self-contained
// cross-runtime contract a native runtime validates against (A.8); the values mirror the format's
// BlendMode enum. A discrete quantity: compared with EXACT equality, no epsilon (A.5).
const fixtureBlendModeSchema = z.enum(['normal', 'additive', 'multiply', 'screen']);

// One slot's resolved presentation state at a sample time (solve-order step 6): its static `blendMode`
// (a document property, compared EXACT) and the `color` the animation resolved to (pose.slotColor,
// [r, g, b, a] in 0..1, compared within the COLOR tolerance). Present only on rigs whose sample-spec
// names slots to capture (rig-blendmodes); omitted otherwise, so pre-PP-B1 fixtures stay byte-identical.
// Keyed by slot name; emitted in the sample-spec's requested order so the diff reads one slot per line.
const slotStateSchema = z
  .object({
    slot: z.string().min(1),
    blendMode: fixtureBlendModeSchema,
    color: z.tuple([
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
      z.number().finite(),
    ]),
  })
  .strict();

const fixtureSampleSchema = z
  .object({
    time: z.number().finite(),
    animation: z.string().min(1),
    loop: z.boolean(),
    // Bone world affines keyed by bone name, emitted in document order (parents precede children).
    bones: z.record(z.string(), affineSchema),
    // Skinned + deformed mesh vertices, present only on rigs whose sample-spec names meshes to sample
    // (FIX-2.RM / FIX-2.W / FIX-2.DF). Omitted on bone-only rigs, so pre-Phase-2 fixtures stay valid.
    meshes: z.array(meshVerticesSchema).optional(),
    // Per-slot blend mode + resolved color, present only on rigs whose sample-spec names slots to
    // capture (rig-blendmodes). Omitted otherwise, so bone-only and mesh-only fixtures stay valid.
    slots: z.array(slotStateSchema).optional(),
  })
  .strict();

export const fixtureSchema = z
  .object({
    rigId: z.string().min(1),
    rigHash: z.string().min(1), // sha256:<hex> of the rig file the fixture was generated from (A.3)
    specHash: z.string().min(1), // sha256:<hex> of the sample-spec used
    coreVersion: z.string().min(1), // provenance, not used in comparison
    toolchain: z.string().min(1), // pinned generation toolchain id (A.7), e.g. node-22.13.1-v8
    generatedBy: z.string().min(1),
    samples: z.array(fixtureSampleSchema).min(1),
  })
  .strict();

export type Affine = z.infer<typeof affineSchema>;
export type MeshVertices = z.infer<typeof meshVerticesSchema>;
export type FixtureBlendMode = z.infer<typeof fixtureBlendModeSchema>;
export type SlotState = z.infer<typeof slotStateSchema>;
export type FixtureSample = z.infer<typeof fixtureSampleSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;

// Typed boundary error (Law 3): carries the Zod issues so a caller can see exactly which member of a
// malformed fixture failed, never a bare throw.
export class FixtureValidationError extends Error {
  override readonly name = 'FixtureValidationError';
  readonly issues: readonly z.ZodIssue[];

  constructor(error: z.ZodError) {
    super(`fixture failed schema validation with ${error.issues.length} issue(s)`);
    this.issues = error.issues;
  }
}

// Parse and validate an unknown value as a Fixture, throwing FixtureValidationError on any violation.
export function validateFixture(input: unknown): Fixture {
  const result = fixtureSchema.safeParse(input);
  if (!result.success) throw new FixtureValidationError(result.error);
  return result.data;
}
