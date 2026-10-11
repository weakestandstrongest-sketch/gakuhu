import { describe, expect, it } from 'vitest';
import {
  MAJOR_NINTH,
  MAJOR_SECOND,
  keyAlterations,
  keyName,
  pitchName,
  pitchToMidi,
  spellMidi,
  transposeKey,
  transposePitch,
} from '../src/music/pitch';
import { chooseOctaveShift } from '../src/music/instruments';

const P = (step: number, alter: number, octave: number) => ({ step, alter, octave });

describe('transposePitch', () => {
  it('実音C4 はテナー記譜で D5', () => {
    const w = transposePitch(P(0, 0, 4), MAJOR_NINTH);
    expect(w).toEqual(P(1, 0, 5));
    expect(pitchToMidi(w) - 60).toBe(14);
  });
  it('異名同音を度数で書き分ける', () => {
    expect(pitchName(transposePitch(P(6, -1, 3), MAJOR_SECOND))).toBe('C'); // B♭ → C
    expect(pitchName(transposePitch(P(4, 1, 4), MAJOR_SECOND))).toBe('A♯'); // G♯ → A♯
    expect(pitchName(transposePitch(P(2, 1, 4), MAJOR_SECOND))).toBe('F𝄪'); // E♯ → F𝄪
  });
});

describe('transposeKey', () => {
  it('コンサート F → テナー G', () => {
    expect(transposeKey(-1, MAJOR_NINTH).fifths).toBe(1);
  });
  it('コンサート B♭ → テナー C', () => {
    expect(transposeKey(-2, MAJOR_NINTH).fifths).toBe(0);
  });
  it('コンサート E → テナー F♯', () => {
    expect(transposeKey(4, MAJOR_NINTH).fifths).toBe(6);
  });
  it('コンサート B → テナー D♭ (C♯ にしない)', () => {
    const r = transposeKey(5, MAJOR_NINTH);
    expect(r.fifths).toBe(-5);
    expect(keyName(r.fifths)).toBe('D♭');
    // B → C♯ (+M9) を減2度で D♭ に綴り直す
    const n = transposePitch(transposePitch(P(6, 0, 3), MAJOR_NINTH), r.respell);
    expect(pitchName(n)).toBe('D♭');
  });
});

describe('spellMidi', () => {
  it('調に合わせて綴る', () => {
    expect(pitchName(spellMidi(66, 1))).toBe('F♯'); // G major
    expect(pitchName(spellMidi(70, -1))).toBe('B♭'); // F major
    expect(pitchName(spellMidi(63, 0))).toBe('E♭'); // C major のブルーノート
    expect(pitchName(spellMidi(65, 6))).toBe('E♯'); // F♯ major
    expect(spellMidi(60, 0)).toEqual(P(0, 0, 4));
    expect(spellMidi(59, -6)).toEqual(P(0, -1, 4)); // C♭4 = MIDI 59
  });
});

describe('keyAlterations', () => {
  it('D major は F と C が ♯', () => {
    expect(keyAlterations(2)).toEqual([1, 0, 0, 1, 0, 0, 0]);
  });
  it('E♭ major は B E A が ♭', () => {
    expect(keyAlterations(-3)).toEqual([0, 0, -1, 0, 0, -1, -1]);
  });
});

describe('chooseOctaveShift', () => {
  it('in C のリードシート (C4〜C6) は Real Book と同じく 1 オクターブ下げる', () => {
    const concert = [60, 64, 67, 72, 76, 79, 84];
    expect(chooseOctaveShift(concert.map((m) => m + 14))).toBe(-1);
  });
  it('テナーの実音域のソロはそのまま', () => {
    const concert = [46, 50, 55, 58, 62, 65, 70];
    expect(chooseOctaveShift(concert.map((m) => m + 14))).toBe(0);
  });
});
