import { describe, expect, it } from 'vitest';
import { isChordLine, transposeChord, transposeChordText } from '../src/music/chords';
import { MAJOR_SECOND } from '../src/music/pitch';

describe('transposeChord (in C → テナー: 長2度上)', () => {
  const cases: [string, string][] = [
    ['C', 'D'],
    ['Bb7', 'C7'],
    ['Ebmaj7', 'Fmaj7'],
    ['F#m7b5', 'G#m7b5'],
    ['Db7(#11)', 'Eb7(#11)'],
    ['A7/C#', 'B7/D#'],
    ['C6/9', 'D6/9'],
    ['G-7', 'A-7'],
    ['B♭7', 'C7'],
    ['E♭m7', 'Fm7'],
    ['A#7', 'C7'], // B# は読みにくいので C に
    ['Gb', 'Ab'],
  ];
  for (const [src, expected] of cases) {
    it(`${src} → ${expected}`, () => expect(transposeChord(src, MAJOR_SECOND)).toBe(expected));
  }
  it('コードでないものは null', () => {
    expect(transposeChord('Take', MAJOR_SECOND)).toBeNull();
    expect(transposeChord('N.C.', MAJOR_SECOND)).toBeNull();
  });
});

describe('transposeChordText', () => {
  it('コード行だけを移調し、タイトルや歌詞はそのまま', () => {
    const src = ['Take the A Train', '| Cmaj7 | % | D7#11 | % |', '| Dm7 G7 | Cmaj7 (Am7) :|'].join('\n');
    const out = transposeChordText(src, MAJOR_SECOND);
    expect(out.split('\n')).toEqual(['Take the A Train', '| Dmaj7 | % | E7#11 | % |', '| Em7 A7 | Dmaj7 (Bm7) :|']);
  });
  it('isChordLine', () => {
    expect(isChordLine('Bb7 Eb7 Bb7 F7')).toBe(true);
    expect(isChordLine('A foggy day in London town')).toBe(false);
  });
});

describe('英単語をコードと誤認しない', () => {
  it('Blues in F の行はそのまま', () => {
    expect(transposeChordText('Blues in F', MAJOR_SECOND)).toBe('Blues in F');
    expect(transposeChord('Blues', MAJOR_SECOND)).toBeNull();
    expect(transposeChord('Bad', MAJOR_SECOND)).toBeNull();
  });
  it('いろいろなコード表記', () => {
    expect(transposeChord('Cmaj7(#11)', MAJOR_SECOND)).toBe('Dmaj7(#11)');
    expect(transposeChord('Bbm7b5', MAJOR_SECOND)).toBe('Cm7b5');
    expect(transposeChord('Ebø7', MAJOR_SECOND)).toBe('Fø7');
    expect(transposeChord('G7alt', MAJOR_SECOND)).toBe('A7alt');
    expect(transposeChord('Csus4', MAJOR_SECOND)).toBe('Dsus4');
  });
});
