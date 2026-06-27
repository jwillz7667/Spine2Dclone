import { z } from 'zod';

// An atlas region (handoff section 6). `name` is unique across all pages (semantic
// ATLAS_REGION_DUPLICATE) and is the target of region/mesh attachment `path`. `rotated` marks a
// region packed rotated 90 degrees; the offset/original fields describe trim.
export const atlasRegionSchema = z
  .object({
    name: z.string(),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
    rotated: z.boolean(),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
    originalW: z.number().finite(),
    originalH: z.number().finite(),
  })
  .strict();

export const atlasPageSchema = z
  .object({
    file: z.string(),
    width: z.number().finite(),
    height: z.number().finite(),
    regions: z.array(atlasRegionSchema),
  })
  .strict();

export const atlasRefSchema = z.object({ pages: z.array(atlasPageSchema) }).strict();

export type AtlasRegion = z.infer<typeof atlasRegionSchema>;
export type AtlasPage = z.infer<typeof atlasPageSchema>;
export type AtlasRef = z.infer<typeof atlasRefSchema>;
