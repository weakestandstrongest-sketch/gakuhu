import { DetectedNote } from '../music/notes';
import { frequencyToMidi } from '../music/pitch';

// 単音 (ソロ楽器だけ) の音源用の音程検出。YIN アルゴリズム。
// 伴奏が無い・小さい録音なら AI モデルより速くて安定する。

export interface PitchTrack {
  hopSeconds: number;
  /** フレーム番号 × hopSeconds に足すと、その音が実際に鳴っている時刻になる (窓の中心) */
  offsetSeconds: number;
  /** 各フレームの MIDI ノート (小数)。無声なら NaN */
  midi: Float32Array;
  rms: Float32Array;
}

export function trackPitch(
  samples: Float32Array,
  sampleRate: number,
  opts: { minFreq: number; maxFreq: number; hop?: number; threshold?: number },
  onProgress?: (p: number) => void,
): PitchTrack {
  const hop = opts.hop ?? 256;
  const threshold = opts.threshold ?? 0.15;
  const tauMin = Math.max(2, Math.floor(sampleRate / opts.maxFreq));
  const tauMax = Math.ceil(sampleRate / opts.minFreq);
  const W = Math.max(1024, tauMax + 2);
  const frames = Math.max(0, Math.floor((samples.length - W - tauMax) / hop));
  const midi = new Float32Array(frames).fill(NaN);
  const rms = new Float32Array(frames);
  const d = new Float32Array(tauMax + 1);

  for (let f = 0; f < frames; f++) {
    if (onProgress && f % 200 === 0) onProgress(f / frames);
    const off = f * hop;
    let energy = 0;
    for (let j = 0; j < W; j++) energy += samples[off + j] ** 2;
    rms[f] = Math.sqrt(energy / W);
    if (rms[f] < 1e-4) continue;

    // 差分関数と累積平均正規化
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < W; j++) {
        const diff = samples[off + j] - samples[off + j + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running === 0 ? 1 : (sum * tau) / running;
    }

    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 < tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) continue;
    // 放物線補間
    const a = d[tau - 1];
    const b = d[tau];
    const c = d[tau + 1] ?? b;
    const denom = a - 2 * b + c;
    const refined = denom === 0 ? tau : tau + (a - c) / (2 * denom);
    midi[f] = frequencyToMidi(sampleRate / refined);
  }
  onProgress?.(1);
  return { hopSeconds: hop / sampleRate, offsetSeconds: W / 2 / sampleRate, midi, rms };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** 音程の時系列を音符に区切る */
export function segmentNotes(track: PitchTrack, opts: { minNoteSeconds?: number; silenceDb?: number } = {}): DetectedNote[] {
  const { midi, rms, hopSeconds, offsetSeconds } = track;
  const n = midi.length;
  let maxRms = 0;
  for (let i = 0; i < n; i++) maxRms = Math.max(maxRms, rms[i]);
  if (maxRms === 0) return [];
  const gate = maxRms * Math.pow(10, (opts.silenceDb ?? -35) / 20);
  const minFrames = Math.max(2, Math.round((opts.minNoteSeconds ?? 0.06) / hopSeconds));

  // 小さい音を無声にし、5フレームのメディアンで細かい揺れを均す
  const rounded = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(midi[i]) || rms[i] < gate) continue;
    const win: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (!Number.isNaN(midi[j]) && rms[j] >= gate) win.push(midi[j]);
    rounded[i] = Math.round(median(win));
  }

  // 同じ音程が続く区間 (run) にまとめる
  type Run = { start: number; end: number; midi: number };
  let runs: Run[] = [];
  for (let i = 0; i < n; i++) {
    if (rounded[i] < 0) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === i && last.midi === rounded[i]) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, midi: rounded[i] });
  }
  // 短すぎる run (しゃくり・ノイズ) は隣に吸収するか捨てる
  const merged: Run[] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (r.end - r.start < minFrames) {
      if (prev && prev.end === r.start) prev.end = r.end;
      continue;
    }
    if (prev && prev.end >= r.start - 1 && prev.midi === r.midi) prev.end = r.end;
    else merged.push({ ...r });
  }
  runs = merged;

  // 同じ音の連続 (タンギング) を音量の谷で分ける
  const notes: DetectedNote[] = [];
  let id = 0;
  for (const r of runs) {
    let segStart = r.start;
    let peak = 0;
    let valley = Infinity;
    let valleyAt = -1;
    for (let i = r.start; i < r.end; i++) {
      const v = rms[i];
      if (valleyAt >= 0 && v > valley * 1.6 && valley < peak * 0.5 && valleyAt - segStart >= minFrames) {
        notes.push(makeNote(id++, segStart, valleyAt, r.midi, rms, hopSeconds, offsetSeconds, maxRms));
        segStart = valleyAt;
        peak = v;
        valley = Infinity;
        valleyAt = -1;
        continue;
      }
      if (v > peak) {
        peak = v;
        valley = Infinity;
        valleyAt = -1;
      } else if (v < valley) {
        valley = v;
        valleyAt = i;
      }
    }
    notes.push(makeNote(id++, segStart, r.end, r.midi, rms, hopSeconds, offsetSeconds, maxRms));
  }
  return notes;
}

function makeNote(
  id: number,
  start: number,
  end: number,
  midi: number,
  rms: Float32Array,
  hop: number,
  offset: number,
  maxRms: number,
): DetectedNote {
  let sum = 0;
  for (let i = start; i < end; i++) sum += rms[i];
  return { id, start: start * hop + offset, duration: (end - start) * hop, midi, amplitude: sum / Math.max(1, end - start) / maxRms };
}
