// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { estimateKey, extractMelody } from '../src/music/analysis';
import { allowedDuration, layoutMeasure, writeTenorMusicXml } from '../src/music/musicxml-write';
import { DetectedNote } from '../src/music/notes';
import { quantize, unswing } from '../src/music/quantize';

let id = 0;
const n = (start: number, duration: number, midi: number, amplitude = 0.8): DetectedNote => ({ id: id++, start, duration, midi, amplitude });

const base = { bpm: 120, downbeat: 0, beatsPerMeasure: 4, swing: 0.5, legato: false } as const;

describe('quantize', () => {
  it('少しずれた8分音符をグリッドに合わせる', () => {
    // 120bpm: 1拍 0.5秒、8分 0.25秒
    const q = quantize([n(0.02, 0.22, 60), n(0.26, 0.2, 62), n(0.49, 0.5, 64)], { ...base, subdivision: '8th' });
    expect(q.notes).toEqual([
      { start: 0, end: 6, midi: 60 },
      { start: 6, end: 12, midi: 62 },
      { start: 12, end: 24, midi: 64 },
    ]);
  });

  it('スウィングした裏拍 (2:1) を8分の裏として書く', () => {
    // 拍の 2/3 の位置 (0.333秒) にある裏拍
    const q = quantize([n(0, 0.32, 60), n(0.333, 0.16, 62), n(0.5, 0.3, 64)], { ...base, subdivision: '8th', swing: 0.66 });
    expect(q.notes.map((x) => x.start)).toEqual([0, 6, 12]);
  });

  it('8分+3連 モードで3連符を判定する', () => {
    const third = 0.5 / 3;
    const q = quantize([n(0, third, 60), n(third, third, 62), n(2 * third, third, 64), n(0.5, 0.25, 65), n(0.75, 0.25, 67)], {
      ...base,
      subdivision: '8th+triplet',
    });
    expect(q.notes.map((x) => x.start)).toEqual([0, 4, 8, 12, 18]);
  });

  it('同時に鳴った音は1つにし、重なりは切る (単旋律)', () => {
    const q = quantize([n(0, 1, 60, 0.3), n(0.01, 0.4, 72, 0.9), n(0.5, 0.5, 64)], { ...base, subdivision: '8th' });
    expect(q.notes).toEqual([
      { start: 0, end: 12, midi: 72 },
      { start: 12, end: 24, midi: 64 },
    ]);
  });

  it('アウフタクト (1拍目より前の音) があれば前に1小節足す', () => {
    const q = quantize([n(-0.5, 0.5, 60), n(0, 1, 62)], { ...base, subdivision: '8th' });
    expect(q.measureCount).toBe(2);
    expect(q.notes[0]).toEqual({ start: 36, end: 48, midi: 60 });
    expect(q.startTime).toBeCloseTo(-2);
  });

  it('unswing', () => {
    expect(unswing(0.66, 0.66)).toBeCloseTo(0.5);
    expect(unswing(0.33, 0.66)).toBeCloseTo(0.25);
  });
});

describe('layoutMeasure', () => {
  const seg = (start: number, end: number, midi: number | null) => ({ start, end, midi, tieStart: false, tieStop: false });

  it('シンコペーション (8分-4分-4分-4分-8分)', () => {
    const pieces = layoutMeasure([seg(0, 6, 74), seg(6, 18, 76), seg(18, 30, 77), seg(30, 42, 79), seg(42, 48, 81)], 48);
    expect(pieces.map((p) => p.type)).toEqual(['eighth', 'quarter', 'quarter', 'quarter', 'eighth']);
    expect(pieces.every((p) => !p.tieStart)).toBe(true);
  });

  it('拍をまたぐ16分はタイで分ける', () => {
    const pieces = layoutMeasure([seg(0, 9, 74), seg(9, 15, 76), seg(15, 48, null)], 48);
    expect(pieces.map((p) => [p.type, p.dots, p.tieStart])).toEqual([
      ['eighth', 1, false],
      ['16th', 0, true],
      ['16th', 0, false],
      ['eighth', 1, false], // 休符 (拍の残り)
      ['half', 0, false],
    ]);
  });

  it('3連符には time-modification とカッコを付ける', () => {
    const pieces = layoutMeasure([seg(0, 4, 74), seg(4, 8, 76), seg(8, 12, 77), seg(12, 48, null)], 48);
    expect(pieces.slice(0, 3).map((p) => [p.type, p.triplet, p.tuplet])).toEqual([
      ['eighth', true, 'start'],
      ['eighth', true, undefined],
      ['eighth', true, 'stop'],
    ]);
  });

  it('allowedDuration: 休符の付点4分は小節の真ん中をまたがない', () => {
    expect(allowedDuration(12, 18, true, 48)).toBe(false);
    expect(allowedDuration(12, 18, false, 48)).toBe(true);
  });
});

describe('writeTenorMusicXml', () => {
  it('実音 B♭3 (コンサート B♭) をテナー記譜 C5 で書く', () => {
    const xml = writeTenorMusicXml(
      { notes: [{ start: 0, end: 48, midi: 58 }], ticksPerMeasure: 48, measureCount: 1, startTime: 0 },
      { title: 'Test', bpm: 120, beatsPerMeasure: 4, writtenKeyFifths: 0, octaveShift: 0, swing: true, measuresPerSystem: 4 },
    );
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror').length).toBe(0);
    expect(doc.getElementsByTagName('step')[0].textContent).toBe('C');
    expect(doc.getElementsByTagName('octave')[0].textContent).toBe('5');
    expect(doc.getElementsByTagName('type')[0].textContent).toBe('whole');
    expect(xml).toContain('<words>Swing</words>');
  });
});

describe('analysis', () => {
  it('F のブルース風フレーズは F (♭1つ)', () => {
    const notes = [65, 69, 72, 70, 65, 67, 69, 60, 65, 72, 70, 69, 67, 65].map((m, i) => n(i * 0.25, 0.25, m));
    expect(estimateKey(notes)).toEqual({ fifths: -1, minor: false });
  });

  it('伴奏の和音からメロディ (大きく鳴っている音) を取り出す', () => {
    const notes = [n(0, 1, 48, 0.4), n(0, 1, 52, 0.4), n(0, 0.5, 70, 0.9), n(0.5, 0.5, 72, 0.9), n(0.5, 0.5, 55, 0.3)];
    const melody = extractMelody(notes, { minMidi: 40, maxMidi: 84 });
    expect(melody.map((x) => x.midi)).toEqual([70, 72]);
  });
});

