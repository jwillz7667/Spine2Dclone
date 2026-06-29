import { z } from 'zod';
import { blendModeSchema } from '../../common';
import { effectLayerSchema } from './layers';

// EffectConfig (phase-3-vfx-particles.md section 8.1): one reusable effect in the library. It is
// name-keyed in the document map AND carries its own `name` (the name the sequencer references); the
// two are kept consistent by the EFFECT_NAME_KEY_MISMATCH semantic check. `duration` is seconds of
// emission or null (endless, stopped explicitly). `deterministic` selects the seeded solve + authored
// counts (true) vs the ambient, tier-scalable path (false). `simulationDt` is the fixed sim step in
// seconds (default 1/60); `simulationDt > 0` is a semantic check. `layers` draw in array order.
//
// The effect is id-free on disk (section 8.1.1): internal `EffectId`/`EffectLayerId` are minted at
// import by document-core and never serialized here. `blendMode` is the effect-level default; each
// layer also carries its own `blendMode` (section 7.4).
export const effectConfigSchema = z
  .object({
    name: z.string().min(1),
    duration: z.number().finite().positive().nullable(),
    deterministic: z.boolean(),
    simulationDt: z.number().finite(),
    blendMode: blendModeSchema,
    layers: z.array(effectLayerSchema),
  })
  .strict();

export type EffectConfig = z.infer<typeof effectConfigSchema>;
