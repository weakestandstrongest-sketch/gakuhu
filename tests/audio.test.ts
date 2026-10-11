import { describe, expect, it } from 'vitest';
import { estimateTempo } from '../src/audio/tempo';
import { segmentNotes, trackPitch } from '../src/audio/yin';
import { midiToFrequency } from '../src/music/pitch';

const SR = 22050;

/** サックスっぽい倍音を持つ音を並べた合成音 */
function synth(notes: { midi: number; start: number; dur: number }[], total: number): Float32Array {
  const out = new Float32Array(Math.ceil(total * SR));
  for (const n of notes) {
    const f = midiToFrequency(n.midi);
    const s0 = Math.floor(n.start * SR);
    const len = Math.floor(n.dur * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const env = Math.min(1, i / 200) * Math.min(1, (len - i) / 400);
      let v = 0;
      for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
      out[s0 + i] += 0.3 * env * v;
    }
  }
  return out;
}

describe('YIN による単音の検出', () => {
  it('B♭3 C4 D4 E♭4 D4 D4 (同じ音の連続も分ける)', () => {
    const seq = [58, 60, 62, 63, 62, 62];
    const notes = seq.map((midi, i) => ({ midi, start: 0.2 + i * 0.25, dur: 0.22 }));
    const audio = synth(notes, 2);
    const detected = segmentNotes(trackPitch(audio, SR, { minFreq: 90, maxFreq: 1000 }));
    expect(detected.map((d) => d.midi)).toEqual(seq);
    detected.forEach((d, i) => expect(Math.abs(d.start - notes[i].start)).toBeLessThan(0.04));
  });
});

describe('テンポ推定', () => {
  it('150 BPM のクリック', () => {
    const beat = 60 / 150;
    const clicks = Array.from({ length: 24 }, (_, i) => ({ midi: 84, start: 0.3 + i * beat, dur: 0.05 }));
    const est = estimateTempo(synth(clicks, 10.5), SR)!;
    expect(est.bpm).toBeGreaterThan(147);
    expect(est.bpm).toBeLessThan(153);
    // 拍の位置 (0.3秒 + n拍) と合っているか
    const phase = ((est.firstBeat - 0.3) / beat) % 1;
    expect(Math.min(Math.abs(phase), 1 - Math.abs(phase))).toBeLessThan(0.1);
  });
});
