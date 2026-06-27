import { z } from 'zod';
import { rgbaSchema } from './color';

// The five attachment kinds (handoff section 6), modeled as a discriminated union on `type`. An
// unknown `type` is rejected structurally as SCHEMA_SHAPE (closed union), which is the LAW 1 guard
// against smuggling unmodeled data and the LAW 3 guard against silent field drift.
//
// Phase-0 scope (phase-0-foundations.md WP-0.3): the structural SHAPE of all five kinds exists so
// any well-formed attachment parses, but the deep mesh-encoding checks (weighted/unweighted vertex
// decode, weight-sum, influence cap, topology integrity) belong to the deferred mesh validator
// (format-contract WP-F.5). Here every numeric field is finite; the mesh arrays are shape-only.

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
  clippingAttachmentSchema,
  pointAttachmentSchema,
  boundingBoxAttachmentSchema,
]);

export type RegionAttachment = z.infer<typeof regionAttachmentSchema>;
export type MeshAttachment = z.infer<typeof meshAttachmentSchema>;
export type ClippingAttachment = z.infer<typeof clippingAttachmentSchema>;
export type PointAttachment = z.infer<typeof pointAttachmentSchema>;
export type BoundingBoxAttachment = z.infer<typeof boundingBoxAttachmentSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
