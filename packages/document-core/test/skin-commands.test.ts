import { describe, expect, it } from 'vitest';
import { CreateSkinCommand } from '../src/commands/create-skin.command';
import { RenameSkinCommand } from '../src/commands/rename-skin.command';
import { DeleteSkinCommand } from '../src/commands/delete-skin.command';
import { SetSkinAttachmentCommand } from '../src/commands/set-skin-attachment.command';
import { RemoveSkinAttachmentCommand } from '../src/commands/remove-skin-attachment.command';
import {
  SkinError,
  assertInvariants,
  loadDocument,
  type AttachmentEntity,
  type Document,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// A region attachment value the SetSkinAttachment tests place into a named skin. The atlas `path` resolves
// to the 'rigged' seed's 'skin_panel' region; the command trusts the caller (resolution is the validator's
// job), so any name/slot pairing the test picks is fine.
function region(name: string): AttachmentEntity {
  return {
    kind: 'region',
    name,
    path: 'skin_panel',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    width: 64,
    height: 64,
    color: { r: 1, g: 1, b: 1, a: 1 },
  };
}

function meshSlotId(doc: Document): string {
  const slot = doc.model.slots().find((s) => s.name === 'mesh_slot');
  if (!slot) throw new Error('seed has no mesh_slot');
  return slot.id;
}

describe('CreateSkin', () => {
  it('rejects the reserved "default" name without mutating', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new CreateSkinCommand(doc.ids.mint('skin'), 'default')),
    ).toThrow(expect.objectContaining({ name: 'SkinError', reason: 'defaultProtected' }));
    expect(() =>
      doc.history.execute(new CreateSkinCommand(doc.ids.mint('skin'), 'default')),
    ).toThrow(SkinError);
    expect(doc.model.snapshot()).toEqual(before);
    expect(doc.history.canUndo).toBe(false);
    assertInvariants(doc.model);
  });

  it('rejects a duplicate skin name without mutating', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env); // already has the named 'variant' skin
    const before = doc.model.snapshot();

    expect(() =>
      doc.history.execute(new CreateSkinCommand(doc.ids.mint('skin'), 'variant')),
    ).toThrow(expect.objectContaining({ name: 'SkinError', reason: 'duplicateName' }));
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });

  it('appends a named skin and undo deep-equals the prior state', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const before = doc.model.snapshot();

    doc.history.execute(new CreateSkinCommand(doc.ids.mint('skin'), 'skin_new'));
    expect(doc.model.skins()).toHaveLength(1);
    expect(doc.model.skins()[0]!.name).toBe('skin_new');
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });
});

describe('RenameSkin', () => {
  it('rejects "default" and a colliding name without mutating', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    doc.history.execute(new CreateSkinCommand(doc.ids.mint('skin'), 'second'));
    const before = doc.model.snapshot();

    expect(() => doc.history.execute(new RenameSkinCommand(skin.id, 'default'))).toThrow(
      expect.objectContaining({ name: 'SkinError', reason: 'defaultProtected' }),
    );
    expect(() => doc.history.execute(new RenameSkinCommand(skin.id, 'second'))).toThrow(
      expect.objectContaining({ name: 'SkinError', reason: 'duplicateName' }),
    );
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });

  it('rejects renaming a skin that does not exist', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.minimal, env);
    const ghost = doc.ids.mint('skin'); // a valid SkinId brand no skin owns
    expect(() => doc.history.execute(new RenameSkinCommand(ghost, 'whatever'))).toThrow(
      expect.objectContaining({ name: 'SkinError', reason: 'notFound' }),
    );
  });

  it('renames a named skin and undo restores the prior name', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const before = doc.model.snapshot();
    const original = skin.name;

    doc.history.execute(new RenameSkinCommand(skin.id, `${original}_renamed`));
    expect(doc.model.getSkin(skin.id)!.name).toBe(`${original}_renamed`);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.getSkin(skin.id)!.name).toBe(original);
    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });
});

describe('DeleteSkin', () => {
  it('removes the named skin and undo deep-equals the prior state', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const before = doc.model.snapshot();

    doc.history.execute(new DeleteSkinCommand(skin.id));
    expect(doc.model.getSkin(skin.id)).toBeUndefined();
    expect(doc.model.skins()).toHaveLength(0);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // skin and its attachments restored
    assertInvariants(doc.model);
  });

  it('rejects deleting a skin that does not exist', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const ghost = doc.ids.mint('skin');
    expect(() => doc.history.execute(new DeleteSkinCommand(ghost))).toThrow(
      expect.objectContaining({ name: 'SkinError', reason: 'notFound' }),
    );
  });
});

