import { describe, expect, it } from 'vitest';
import {
  buildEventAudio,
  buildEventDefInit,
  clampBalance,
  clampVolume,
  parseOptionalFloat,
  parseOptionalInt,
  parseOptionalString,
  uniqueEventName,
} from './events-logic';

describe('uniqueEventName', () => {
  it('returns the base name when it is free', () => {
    expect(uniqueEventName(['footstep'], 'event')).toBe('event');
  });

  it('appends the smallest free numeric suffix from 2', () => {
    expect(uniqueEventName(['event', 'event 2'], 'event')).toBe('event 3');
  });

  it('skips a taken suffix in the middle of the run', () => {
    expect(uniqueEventName(['event', 'event 3'], 'event')).toBe('event 2');
  });
});

describe('parseOptionalInt', () => {
  it('clears an empty field to undefined', () => {
    expect(parseOptionalInt('   ')).toBeUndefined();
  });

  it('truncates a finite value to an integer', () => {
    expect(parseOptionalInt('3.9')).toBe(3);
    expect(parseOptionalInt('-3.9')).toBe(-3);
  });

  it('rejects a non-finite entry as undefined', () => {
    expect(parseOptionalInt('abc')).toBeUndefined();
  });
});

describe('parseOptionalFloat', () => {
  it('clears an empty field and passes a finite value through', () => {
    expect(parseOptionalFloat('')).toBeUndefined();
    expect(parseOptionalFloat('1.25')).toBe(1.25);
  });
});

describe('parseOptionalString', () => {
  it('clears whitespace to undefined and trims a real value', () => {
    expect(parseOptionalString('   ')).toBeUndefined();
    expect(parseOptionalString('  hit  ')).toBe('hit');
  });
});

describe('clampVolume / clampBalance', () => {
  it('clamps volume into [0, 1]', () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(0.4)).toBe(0.4);
  });

  it('clamps balance into [-1, 1]', () => {
    expect(clampBalance(-2)).toBe(-1);
    expect(clampBalance(2)).toBe(1);
    expect(clampBalance(0.3)).toBe(0.3);
  });
});

describe('buildEventAudio', () => {
  it('drops the hint when the path is empty', () => {
    expect(buildEventAudio('  ', '0.5', '0')).toBeUndefined();
  });

  it('builds a range-clamped hint from a present path', () => {
    expect(buildEventAudio('sfx/step.wav', '2', '-3')).toEqual({
      path: 'sfx/step.wav',
      volume: 1,
      balance: -1,
    });
  });

  it('defaults the neutral volume/balance when those fields are empty', () => {
    expect(buildEventAudio('sfx/step.wav', '', '')).toEqual({
      path: 'sfx/step.wav',
      volume: 1,
      balance: 0,
    });
  });
});

describe('buildEventDefInit', () => {
  it('composes cleared payload fields and no audio from empty inputs', () => {
    expect(
      buildEventDefInit({
        intRaw: '',
        floatRaw: '',
        stringRaw: '',
        pathRaw: '',
        volumeRaw: '',
        balanceRaw: '',
      }),
    ).toEqual({ int: undefined, float: undefined, string: undefined, audio: undefined });
  });

  it('composes normalized payload defaults and a range-clamped audio hint', () => {
    expect(
      buildEventDefInit({
        intRaw: '7.8',
        floatRaw: '0.5',
        stringRaw: '  land ',
        pathRaw: 'sfx/land.wav',
        volumeRaw: '0.75',
        balanceRaw: '0.25',
      }),
    ).toEqual({
      int: 7,
      float: 0.5,
      string: 'land',
      audio: { path: 'sfx/land.wav', volume: 0.75, balance: 0.25 },
    });
  });
});
