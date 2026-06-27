import { describe, expect, it } from 'vitest';
import {
  chooseActiveAfterDelete,
  duplicateNameFor,
  duplicateNameKeys,
  uniqueAnimationName,
} from './animation-manager';

describe('uniqueAnimationName', () => {
  it('returns the base name unchanged when it is free', () => {
    expect(uniqueAnimationName(['idle', 'walk'], 'run')).toBe('run');
  });

  it('appends suffix 2 on a single collision', () => {
    expect(uniqueAnimationName(['idle copy'], 'idle copy')).toBe('idle copy 2');
  });

  it('skips a run of collisions to the first free suffix', () => {
    expect(uniqueAnimationName(['anim', 'anim 2', 'anim 3'], 'anim')).toBe('anim 4');
  });
});

describe('chooseActiveAfterDelete', () => {
  it('leaves a non-active deletion untouched', () => {
    expect(chooseActiveAfterDelete(['a', 'b'], 'c', 'a')).toBe('a');
  });

  it('falls back to the first remaining when the active one is deleted', () => {
    expect(chooseActiveAfterDelete(['b', 'c'], 'a', 'a')).toBe('b');
  });

  it('returns null when the active one is deleted and none remain', () => {
    expect(chooseActiveAfterDelete([], 'a', 'a')).toBeNull();
  });
});

describe('duplicateNameFor', () => {
  it('derives "<source> copy" and uniquifies against existing names', () => {
    expect(duplicateNameFor('idle', ['idle'])).toBe('idle copy');
    expect(duplicateNameFor('idle', ['idle', 'idle copy'])).toBe('idle copy 2');
  });
});

describe('duplicateNameKeys', () => {
  it('reports names that occur more than once and ignores unique ones', () => {
    const keys = duplicateNameKeys([{ name: 'idle' }, { name: 'walk' }, { name: 'idle' }]);

    expect(keys.has('idle')).toBe(true);
    expect(keys.has('walk')).toBe(false);
    expect(keys.size).toBe(1);
  });

  it('returns an empty set when all names are unique', () => {
    expect(duplicateNameKeys([{ name: 'a' }, { name: 'b' }]).size).toBe(0);
  });
});
