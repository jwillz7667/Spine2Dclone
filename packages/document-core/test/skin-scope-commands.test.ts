import { describe, expect, it } from 'vitest';
import {
  AddSkinScopeCommand,
  RemoveSkinScopeCommand,
  SkinError,
  loadDocument,
  type Document,
  type SkinId,
} from '../src';
import { makeTestEnv, seeds } from './seeds';

// Stage F2 (ADR-0009 section 5, PP-D10) skin-scoping commands: add/remove a bone or constraint NAME to a
// named skin's active-only lists. The generic round-trip harness proves do/undo/redo is bit-exact on the
// rigged seed (whose 'variant' skin is pre-scoped); these tests pin the boundary rejections and the
// last-entry canonicalization the harness does not.

function rigged(): Document {
  const { env } = makeTestEnv();
  return loadDocument(seeds.rigged, env);
}

function variantSkinId(doc: Document): SkinId {
  const skin = doc.model.skins().find((s) => s.name === 'variant');
  if (!skin) throw new Error('rigged seed lost its variant skin');
  return skin.id;
}

function variant(doc: Document) {
  return doc.model.skins().find((s) => s.name === 'variant');
}

describe('skin-scope commands (Stage F2)', () => {
  it('adds a bone scope and round-trips do/undo', () => {
    const doc = rigged();
    const skinId = variantSkinId(doc);
    const before = doc.model.snapshot();

    doc.history.execute(new AddSkinScopeCommand(skinId, 'bones', 'upper'));
    expect(variant(doc)?.bones).toEqual(['follower', 'upper']);

    doc.history.undo();
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects an unknown bone / constraint name (scopeUnknownBone / scopeUnknownConstraint)', () => {
    const doc = rigged();
    const skinId = variantSkinId(doc);

    expect(() => doc.history.execute(new AddSkinScopeCommand(skinId, 'bones', 'nope'))).toThrowError(
      SkinError,
    );
    expect(() =>
      doc.history.execute(new AddSkinScopeCommand(skinId, 'constraints', 'nope')),
    ).toThrowError(SkinError);
  });

  it('rejects a duplicate add (scopeDuplicate) and a missing remove (scopeMissing)', () => {
    const doc = rigged();
    const skinId = variantSkinId(doc);

    let dup: unknown;
    try {
      doc.history.execute(new AddSkinScopeCommand(skinId, 'bones', 'follower'));
    } catch (e) {
      dup = e;
    }
    expect((dup as SkinError).reason).toBe('scopeDuplicate');

    let missing: unknown;
    try {
      doc.history.execute(new RemoveSkinScopeCommand(skinId, 'bones', 'upper'));
    } catch (e) {
      missing = e;
    }
    expect((missing as SkinError).reason).toBe('scopeMissing');
  });

  it('removing the last scoped name clears the dimension, and undo restores the absent field', () => {
    const doc = rigged();
    const skinId = variantSkinId(doc);
    // The variant skin is pre-scoped to exactly one bone ('follower').
    expect(variant(doc)?.bones).toEqual(['follower']);
    const before = doc.model.snapshot();

    doc.history.execute(new RemoveSkinScopeCommand(skinId, 'bones', 'follower'));
    // The dimension is dropped entirely (canonical: no empty-array scoping), not left as [].
    expect(variant(doc)?.bones).toBeUndefined();

    doc.history.undo();
    expect(variant(doc)?.bones).toEqual(['follower']);
    expect(doc.model.snapshot()).toEqual(before);
  });

  it('rejects operating on a non-existent skin (notFound)', () => {
    const doc = rigged();
    let thrown: unknown;
    try {
      doc.history.execute(new AddSkinScopeCommand('skin_nope' as SkinId, 'bones', 'upper'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as SkinError).reason).toBe('notFound');
  });
});