describe('SetSkinAttachment', () => {
  it('adds an attachment to a named skin and undo removes it', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();
    const countBefore = doc.model.getSkin(skin.id)!.attachments.get(slotId)?.size ?? 0;

    doc.history.execute(new SetSkinAttachmentCommand(skin.id, slotId, region('extra')));
    expect(doc.model.getSkin(skin.id)!.attachments.get(slotId)!.get('extra')).toBeDefined();
    expect(doc.model.getSkin(skin.id)!.attachments.get(slotId)!.size).toBe(countBefore + 1);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // freshly-added attachment removed
    assertInvariants(doc.model);
  });

  it('replaces an existing attachment and undo restores the prior value', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();

    // 'alt' already exists on the variant skin; set a region with the SAME name to replace it.
    const replacement = { ...region('alt'), width: 99 };
    doc.history.execute(new SetSkinAttachmentCommand(skin.id, slotId, replacement));
    const after = doc.model.getSkin(skin.id)!.attachments.get(slotId)!.get('alt')!;
    expect(after.kind).toBe('region');
    if (after.kind === 'region') expect(after.width).toBe(99);
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // prior 'alt' attachment restored exactly
    assertInvariants(doc.model);
  });

  it('rejects a missing skin and a missing slot without mutating', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();

    const ghostSkin = doc.ids.mint('skin');
    expect(() =>
      doc.history.execute(new SetSkinAttachmentCommand(ghostSkin, slotId, region('x'))),
    ).toThrow(expect.objectContaining({ name: 'SkinError', reason: 'notFound' }));

    const ghostSlot = doc.ids.mint('slot');
    expect(() =>
      doc.history.execute(new SetSkinAttachmentCommand(skin.id, ghostSlot, region('x'))),
    ).toThrow(expect.objectContaining({ name: 'SkinError', reason: 'slotMissing' }));

    expect(doc.model.snapshot()).toEqual(before);
    assertInvariants(doc.model);
  });
});

describe('RemoveSkinAttachment', () => {
  it('removes an attachment and undo restores it verbatim', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const slotId = meshSlotId(doc);
    const before = doc.model.snapshot();

    expect(doc.model.getSkin(skin.id)!.attachments.get(slotId)!.get('alt')).toBeDefined();
    doc.history.execute(new RemoveSkinAttachmentCommand(skin.id, slotId, 'alt'));
    expect(doc.model.getSkin(skin.id)!.attachments.get(slotId)?.get('alt')).toBeUndefined();
    assertInvariants(doc.model);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before); // 'alt' restored exactly
    assertInvariants(doc.model);
  });

  it('rejects removing an attachment that is not present', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const skin = doc.model.skins()[0]!;
    const slotId = meshSlotId(doc);
    expect(() =>
      doc.history.execute(new RemoveSkinAttachmentCommand(skin.id, slotId, 'nope')),
    ).toThrow(expect.objectContaining({ name: 'SkinError', reason: 'notFound' }));
  });
});

describe('per-skin attachment resolution', () => {
  it('resolves a different attachment per skin on the same slot', () => {
    const { env } = makeTestEnv();
    const doc = loadDocument(seeds.rigged, env);
    const variant = doc.model.skins()[0]!; // owns 'alt' on mesh_slot
    const slotId = meshSlotId(doc);

    // Create a second named skin and give it a DIFFERENT attachment on the SAME slot.
    const secondId = doc.ids.mint('skin');
    doc.history.execute(new CreateSkinCommand(secondId, 'second'));
    doc.history.execute(new SetSkinAttachmentCommand(secondId, slotId, region('other')));

    // Each skin resolves its own attachment for the same (slotId) address; the names are disjoint.
    expect(variant.attachments.get(slotId)!.get('alt')).toBeDefined();
    expect(doc.model.getSkin(variant.id)!.attachments.get(slotId)!.get('other')).toBeUndefined();
    expect(doc.model.getSkin(secondId)!.attachments.get(slotId)!.get('other')).toBeDefined();
    expect(doc.model.getSkin(secondId)!.attachments.get(slotId)!.get('alt')).toBeUndefined();
    assertInvariants(doc.model);
  });
});
