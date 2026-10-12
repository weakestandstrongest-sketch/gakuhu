import { describe, expect, it } from 'vitest';
import { onsetEnvelope } from '../src/audio/tempo';
import { BeatMap, trackBeats } from '../src/music/beats';
import { DetectedNote } from '../src/music/notes';
import { quantize } from '../src/music/quantize';

const SR = 22050;

function clicks(times: number[], total: number): Float32Array {
  const out = new Float32Array(Math.ceil(total * SR));
  for (const t of times) {
    const s0 = Math.floor(t * SR);
    for (let i = 0; i < 1500 && s0 + i < out.length; i++) {
      out[s0 + i] += 0.5 * Math.exp(-i / 200) * Math.sin((2 * Math.PI * 1200 * i) / SR);
    }
  }
  return out;
}

/** 120 BPM から 140 BPM へだんだん速くなる拍 */
function accelerandoBeats(count: number): number[] {
  const times = [0.5];
  for (let i = 1; i < count; i++) {
    const bpm = 120 + (20 * i) / count;
    times.push(times[i - 1] + 60 / bpm);
  }
  return times;
}

describe('trackBeats (テンポの揺れに追従)', () => {
  it('だんだん速くなる演奏でも拍を外さない', () => {
    const truth = accelerandoBeats(40);
    const { env, fps, offsetSeconds } = onsetEnvelope(clicks(truth, truth[truth.length - 1] + 1), SR);
    const beats = trackBeats(env, fps, 130).map((f) => f / fps + offsetSeconds);
    // 内側の拍がすべて 35ms 以内で見つかる
    for (const t of truth.slice(2, -2)) {
      const nearest = Math.min(...beats.map((b) => Math.abs(b - t)));
      expect(nearest).toBeLessThan(0.035);
    }
  });
});

describe('BeatMap', () => {
  const map = new BeatMap([1, 1.5, 2.1, 2.8]);
  it('拍の間を補間・端を外挿する', () => {
    expect(map.toBeats(1.25)).toBeCloseTo(0.5);
    expect(map.toBeats(2.45)).toBeCloseTo(2.5);
    expect(map.toBeats(0.5)).toBeCloseTo(-1);
    expect(map.toBeats(3.5)).toBeCloseTo(4);
    expect(map.toTime(map.toBeats(2.3))).toBeCloseTo(2.3);
  });
});

describe('quantize + BeatMap', () => {
  it('テンポが揺れても音を正しい拍に置ける', () => {
    const truth = accelerandoBeats(16);
    const notes: DetectedNote[] = truth.map((t, i) => ({ id: i, start: t + 0.01, duration: 0.3, midi: 60 + (i % 5), amplitude: 0.8 }));
    const beats = new BeatMap(truth);
    const withMap = quantize(notes, { bpm: 130, downbeat: truth[0], beatsPerMeasure: 4, subdivision: '8th', swing: 0.5, legato: true, beats });
    expect(withMap.notes.map((n) => n.start)).toEqual(truth.map((_, i) => i * 12));
    // 一定テンポ (平均) だと後半がずれる
    const flat = quantize(notes, { bpm: beats.bpm, downbeat: truth[0], beatsPerMeasure: 4, subdivision: '8th', swing: 0.5, legato: true });
    expect(flat.notes.map((n) => n.start)).not.toEqual(truth.map((_, i) => i * 12));
  });
});
