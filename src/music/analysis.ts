import { DetectedNote } from './notes';
import { mod } from './pitch';

/** 一定間隔ごとの音の高さ (CREPE などの結果) */
export interface PitchContour {
  /** midi[0] の時刻 (秒) */
  startTime: number;
  hopSeconds: number;
  /** MIDI ノート番号 (小数) */
  midi: Float32Array;
  /** 0..1 */
  confidence: Float32Array;
}

const CONFIDENT = 0.5;

/** 音の真ん中あたり (前後20%を除く) の、確かな高さのフレームを集める */
function framesOf(note: DetectedNote, contour: PitchContour): number[] {
  const from = note.start + note.duration * 0.2;
  const to = note.start + note.duration * 0.8;
  const out: number[] = [];
  const i0 = Math.max(0, Math.floor((from - contour.startTime) / contour.hopSeconds));
  const i1 = Math.min(contour.midi.length - 1, Math.ceil((to - contour.startTime) / contour.hopSeconds));
  for (let i = i0; i <= i1; i++) if (contour.confidence[i] >= CONFIDENT) out.push(contour.midi[i]);
  return out;
}

function totalFrames(note: DetectedNote, contour: PitchContour): number {
  return Math.max(1, Math.round((note.duration * 0.6) / contour.hopSeconds) + 1);
}

/** その音が、ピッチ解析の結果とどれくらい一致しているか (0..1) */
export function contourAgreement(note: DetectedNote, contour: PitchContour): number {
  const frames = framesOf(note, contour);
  if (frames.length === 0) return 0;
  const hit = frames.filter((m) => Math.abs(m - note.midi) < 0.6).length;
  return hit / totalFrames(note, contour);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * ピッチ解析 (CREPE) の結果を使って、音の高さの間違いを直す。
 * - オクターブ違い (倍音を拾った等) は、確かなら直す
 * - 半音ずれは、とても確かなときだけ直す
 */
export function refineWithContour(notes: DetectedNote[], contour: PitchContour, range?: MelodyRange): DetectedNote[] {
  return notes.map((note) => {
    const frames = framesOf(note, contour);
    if (frames.length < 2 || frames.length < totalFrames(note, contour) * 0.4) return note;
    const m = median(frames);
    const r = Math.round(m);
    // 高さが揺れている (しゃくり・グリッサンド等) 音には手を出さない
    const stable = frames.filter((f) => Math.abs(f - m) < 0.5).length / frames.length;
    if (Math.abs(m - r) > 0.35 || stable < 0.7) return note;
    if (range && (r < range.minMidi - 2 || r > range.maxMidi + 2)) return note;
    const d = r - note.midi;
    if (d !== 0 && (Math.abs(d) === 12 || Math.abs(d) === 24 || (Math.abs(d) === 1 && stable > 0.9))) {
      return { ...note, midi: r };
    }
    return note;
  });
}

export interface MelodyRange {
  minMidi: number;
  maxMidi: number;
}

export interface MelodyOptions extends MelodyRange {
  /** あればピッチ解析と一致する音を優先する */
  contour?: PitchContour | null;
}

/**
 * 伴奏入りの音源から検出した音 (和音を含む) から、メロディ1本を取り出す。
 * サックスのように「1度に1音・なめらかにつながる線」になるよう、動的計画法で
 * 「強く長く鳴っている音」を多く通り、不自然な大跳躍が少ない並びを選ぶ。
 */
export function extractMelody(notes: DetectedNote[], opts: MelodyOptions): DetectedNote[] {
  const cands = notes
    .filter((n) => n.midi >= opts.minMidi && n.midi <= opts.maxMidi && n.duration >= 0.04)
    .sort((a, b) => a.start - b.start);
  const n = cands.length;
  if (n === 0) return [];

  const weight = cands.map((c) => {
    const agree = opts.contour ? contourAgreement(c, opts.contour) : 0;
    return c.amplitude * Math.pow(c.duration, 0.8) * (1 + 1.5 * agree);
  });
  const typical = [...weight].sort((a, b) => a - b)[Math.floor(n / 2)];
  const end = (c: DetectedNote) => c.start + c.duration;
  // j の後に i を続けられるか (少しの重なりは許す)
  const canFollow = (j: number, i: number) =>
    cands[j].start < cands[i].start && end(cands[j]) - cands[i].start <= 0.3 * Math.min(cands[i].duration, cands[j].duration);
  const leapCost = (j: number, i: number) => {
    const gap = cands[i].start - end(cands[j]);
    if (gap > 1) return 0; // 休符をはさめば跳躍は自然
    const leap = Math.abs(cands[i].midi - cands[j].midi);
    return typical * 0.6 * Math.max(0, leap - 5) / 7;
  };

  const best = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const WINDOW = 4; // 秒。これより前の音とは跳躍の罰則なしでつなぐ
  let far = 0; // cands[far] より前は「十分前の音」
  let farBest = -Infinity;
  let farArg = -1;
  for (let i = 0; i < n; i++) {
    while (far < i && cands[far].start <= cands[i].start - WINDOW) {
      if (end(cands[far]) <= cands[i].start && best[far] > farBest) {
        farBest = best[far];
        farArg = far;
      }
      far++;
    }
    let prev = farBest;
    let arg = farArg;
    for (let j = far; j < i; j++) {
      if (!canFollow(j, i)) continue;
      const v = best[j] - leapCost(j, i);
      if (v > prev) {
        prev = v;
        arg = j;
      }
    }
    best[i] = weight[i] + Math.max(0, prev);
    back[i] = prev > 0 ? arg : -1;
  }

  let last = 0;
  for (let i = 1; i < n; i++) if (best[i] > best[last]) last = i;
  const chosen: DetectedNote[] = [];
  for (let i = last; i >= 0; i = back[i]) chosen.push({ ...cands[i] });
  chosen.reverse();
  for (let i = 0; i < chosen.length - 1; i++) {
    const e = chosen[i].start + chosen[i].duration;
    if (e > chosen[i + 1].start) chosen[i].duration = Math.max(0.02, chosen[i + 1].start - chosen[i].start);
  }
  return chosen;
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
