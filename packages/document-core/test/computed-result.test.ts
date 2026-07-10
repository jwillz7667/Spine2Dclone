import { describe, expect, it } from 'vitest';
import { NormalizeBoneRotationCommand, type CommandContext } from '../src';
// Deep imports of the package-internal write surface: the only way to build a CommandContext and call
// a command's do/undo directly. This is the sole path that distinguishes the computed-result REPLAY
// property from a recompute, because through the public History API a post-undo execute clears the
// redo stack, so the bone is always back to its pre-do value at redo time.
import { emptyPreservedContent } from '../src/model/doc-state';
import { defaultSlotSceneState } from '../src/model/slot-scene';
import { makeIdFactory } from '../src/model/ids';
import { DocumentModelInternal } from '../src/model/internal';
import { createMutator } from '../src/model/mutator';

describe('computed-result command replays its stored result on redo', () => {
  it('redo writes the value computed on first do, not a recompute from the changed model', () => {
    const ids = makeIdFactory();
    const boneId = ids.mint('bone');
    const model = new DocumentModelInternal(
      {
        formatVersion: '0.1.0',
        name: 'computed',
        bones: new Map([
          [
            boneId,
            {
              id: boneId,
              name: 'root',
              parent: null,
              length: 100,
              x: 0,
              y: 0,
              rotation: 270,
              scaleX: 1,
              scaleY: 1,
              shearX: 0,
              shearY: 0,
              transformMode: 'normal',
            },
          ],
        ]),
        boneOrder: [boneId],
        slots: new Map(),
        slotOrder: [],
        attachments: new Map(),
        animations: new Map(),
        ikConstraints: new Map(),
        ikConstraintOrder: [],
        transformConstraints: new Map(),
        transformConstraintOrder: [],
        pathConstraints: new Map(),
        pathConstraintOrder: [],
        physicsConstraints: new Map(),
        physicsConstraintOrder: [],
        physicsSettings: undefined,
        skins: new Map(),
        skinOrder: [],
        events: new Map(),
        eventOrder: [],
        metadata: undefined,
        slotScene: defaultSlotSceneState(),
        preserved: emptyPreservedContent(),
      },
      ids,
    );
    const mutator = createMutator(model);
    const ctx: CommandContext = { mutate: mutator, ids };

    const cmd = new NormalizeBoneRotationCommand(boneId);
    cmd.do(ctx); // 270 -> wrapDegrees(270) = -90; stores after = -90
    expect(model.getBone(boneId)!.rotation).toBe(-90);

    cmd.undo(ctx); // -> 270
    // An unrelated edit sets the rotation to an already-normalized value (wrapDegrees(45) === 45).
    mutator.patchBone(boneId, { rotation: 45 });
    expect(model.getBone(boneId)!.rotation).toBe(45);

    cmd.do(ctx); // redo: MUST replay the stored -90, not recompute wrapDegrees(45) = 45
    expect(model.getBone(boneId)!.rotation).toBe(-90);
  });
});
