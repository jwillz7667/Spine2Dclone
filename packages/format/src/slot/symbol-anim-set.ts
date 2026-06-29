import { z } from 'zod';

// SymbolAnimSet (format-contract section 15.3, phase-4 WP-4.6). Each authored SymbolId maps to one
// SymbolAnimSet that names a referenced skeleton and the animation names to play for each phase. WP-4.4
// lands this minimal valid form; WP-4.6 owns and grows it (it adds the MapSymbolAnimSet command and the
// refs.skeletons bookkeeping, not new schema fields). The cross-reference checks (skeletonRef resolves
// to a refs.skeletons name, the animation names exist in that skeleton) live in the validator's
// semantic layer, which reads the referenced docs via the injected resolver.
//
// `win` is reused for anticipation when `anticipation` is absent (format-contract section 15.3).
export const symbolAnimSetSchema = z
  .object({
    // Name of a SkeletonDocument in refs.skeletons.
    skeletonRef: z.string().min(1),
    // Animation names in that skeleton.
    idle: z.string().min(1),
    land: z.string().min(1),
    win: z.string().min(1),
    // Optional anticipation animation; `win` is reused when this is absent.
    anticipation: z.string().min(1).optional(),
  })
  .strict();

export type SymbolAnimSet = z.infer<typeof symbolAnimSetSchema>;
