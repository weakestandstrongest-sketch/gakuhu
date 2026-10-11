import { DetectedNote } from './notes';
import { mod } from './pitch';

// 伴奏入りの音源から検出した音 (和音を含む) から、メロディ1本を取り出す。
export interface MelodyOptions {
  minMidi: number;
  maxMidi: number;
}

export function extractMelody(notes: DetectedNote[], opts: MelodyOptions): DetectedNote[] {
  const candidates = notes
    .filter((n) => n.midi >= opts.minMidi && n.midi <= opts.maxMidi && n.duration >= 0.04)
    .sort((a, b) => b.amplitude * Math.sqrt(b.duration) - a.amplitude * Math.sqrt(a.duration));

  const accepted: DetectedNote[] = [];
  for (const n of candidates) {
    const nEnd = n.start + n.duration;
    let overlap = 0;
    for (const a of accepted) {
      overlap += Math.max(0, Math.min(nEnd, a.start + a.duration) - Math.max(n.start, a.start));
    }
    if (overlap <= n.duration * 0.3) accepted.push(n);
  }

  accepted.sort((a, b) => a.start - b.start);
  const out = accepted.map((n) => ({ ...n }));
  for (let i = 0; i < out.length - 1; i++) {
    const end = out[i].start + out[i].duration;
    if (end > out[i + 1].start) out[i].duration = Math.max(0.02, out[i + 1].start - out[i].start);
  }
  return out;
}

// Krumhansl-Kessler の調性プロファイル
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export interface KeyEstimate {
  /** 調号の ♯(+)/♭(-) の数 (短調なら平行長調の調号) */
  fifths: number;
  minor: boolean;
}

/** 音高クラス (0=C) の長調の調号。F♯/G♭ は G♭ (ジャズで一般的) にする */
export function majorKeyFifths(tonicPc: number): number {
  return mod(7 * tonicPc + 6, 12) - 6;
}

export function estimateKey(notes: { midi: number; duration: number }[]): KeyEstimate {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[mod(Math.round(n.midi), 12)] += n.duration;
  let best: KeyEstimate = { fifths: 0, minor: false };
  let bestScore = -Infinity;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const minor of [false, true]) {
      const profile = minor ? MINOR : MAJOR;
      const rotated = hist.map((_, i) => profile[mod(i - tonic, 12)]);
      // 注意: ブルース (♭3・♭7 が多い長調) は短調と区別しにくい。UI で調を選び直せるようにしている
      const score = correlation(hist, rotated);
      if (score > bestScore) {
        bestScore = score;
        best = { fifths: majorKeyFifths(minor ? tonic + 3 : tonic), minor };
      }
    }
  }
  return best;
}
