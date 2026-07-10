import { describe, expect, it } from 'vitest';
import {
  DeleteBoneCommand,
  PasteBoneSubtreeCommand,
  assertInvariants,
  captureBoneSubtree,
  loadDocument,
  uniqueDuplicateName,
  type BoneId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// Bone copy/paste/duplicate (PP-D7): the pure capture projection + unique-name helper, and the
// PasteBoneSubtreeCommand's deep-copy / id-remap / reparent semantics. The generic do/undo/redo bit-exact
// round-trip is proven by the round-trip harness (spec registered in the registry); these tests pin the
// SEMANTICS the harness cannot (fresh ids, unique names, slots + attachments copied, reparent target,
// document-independence of the clip).

function load(seed: (typeof seeds)[keyof typeof seeds]) {
  const { env } = makeTestEnv();
  return loadDocument(seed, env);
}

function boneByName(model: { bones(): readonly { id: BoneId; name: string }[] }, name: string) {
  return model.bones().find((bone) => bone.name === name);
}

describe('uniqueDuplicateName', () => {
  it('appends _copy when the base copy name is free', () => {
    expect(uniqueDuplicateName(new Set(['arm']), 'arm')).toBe('arm_copy');
  });

  it('disambiguates with an ascending integer when _copy is taken', () => {
    expect(uniqueDuplicateName(new Set(['arm', 'arm_copy']), 'arm')).toBe('arm_copy2');
    expect(uniqueDuplicateName(new Set(['arm', 'arm_copy', 'arm_copy2']), 'arm')).toBe('arm_copy3');
  });
});

describe('captureBoneSubtree', () => {
  it('projects a subtree in pre-order with parent indices, slots, and attachments', () => {
    const doc = load(seeds.slotted);
    const root = boneByName(doc.model, 'root')!;

    const clip = captureBoneSubtree(doc.model, root.id);

    expect(clip).not.toBeNull();
    expect(clip!.bones.map((b) => b.geometry.name)).toEqual(['root', 'arm']);
    // The root's real parent is outside the subtree, so it is nulled; the child links to clip index 0.
    expect(clip!.bones[0]!.parentIndex).toBeNull();
    expect(clip!.bones[1]!.parentIndex).toBe(0);
    // 'body' rides root and carries one region attachment; 'hand' rides arm with none.
    expect(clip!.bones[0]!.slots.map((s) => s.name)).toEqual(['body']);
    expect(clip!.bones[0]!.slots[0]!.attachments).toHaveLength(1);
    expect(clip!.bones[0]!.slots[0]!.attachments[0]!.name).toBe('body');
    expect(clip!.bones[1]!.slots.map((s) => s.name)).toEqual(['hand']);
    expect(clip!.bones[1]!.slots[0]!.attachments).toHaveLength(0);
  });

  it('returns null when the root does not resolve', () => {
    const doc = load(seeds.minimal);
    expect(captureBoneSubtree(doc.model, 'bone_does_not_exist' as BoneId)).toBeNull();
  });
});

describe('PasteBoneSubtreeCommand', () => {
  it('duplicates a subtree in place with fresh ids, unique names, and copied slots/attachments', () => {
    const doc = load(seeds.slotted);
    const root = boneByName(doc.model, 'root')!;
    const beforeBoneIds = new Set(doc.model.bones().map((b) => b.id));
    const beforeSlotIds = new Set(doc.model.slots().map((s) => s.id));

    const clip = captureBoneSubtree(doc.model, root.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(clip, root.parent));

    const bones = doc.model.bones();
    expect(bones).toHaveLength(4); // root, arm, root_copy, arm_copy
    const copyRoot = boneByName(doc.model, 'root_copy')!;
    const copyArm = boneByName(doc.model, 'arm_copy')!;
    expect(copyRoot).toBeDefined();
    expect(copyArm).toBeDefined();
    // Fresh ids, not aliases of the originals.
    expect(beforeBoneIds.has(copyRoot.id)).toBe(false);
    expect(beforeBoneIds.has(copyArm.id)).toBe(false);
    // The copied child re-links to the copied parent (not the original), and the copied root is a root.
    expect(copyRoot.parent).toBeNull();
    expect(copyArm.parent).toBe(copyRoot.id);

    // Slots duplicated with unique names, riding the copied bones, and the region attachment copied.
    const copyBody = doc.model.slots().find((s) => s.name === 'body_copy')!;
    const copyHand = doc.model.slots().find((s) => s.name === 'hand_copy')!;
    expect(copyBody).toBeDefined();
    expect(copyHand).toBeDefined();
    expect(beforeSlotIds.has(copyBody.id)).toBe(false);
    expect(copyBody.bone).toBe(copyRoot.id);
    expect(copyHand.bone).toBe(copyArm.id);
    const copiedAttachments = doc.model.attachments(copyBody.id);
    expect(copiedAttachments).toHaveLength(1);
    expect(copiedAttachments[0]!.name).toBe('body');
    expect(copyBody.attachment).toBe('body');
    assertInvariants(doc.model);
  });

  it('do then undo restores the pre-paste state exactly', () => {
    const doc = load(seeds.slotted);
    const root = boneByName(doc.model, 'root')!;
    const before = doc.model.snapshot();

    const clip = captureBoneSubtree(doc.model, root.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(clip, root.parent));
    doc.history.undo();

    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });

  it('pastes under a chosen target parent (paste-under-target reparents the copy)', () => {
    const doc = load(seeds.slotted);
    const arm = boneByName(doc.model, 'arm')!;
    const root = boneByName(doc.model, 'root')!;

    const clip = captureBoneSubtree(doc.model, arm.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(clip, root.id));

    const copyArm = boneByName(doc.model, 'arm_copy')!;
    expect(copyArm.parent).toBe(root.id); // reparented under the chosen target, not arm's old parent
    assertInvariants(doc.model);
  });

  it('holds a document-independent clip: paste still works after the source is deleted', () => {
    const doc = load(seeds.slotted);
    const root = boneByName(doc.model, 'root')!;
    const arm = boneByName(doc.model, 'arm')!;

    const clip = captureBoneSubtree(doc.model, root.id)!;
    // Delete the arm AFTER capture; the clip is a plain value and is unaffected.
    doc.history.execute(new DeleteBoneCommand(arm.id));
    doc.history.execute(new PasteBoneSubtreeCommand(clip, null));

    // The full two-bone subtree is recreated even though the live arm is gone.
    expect(boneByName(doc.model, 'root_copy')).toBeDefined();
    expect(boneByName(doc.model, 'arm_copy')).toBeDefined();
    assertInvariants(doc.model);
  });

  it('disambiguates names when duplicating the same subtree twice', () => {
    const doc = load(seeds.slotted);
    const root = boneByName(doc.model, 'root')!;

    const first = captureBoneSubtree(doc.model, root.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(first, root.parent));
    const second = captureBoneSubtree(doc.model, root.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(second, root.parent));

    expect(boneByName(doc.model, 'root_copy')).toBeDefined();
    expect(boneByName(doc.model, 'root_copy2')).toBeDefined();
    assertInvariants(doc.model);
  });

  it('copies a weighted mesh attachment verbatim with the duplicated slot', () => {
    const doc = load(seeds.weighted);
    const root = boneByName(doc.model, 'root')!;

    const clip = captureBoneSubtree(doc.model, root.id)!;
    doc.history.execute(new PasteBoneSubtreeCommand(clip, root.parent));

    const copySlot = doc.model.slots().find((s) => s.name === 'mesh_slot_copy')!;
    expect(copySlot).toBeDefined();
    const attachments = doc.model.attachments(copySlot.id);
    expect(attachments).toHaveLength(1);
    const mesh = attachments[0]!;
    expect(mesh.kind).toBe('mesh');
    assertInvariants(doc.model);
  });
});
