import { DetectedNote, QuantizedNote, QuantizedScore, TICKS_PER_BEAT } from './notes';

// 検出した音 (秒) を拍のグリッドに合わせる。
// ジャズのスウィングした8分音符は「ふつうの8分音符」として書くのが慣習なので、
// 裏拍がスウィング比率の位置にあるものを8分の裏として扱う。

export type Subdivision = '8th' | '16th' | 'triplet' | '8th+triplet';

export interface QuantizeOptions {
  bpm: number;
  /** 1小節目の1拍目の時刻 (秒) */
  downbeat: number;
  beatsPerMeasure: number;
  subdivision: Subdivision;
  /** 0.5 = イーブン、0.67 = 3連のスウィング。8分の裏拍の位置 (拍に対する比率) */
  swing: number;
  /** 次の音までの短い隙間を埋めて読みやすくする */
  legato: boolean;
}

type Scheme = 'eighth' | 'sixteenth' | 'triplet';

const GRIDS: Record<Scheme, number[]> = {
  eighth: [0, 6, 12],
  sixteenth: [0, 3, 6, 9, 12],
  triplet: [0, 4, 8, 12],
};
const MIN_UNIT: Record<Scheme, number> = { eighth: 6, sixteenth: 3, triplet: 4 };

/** スウィングした拍内の位置を、イーブンの位置に戻す */
export function unswing(frac: number, swing: number): number {
  if (swing <= 0.5) return frac;
  return frac < swing ? (frac / swing) * 0.5 : 0.5 + ((frac - swing) / (1 - swing)) * 0.5;
}

function snapFrac(frac: number, scheme: Scheme, swing: number): { tick: number; error: number } {
  const f = scheme === 'triplet' ? frac : unswing(frac, swing);
  let best = 0;
  let err = Infinity;
  for (const g of GRIDS[scheme]) {
    const e = Math.abs(f - g / TICKS_PER_BEAT);
    if (e < err) {
      err = e;
      best = g;
    }
  }
  return { tick: best, error: err };
}

export function quantize(input: DetectedNote[], opts: QuantizeOptions): QuantizedScore {
  const tpm = opts.beatsPerMeasure * TICKS_PER_BEAT;
  const notes = input.filter((n) => !n.excluded).sort((a, b) => a.start - b.start);
  const secPerBeat = 60 / opts.bpm;
  const toBeats = (t: number) => (t - opts.downbeat) / secPerBeat;

  // 拍ごとに 8分系 / 3連系 のどちらで書くかを決める
  const defaultScheme: Scheme = opts.subdivision === '16th' ? 'sixteenth' : opts.subdivision === 'triplet' ? 'triplet' : 'eighth';
  const schemes = new Map<number, Scheme>();
  if (opts.subdivision === '8th+triplet') {
    const onsetsByBeat = new Map<number, number[]>();
    for (const n of notes) {
      const b = toBeats(n.start);
      const beat = Math.floor(b);
      const frac = b - beat;
      // 拍の頭すれすれの音は判定に使わない
      if (frac < 0.12 || frac > 0.88) continue;
      if (!onsetsByBeat.has(beat)) onsetsByBeat.set(beat, []);
      onsetsByBeat.get(beat)!.push(frac);
    }
    for (const [beat, fracs] of onsetsByBeat) {
      let errE = 0;
      let errT = 0;
      for (const f of fracs) {
        errE += snapFrac(f, 'eighth', opts.swing).error;
        errT += snapFrac(f, 'triplet', opts.swing).error;
      }
      // 3連は本当に3連らしいときだけ (8分のほうを優先)
      if (errT < errE * 0.5 && fracs.length >= 2) schemes.set(beat, 'triplet');
    }
  }
  const schemeOf = (beat: number): Scheme => schemes.get(beat) ?? defaultScheme;

  const snap = (t: number): { tick: number; scheme: Scheme } => {
    const b = toBeats(t);
    const beat = Math.floor(b);
    const scheme = schemeOf(beat);
    const { tick } = snapFrac(b - beat, scheme, opts.swing);
    return { tick: beat * TICKS_PER_BEAT + tick, scheme };
  };

  // 開始・終了をグリッドに合わせる
  const byStart = new Map<number, QuantizedNote & { weight: number }>();
  for (const n of notes) {
    const s = snap(n.start);
    let end = snap(n.start + n.duration).tick;
    if (end <= s.tick) end = s.tick + MIN_UNIT[s.scheme];
    const weight = n.amplitude * n.duration;
    const prev = byStart.get(s.tick);
    // 同じ位置に複数の音が来たら、強くて長いほうを残す
    if (!prev || prev.weight < weight) byStart.set(s.tick, { start: s.tick, end, midi: n.midi, weight });
  }
  const q = [...byStart.values()].sort((a, b) => a.start - b.start).map(({ start, end, midi }) => ({ start, end, midi }));

  // 単旋律にする (重なりを切る) + レガート補正
  for (let i = 0; i < q.length - 1; i++) {
    const next = q[i + 1].start;
    if (q[i].end > next) q[i].end = next;
    if (opts.legato && next - q[i].end > 0 && next - q[i].end <= 6) q[i].end = next;
  }
  if (q.length === 0) {
    return { notes: [], ticksPerMeasure: tpm, measureCount: 1, startTime: opts.downbeat };
  }
  const firstMeasure = Math.floor(q[0].start / tpm);
  const lastTick = Math.max(...q.map((n) => n.end));
  const measureCount = Math.max(1, Math.ceil(lastTick / tpm) - firstMeasure);
  const offset = firstMeasure * tpm;
  return {
    notes: q.map((n) => ({ start: n.start - offset, end: n.end - offset, midi: n.midi })),
    ticksPerMeasure: tpm,
    measureCount,
    startTime: opts.downbeat + firstMeasure * opts.beatsPerMeasure * secPerBeat,
  };
}
