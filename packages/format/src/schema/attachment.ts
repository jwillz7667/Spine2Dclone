import { z } from 'zod';
import { rgbaSchema } from './color';

// The attachment kinds (handoff section 6), modeled as a discriminated union on `type`. An unknown
// `type` is rejected structurally as SCHEMA_SHAPE (closed union), which is the LAW 1 guard against
// smuggling unmodeled data and the LAW 3 guard against silent field drift.
//
// Phase-0 scope (phase-0-foundations.md WP-0.3): the structural SHAPE of the five original kinds exists
// so any well-formed attachment parses, but the deep mesh-encoding checks (weighted/unweighted vertex
// decode, weight-sum, influence cap, topology integrity) belong to the mesh validator (format-contract
// WP-F.5). Stage F2 (ADR-0009, formatVersion 0.4.0) ADDS a sixth kind, `linkedmesh` (a mesh that reuses
// a parent mesh's geometry), and an optional `sequence` frame-playback block on region and mesh
// attachments. Here every numeric field is finite; the mesh arrays are shape-only.

// A frame-sequence playback block (ADR-0009 section 3): the attachment `path` is a template and frame `i`
// is its region name with the zero-padded integer `start + i` appended to `digits` places. `count`,
// `start`, `digits` are non-negative integers (a violation is SCHEMA_SHAPE); `setupIndex` (the frame shown
// in setup pose) is in [0, count), a cross-field structural refinement reported as SEQUENCE_SETUP_RANGE.
export const sequenceSchema = z
  .object({
    count: z.number().int().finite().positive(),
    start: z.number().int().finite().nonnegative(),
    digits: z.number().int().finite().nonnegative(),
    setupIndex: z.number().int().finite().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.setupIndex >= value.count) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['setupIndex'],
        params: { code: 'SEQUENCE_SETUP_RANGE' },
        message: `sequence setupIndex ${value.setupIndex} must be in [0, ${value.count})`,
      });
    }
  });

export const regionAttachmentSchema = z
  .object({
    type: z.literal('region'),
    path: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite(),
    scaleX: z.number().finite(),
    scaleY: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    color: rgbaSchema,
    sequence: sequenceSchema.optional(),
  })
  .strict();

export const meshAttachmentSchema = z
  .object({
    type: z.literal('mesh'),
    path: z.string(),
    uvs: z.array(z.number().finite()),
    triangles: z.array(z.number().finite()),
    hullLength: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    color: rgbaSchema,
    edges: z.array(z.number().finite()).optional(),
    vertices: z.array(z.number().finite()),
    bones: z.array(z.number().finite()).optional(),
    sequence: sequenceSchema.optional(),
  })
  .strict();

// A linked mesh (ADR-0009 section 2): a mesh that reuses a PARENT mesh's geometry (uvs, triangles, hull,
// vertices, weights) while carrying its own atlas region, color, and (optionally) its own deform
// timelines. It has NO geometry of its own, so it is a distinct closed kind rather than a mesh with
// conditionally-absent geometry. `parent` names an attachment on the SAME slot in skin `skin ?? this
// skin`; the reference resolution, parent-kind, and cycle-freedom checks are semantic (validate/mesh.ts).
export const linkedMeshAttachmentSchema = z
  .object({
    type: z.literal('linkedmesh'),
    path: z.string(),
    parent: z.string(),
    skin: z.string().optional(),
    timelines: z.boolean(),
    width: z.number().finite(),
    height: z.number().finite(),
    color: rgbaSchema,
  })
  .strict();

export const clippingAttachmentSchema = z
  .object({
    type: z.literal('clipping'),
    end: z.string(),
    vertices: z.array(z.number().finite()),
    color: rgbaSchema,
  })
  .strict();

export const pointAttachmentSchema = z
  .object({
    type: z.literal('point'),
    x: z.number().finite(),
    y: z.number().finite(),
    rotation: z.number().finite(),
  })
  .strict();

export const boundingBoxAttachmentSchema = z
  .object({
    type: z.literal('boundingbox'),
    vertices: z.array(z.number().finite()),
  })
  .strict();

export const attachmentSchema = z.discriminatedUnion('type', [
  regionAttachmentSchema,
  meshAttachmentSchema,
  linkedMeshAttachmentSchema,
  clippingAttachmentSchema,
  pointAttachmentSchema,
  boundingBoxAttachmentSchema,
]);

export type Sequence = z.infer<typeof sequenceSchema>;
export type RegionAttachment = z.infer<typeof regionAttachmentSchema>;
export type MeshAttachment = z.infer<typeof meshAttachmentSchema>;
export type LinkedMeshAttachment = z.infer<typeof linkedMeshAttachmentSchema>;
export type ClippingAttachment = z.infer<typeof clippingAttachmentSchema>;
export type PointAttachment = z.infer<typeof pointAttachmentSchema>;
export type BoundingBoxAttachment = z.infer<typeof boundingBoxAttachmentSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
