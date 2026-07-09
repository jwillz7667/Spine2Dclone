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
    // The resolved two-color DARK tint RGBA (PP-B5 slice 6, ADR-0011 section 3), present only for a slot
    // that declared a setup `darkColor` (two-color tinting enabled). Compared on the COLOR tolerance like
    // the primary color. Omitted otherwise, so pre-slice-6 slot captures stay byte-identical.
    dark: z
      .tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
      .optional(),
  })
  .strict();

// One fired event's RESOLVED record (ADR-0008, PP-B4): the event name, the time (the key's authored time
// at which it fired), and its resolved payload (EventDef default overridden by the key). `int` and
// `string` are DISCRETE (compared EXACT); `float` rides the EVENT_FLOAT tolerance (an authored value, low
// noise). A payload member is present only when the resolved event carries it. The fired-event LOG is
// ordered; entries are compared index by index, so a wrong count, order, name, time, or payload is a bug.
const firedEventSchema = z
  .object({
    name: z.string().min(1),
    time: z.number().finite(),
    int: z.number().int().finite().optional(),
    float: z.number().finite().optional(),
    string: z.string().optional(),
  })
  .strict();

// One slot's resolved sequence FRAME INDEX at a sample (PP-B5 slice 5, ADR-0011 section 2): the slot name
// and the integer frame the sequence attachment shows. A discrete playback state, compared EXACT.
const sequenceStateSchema = z
  .object({
    slot: z.string().min(1),
    frame: z.number().int().finite(),
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
    // The resolved RENDER ORDER at this sample (ADR-0008, PP-B4): an INTEGER permutation where
    // drawOrder[renderPosition] = slotIndex (setup slot order), captured only when the sample-spec sets
    // captureDrawOrder (rig-events-draworder). Compared EXACT (a reorder is discrete, never float noise).
    // Omitted otherwise, so pre-PP-B4 fixtures stay byte-identical.
    drawOrder: z.array(z.number().int().finite()).optional(),
    // Per-slot resolved sequence FRAME INDEX (PP-B5 slice 5, ADR-0011 section 2), captured only when the
    // sample-spec names slots in captureSequences (rig-sequences). Each entry is a slot name plus its
    // integer frame, compared EXACT (a discrete playback state, no float noise). Omitted otherwise, so
    // pre-slice-5 fixtures stay byte-identical.
    sequences: z.array(sequenceStateSchema).optional(),
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
    // The ordered fired-event LOG produced by sweeping the sample-spec's eventStep (ADR-0008, PP-B4).
    // Present only on rigs whose sample-spec sets eventStep (rig-events-draworder, rig-events-loop);
    // omitted otherwise, so pre-PP-B4 fixtures stay byte-identical. It is fixture-level (a range sweep),
    // not per-sample (an instantaneous pose), which is the correct sampling axis for a fired event.
    events: z.array(firedEventSchema).optional(),
  })
  .strict();

export type Affine = z.infer<typeof affineSchema>;
export type MeshVertices = z.infer<typeof meshVerticesSchema>;
export type FixtureBlendMode = z.infer<typeof fixtureBlendModeSchema>;
export type SlotState = z.infer<typeof slotStateSchema>;
export type FiredEventRecord = z.infer<typeof firedEventSchema>;
export type SequenceState = z.infer<typeof sequenceStateSchema>;
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
