// テンポの揺れに追従する拍の検出 (Ellis 2007 の動的計画法によるビートトラッキング)。
// 「だいたいのテンポ」を手がかりに、音の立ち上がりが強い位置を通るように
// 1拍ずつ拍の時刻を決める。間隔はテンポから大きく外れないよう罰則をかける。

/**
 * @param env 音の立ち上がりの強さ (フレームごと)
 * @param fps 1秒あたりのフレーム数
 * @param bpm だいたいのテンポ
 * @param tightness 大きいほどテンポを一定に保とうとする
 * @returns 拍のフレーム位置 (昇順)
 */
export function trackBeats(env: Float32Array, fps: number, bpm: number, tightness = 120): number[] {
  const n = env.length;
  const period = (60 * fps) / bpm;
  if (n < period * 2) return [];

  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  let sd = 0;
  for (const v of env) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / n);
  if (sd === 0) {
    // 立ち上がりが全く無い: 等間隔
    const out: number[] = [];
    for (let t = 0; t < n; t += period) out.push(t);
    return out;
  }

  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const local = env[t] / sd;
    const lo = Math.max(0, Math.round(t - 2 * period));
    const hi = Math.round(t - period / 2);
    let best = -Infinity;
    let arg = -1;
    for (let p = lo; p <= hi; p++) {
      const v = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (v > best) {
        best = v;
        arg = p;
      }
    }
    if (arg >= 0 && best > 0) {
      score[t] = local + best;
      back[t] = arg;
    } else {
      score[t] = local;
    }
  }

  // 最後の1拍ぶんの中で最もスコアが高い位置から逆にたどる
  let end = n - 1;
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

/** 時刻 (秒) ⇔ 拍の位置 (小数) の変換。拍と拍の間は直線で補間し、端は外挿する */
export class BeatMap {
  readonly times: number[];

  constructor(times: number[]) {
    if (times.length < 2) throw new Error('拍が2つ以上必要です');
    this.times = times;
  }

  static uniform(bpm: number, origin: number): BeatMap {
    const spb = 60 / bpm;
    return new BeatMap([origin, origin + spb]);
  }

  /** 平均テンポ */
  get bpm(): number {
    const t = this.times;
    return (60 * (t.length - 1)) / (t[t.length - 1] - t[0]);
  }

  toBeats(time: number): number {
    const t = this.times;
    const last = t.length - 1;
    if (time <= t[0]) return (time - t[0]) / (t[1] - t[0]);
    if (time >= t[last]) return last + (time - t[last]) / (t[last] - t[last - 1]);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= time) lo = mid;
      else hi = mid;
    }
    return lo + (time - t[lo]) / (t[lo + 1] - t[lo]);
  }

  toTime(beat: number): number {
    const t = this.times;
    const last = t.length - 1;
    if (beat <= 0) return t[0] + beat * (t[1] - t[0]);
    if (beat >= last) return t[last] + (beat - last) * (t[last] - t[last - 1]);
    const i = Math.floor(beat);
    return t[i] + (beat - i) * (t[i + 1] - t[i]);
  }
}
