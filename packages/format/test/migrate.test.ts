import { describe, expect, it } from 'vitest';
import { computeContentHash, verifyContentHash } from '../src/hash/hash';
import type { SkeletonDocument } from '../src/types';
import { validateDocument } from '../src/validate';
import { migrateToCurrent, runMigrations } from '../src/version/migrate';
import type { MigrationStep } from '../src/version/migrations';
import { cloneMinimal } from './helpers';

// WP-2.2 / ADR-0004, stage F1 / ADR-0008, and stage F2 / ADR-0009 (format-contract section 10.4, 10.5):
// the migration framework and the 0.1.x -> 0.2.0 -> 0.3.0 -> 0.4.0 chain. A pre-current document is
// forward-migrated on import (empties injected, constraints reshaped, version stamped, hash recomputed)
// so every committed older document still loads (backward compatibility). A 0.1.0 document walks every
// step to reach 0.4.0.

// A Phase-1 (0.1.0) document: no ikConstraints/transformConstraints, an animation without the
// ik/transform/deform timelines. Returned as a plain object (it does NOT satisfy the current schema).
function oldMinimal(hash: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    formatVersion: '0.1.0',
    name: 'minimal',
    hash: '',
    bones: [
      {
        name: 'root',
        parent: null,
        length: 100,
        x: 0,
        y: 0,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        shearX: 0,
        shearY: 0,
        transformMode: 'normal',
      },
    ],
    slots: [],
    skins: [{ name: 'default', attachments: {} }],
    animations: {
      idle: {
        duration: 1,
        bones: {
          root: {
            rotate: [
              { time: 0, value: { angle: 0 }, curve: 'linear' },
              { time: 1, value: { angle: 30 }, curve: 'linear' },
            ],
          },
        },
        slots: {},
      },
    },
    atlas: { pages: [] },
  };
  if (hash !== '') base['hash'] = hash;
  return base;
}

describe('0.1.x -> 0.4.0 migration chain (ADR-0004, ADR-0008, ADR-0009)', () => {
  it('injects every added collection through the chain and stamps 0.4.0', () => {
    const result = migrateToCurrent(oldMinimal(''));
    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    const doc = result.doc as SkeletonDocument;
    expect(doc.formatVersion).toBe('0.4.0');
    // Phase 2 (0.2.0) additions.
    expect(doc.ikConstraints).toEqual([]);
    expect(doc.transformConstraints).toEqual([]);
    expect(doc.animations['idle']?.ik).toEqual({});
    expect(doc.animations['idle']?.transform).toEqual({});
    expect(doc.animations['idle']?.deform).toEqual({});
    // Stage F1 (0.3.0) additions.
    expect(doc.events).toEqual([]);
    expect(doc.animations['idle']?.drawOrder).toEqual([]);
    expect(doc.animations['idle']?.events).toEqual([]);
    // The pre-existing bone timeline survives unchanged.
    expect(doc.animations['idle']?.bones['root']?.rotate?.length).toBe(2);
  });

  it('a migrated draft (empty source hash) stays a draft and validates', () => {
    const result = migrateToCurrent(oldMinimal(''));
    if (result.kind !== 'migrated') throw new Error('expected migrated');
    const doc = result.doc as SkeletonDocument;
    expect(doc.hash).toBe('');
    expect(validateDocument(doc).ok).toBe(true); // HASH_ABSENT is a warning, not an error
  });

  it('recomputes the content hash when the source carried one (load-path hash layer passes)', () => {
    // Build a self-consistent 0.1.0 document hash, then migrate: the migrated doc must carry a hash
    // that matches its NEW content (canonical bytes changed: formatVersion + injected collections).
    const draft = oldMinimal('');
    const sourceHash = computeContentHash(draft as unknown as SkeletonDocument);
    const result = migrateToCurrent(oldMinimal(sourceHash));
    if (result.kind !== 'migrated') throw new Error('expected migrated');
    const doc = result.doc as SkeletonDocument;
    expect(doc.hash).not.toBe('');
    expect(doc.hash).not.toBe(sourceHash); // content changed, so the hash changed
    expect(verifyContentHash(doc)).toBe(true);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('validateDocument forward-migrates a 0.1.0 document end to end', () => {
    const report = validateDocument(oldMinimal(''));
    expect(report.ok).toBe(true);
    expect(report.document?.formatVersion).toBe('0.4.0');
    expect(report.document?.ikConstraints).toEqual([]);
    expect(report.document?.events).toEqual([]);
  });

  it('migrateToCurrent on a current 0.4.0 document is unchanged', () => {
    const result = migrateToCurrent(cloneMinimal());
    expect(result.kind).toBe('unchanged');
  });

  it('maps a 0.3.0 IK constraint bendPositive to the signed bend and injects depth defaults (ADR-0009)', () => {
    // A 0.3.0 document with a fully-shaped IK constraint (bendPositive, no depth fields) and an IK
    // timeline frame; the migration replaces bendPositive with bend and injects the depth defaults.
    const source = {
      ...(cloneMinimal() as unknown as Record<string, unknown>),
      formatVersion: '0.3.0',
      hash: '',
      ikConstraints: [
        { name: 'ik', bones: ['root'], target: 'root', mix: 1, bendPositive: false },
      ],
      animations: {
        idle: {
          duration: 1,
          bones: {},
          slots: {},
          ik: { ik: [{ time: 0, value: { mix: 1, bendPositive: true }, curve: 'stepped' }] },
          transform: {},
          deform: {},
          drawOrder: [],
          events: [],
        },
      },
    };
    const result = migrateToCurrent(source);
    expect(result.kind).toBe('migrated');
    if (result.kind !== 'migrated') return;
    const doc = result.doc as SkeletonDocument;
    const constraint = doc.ikConstraints[0];
    expect(constraint?.bend).toBe(-1); // bendPositive false -> -1
    expect(constraint).not.toHaveProperty('bendPositive');
    expect(constraint?.softness).toBe(0);
    expect(constraint?.stretch).toBe(false);
    expect(constraint?.compress).toBe(false);
    expect(constraint?.uniform).toBe(false);
    const frame = doc.animations['idle']?.ik['ik']?.[0]?.value;
    expect(frame?.bend).toBe(1); // bendPositive true -> +1
    expect(frame).not.toHaveProperty('bendPositive');
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('a below-current version with no chain link is unsupported', () => {
    const result = migrateToCurrent({ ...oldMinimal(''), formatVersion: '0.0.9' });
    expect(result.kind).toBe('unsupported');
  });

  it('runs a multi-step injected chain contiguously (framework, format-contract 10.5)', () => {
    const chain: readonly MigrationStep[] = [
      {
        fromKey: 1,
        toKey: 2,
        targetVersion: '0.2.0',
        migrate: (doc) => {
          if (typeof doc !== 'object' || doc === null) return doc;
          return { ...doc, ikConstraints: [], transformConstraints: [], formatVersion: '0.2.0' };
        },
      },
      {
        fromKey: 2,
        toKey: 3,
        targetVersion: '0.3.0',
        migrate: (doc) => doc, // a hypothetical future step (identity for this framework test)
      },
    ];
    // The runner validates only the FINAL document (ADR-0008 section 7), so it walks both steps and
    // reports the final version as long as the migrated result is structurally valid at current.
    const doc = { ...cloneMinimal(), formatVersion: '0.1.0', hash: '' };
    const result = runMigrations(doc, chain, '0.3.0');
    expect(result.kind).toBe('migrated');
    if (result.kind === 'migrated') {
      expect(result.from).toBe('0.1.0');
      expect(result.to).toBe('0.3.0');
    }
  });
});
