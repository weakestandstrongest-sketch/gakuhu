// テンポ (BPM) と拍の位置の推定。スペクトルフラックス (音の立ち上がりの強さ) の自己相関を使う。
// ジャズはテンポの倍/半分を取り違えやすいので、UI 側で ×2 / ÷2 を選べるようにしている。

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/**
 * 音の立ち上がりの強さの時系列。
 * offsetSeconds: フレーム番号/fps に足すと実際の立ち上がり時刻になる補正 (窓の位置ぶん)
 */
export function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  hop = 256,
  size = 1024,
): { env: Float32Array; fps: number; offsetSeconds: number } {
  const frames = Math.max(0, Math.floor((samples.length - size) / hop));
  const env = new Float32Array(frames);
  const window = new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  let prev = new Float32Array(size / 2);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = samples[f * hop + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    let flux = 0;
    for (let k = 1; k < size / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      flux += Math.max(0, mag[k] - prev[k]);
    }
    env[f] = flux;
    prev = mag;
  }
  // 平均を引いて正の部分だけ残す
  const mean = env.reduce((s, x) => s + x, 0) / Math.max(1, env.length);
  for (let i = 0; i < env.length; i++) env[i] = Math.max(0, env[i] - mean);
  return { env, fps: sampleRate / hop, offsetSeconds: (0.75 * size) / sampleRate };
}

export interface TempoEstimate {
  bpm: number;
  /** 最初の拍の時刻 (秒、解析した音声の先頭から) */
  firstBeat: number;
}

export type OnsetEnvelope = ReturnType<typeof onsetEnvelope>;

export function estimateTempo(samples: Float32Array, sampleRate: number, minBpm = 60, maxBpm = 300): TempoEstimate | null {
  return estimateTempoFromOnset(onsetEnvelope(samples, sampleRate), minBpm, maxBpm);
}

export function estimateTempoFromOnset(onset: OnsetEnvelope, minBpm = 60, maxBpm = 300): TempoEstimate | null {
  const { env, fps, offsetSeconds } = onset;
  if (env.length < fps * 3) return null;
  const minLag = Math.floor((60 / maxBpm) * fps);
  const maxLag = Math.ceil((60 / minBpm) * fps);
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < env.length; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < env.length; i++) sum += env[i] * env[i + lag];
    sum /= env.length - lag;
    // 120 BPM 付近を少し優先する (倍・半分の取り違えを減らす)
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 140) / 1.0, 2));
    const score = sum * prior;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return null;
  // 放物線補間で小数のラグに
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < env.length; i++) s += env[i] * env[i + lag];
    return s / (env.length - lag);
  };
  const y0 = ac(bestLag - 1);
  const y1 = ac(bestLag);
  const y2 = ac(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const lag = denom === 0 ? bestLag : bestLag + (y0 - y2) / (2 * denom);
  const bpm = (60 * fps) / lag;

  // 拍の位相: 拍の位置での立ち上がりの合計が最大になるずれを探す
  let bestPhase = 0;
  let bestPhaseScore = -Infinity;
  for (let phase = 0; phase < lag; phase += 0.5) {
    let s = 0;
    for (let t = phase; t < env.length; t += lag) s += env[Math.round(t)] ?? 0;
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      bestPhase = phase;
    }
  }
  return { bpm, firstBeat: bestPhase / fps + offsetSeconds };
}
