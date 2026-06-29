import { z } from 'zod';

// EffectBundle (phase-3-vfx-particles.md section 8.1, 8.7): a named, PRESENTATION-ONLY grouping of
// effects (for example "megaWin"). Each item references an effect BY NAME on disk, with a relative
// `startOffset` (seconds), an `anchorRole` (a logical name the caller resolves to a concrete anchor),
// and a `seedSalt` mixed into the per-item seed via hash32(bundleSeed, seedSalt). It encodes NO win
// logic, NO grid, NO outcome (LAW 5). On disk the item is id-free; document-core mints a `BundleItemId`
// at import and stores `effect` as an `EffectId` internally (section 8.1.1).
export const bundleItemSchema = z
  .object({
    effect: z.string().min(1),
    startOffset: z.number().finite().nonnegative(),
    anchorRole: z.string().min(1),
    seedSalt: z.number().int(),
  })
  .strict();

export type BundleItem = z.infer<typeof bundleItemSchema>;

export const effectBundleSchema = z
  .object({
    name: z.string().min(1),
    items: z.array(bundleItemSchema),
  })
  .strict();

export type EffectBundle = z.infer<typeof effectBundleSchema>;
