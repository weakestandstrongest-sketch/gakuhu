import { describe, expect, it } from 'vitest';
import { binsToMidi } from '../src/audio/crepe';
import { PitchContour, extractMelody, refineWithContour } from '../src/music/analysis';
import { DetectedNote } from '../src/music/notes';

let id = 0;
const n = (start: number, duration: number, midi: number, amplitude = 0.8): DetectedNote => ({ id: id++, start, duration, midi, amplitude });

/** 指定した区間ごとに一定の高さを返すピッチ解析結果 */
function contour(segments: [number, number, number][], total = 4, hop = 0.02): PitchContour {
  const len = Math.round(total / hop);
  const midi = new Float32Array(len);
  const confidence = new Float32Array(len);
  for (const [s, e, m] of segments) {
    for (let i = Math.round(s / hop); i < Math.round(e / hop); i++) {
      midi[i] = m + 0.05;
      confidence[i] = 0.9;
    }
  }
  return { startTime: 0, hopSeconds: hop, midi, confidence };
}

describe('extractMelody (1本の線としてメロディを選ぶ)', () => {
  it('一瞬だけ大きいピアノの高音より、なめらかにつながるサックスの線を選ぶ', () => {
    const sax = [n(0, 0.25, 62), n(0.25, 0.25, 64), n(0.5, 0.25, 65), n(0.75, 0.25, 67), n(1, 0.25, 69)];
    const piano = n(0.5, 0.25, 84, 0.95); // 2オクターブ近く上で、少しだけ大きい
    const melody = extractMelody([...sax, piano], { minMidi: 40, maxMidi: 90 });
    expect(melody.map((x) => x.midi)).toEqual([62, 64, 65, 67, 69]);
  });

  it('ピッチ解析と一致する音を優先する', () => {
    const a = n(0, 0.5, 60, 0.6); // 伴奏 (少し大きい)
    const b = n(0, 0.5, 64, 0.5); // サックス
    const c = contour([[0, 0.5, 64]]);
    expect(extractMelody([a, b], { minMidi: 40, maxMidi: 90 }).map((x) => x.midi)).toEqual([60]);
    expect(extractMelody([a, b], { minMidi: 40, maxMidi: 90, contour: c }).map((x) => x.midi)).toEqual([64]);
  });
});

describe('refineWithContour', () => {
  it('オクターブ違いを直し、合っている音・揺れている音はそのまま', () => {
    const notes = [n(0, 0.5, 74), n(0.5, 0.5, 62), n(1, 0.5, 65)];
    const c = contour([
      [0, 0.5, 62], // 1オクターブ下が正しい
      [0.5, 1, 62], // 合っている
    ]);
    // 3つ目は解析結果なし (確かでない) → 変えない
    expect(refineWithContour(notes, c).map((x) => x.midi)).toEqual([62, 62, 65]);
  });

  it('関係ない高さ (他の楽器) なら変えない', () => {
    const c = contour([[0, 0.5, 55]]);
    expect(refineWithContour([n(0, 0.5, 62)], c)[0].midi).toBe(62);
  });
});

describe('binsToMidi (CREPE の出力の読み方)', () => {
  it('A4 (440Hz) の位置に山があれば MIDI 69', () => {
    // cents = 1997.38 + 20*i, A4 = 1200*log2(440/10) ≈ 6551.3 cents → i ≈ 227.7
    const act = new Float32Array(360);
    act[227] = 0.6;
    act[228] = 0.9;
    act[229] = 0.3;
    const r = binsToMidi(act);
    expect(r.midi).toBeCloseTo(69, 0);
    expect(r.confidence).toBeCloseTo(0.9);
  });
});
