import { z } from 'zod';

// The optional skeleton metadata block (format-contract section 4.2, ADR-0008 section 4). Authoring
// hints that do NOT affect the solve: `fps` is the authoring frame rate (positive, for example 30);
// `imagesPath` and `audioPath` are project-relative source-asset directories the editor uses to
// relocate assets. Every field is optional and the block is closed (.strict()). The block itself is
// optional on the document, so a rig without authoring hints simply omits it and the migration does
// not have to invent values.
export const skeletonMetaSchema = z
  .object({
    fps: z.number().finite().positive().optional(),
    imagesPath: z.string().optional(),
    audioPath: z.string().optional(),
  })
  .strict();

export type SkeletonMeta = z.infer<typeof skeletonMetaSchema>;
