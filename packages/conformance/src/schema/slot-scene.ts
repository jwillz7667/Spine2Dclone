import { slotSceneSchema } from '@marionette/format/slot';
import type { SlotScene } from '@marionette/format/slot-types';

// The committed slot SCENE loader (phase-4-slot-composer.md WP-4.13). A committed scene json is the authored
// `SlotScene` VALUE (the scene, not the on-disk SlotSceneDocument envelope), validated ON LOAD against the
// format Zod schema `slotSceneSchema` (Law 3, fail loudly). We validate the SCHEMA only (not the
// resolver-based ref checks, which are WP-4.4's concern): the sequencer reads grid/winSequencer/featureFlows/
// tumble, and `scene.symbols` by keyed lookup only (landing/anticipation never iterate it), so the cross-ref
// resolution of skeletons/vfxPresets is not required to lock the timeline. A scene the schema would reject can
// never be committed as a golden source.

export class SlotSceneValidationError extends Error {
  override readonly name = 'SlotSceneValidationError';
  readonly issues: readonly { readonly path: string; readonly message: string }[];

  constructor(issues: readonly { readonly path: string; readonly message: string }[]) {
    super(`slot scene failed schema validation with ${issues.length} issue(s)`);
    this.issues = issues;
  }
}

// Validate a parsed scene json against the format slotSceneSchema, throwing a typed error on malformation.
export function validateSlotSceneValue(input: unknown): SlotScene {
  const result = slotSceneSchema.safeParse(input);
  if (!result.success) {
    throw new SlotSceneValidationError(
      result.error.issues.map((issue) => ({
        path: `/${issue.path.join('/')}`,
        message: issue.message,
      })),
    );
  }
  return result.data;
}
