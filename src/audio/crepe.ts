import type * as TF from '@tensorflow/tfjs';
import { PitchContour } from '../music/analysis';
import { frequencyToMidi } from '../music/pitch';

// 音の高さ専門の AI「CREPE」(tiny 版, 約2MB, MIT ライセンス)。
// 1つの音の高さを細かく正確に測るのが得意なので、
// Basic Pitch や YIN で拾った音の高さ (特にオクターブ) の確認に使う。

export const CREPE_SAMPLE_RATE = 16000;
const FRAME = 1024;
const BINS = 360;

let loading: Promise<{ tf: typeof TF; model: TF.LayersModel }> | null = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const tf = await import('@tensorflow/tfjs');
      await tf.ready();
      const model = await tf.loadLayersModel(new URL('models/crepe/model.json', document.baseURI).href);
      return { tf, model };
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** 360 個の出力 (20 cent 刻み) の山の位置から、なめらかな高さ (MIDI 小数) を求める */
export function binsToMidi(act: ArrayLike<number>, offset = 0): { midi: number; confidence: number } {
  let arg = 0;
  for (let i = 1; i < BINS; i++) if (act[offset + i] > act[offset + arg]) arg = i;
  let sum = 0;
  let weighted = 0;
  for (let i = Math.max(0, arg - 4); i <= Math.min(BINS - 1, arg + 4); i++) {
    const a = act[offset + i];
    sum += a;
    weighted += a * (1997.3794084376191 + 20 * i);
  }
  const cents = weighted / sum;
  return { midi: frequencyToMidi(10 * Math.pow(2, cents / 1200)), confidence: act[offset + arg] };
}

/**
 * 16kHz モノラルの音声から、一定間隔ごとの高さと確からしさを求める。
 * @param startTime samples[0] の時刻 (秒)
 */
export async function crepePitch(
  samples: Float32Array,
  startTime: number,
  onProgress?: (p: number) => void,
  hopSeconds = 0.02,
): Promise<PitchContour> {
  const { tf, model } = await load();
  const hop = Math.round(hopSeconds * CREPE_SAMPLE_RATE);
  const n = Math.max(1, Math.floor(samples.length / hop) + 1);
  const midi = new Float32Array(n);
  const confidence = new Float32Array(n);
  const batchSize = 128;
  for (let first = 0; first < n; first += batchSize) {
    const count = Math.min(batchSize, n - first);
    const batch = new Float32Array(count * FRAME);
    const silent = new Uint8Array(count);
    for (let k = 0; k < count; k++) {
      // 各フレームを平均0・標準偏差1に正規化 (CREPE の前処理)
      const from = (first + k) * hop - FRAME / 2;
      let mean = 0;
      for (let i = 0; i < FRAME; i++) mean += samples[from + i] ?? 0;
      mean /= FRAME;
      let sd = 0;
      for (let i = 0; i < FRAME; i++) sd += ((samples[from + i] ?? 0) - mean) ** 2;
      sd = Math.sqrt(sd / FRAME);
      if (sd < 1e-4) {
        silent[k] = 1;
        continue;
      }
      for (let i = 0; i < FRAME; i++) batch[k * FRAME + i] = ((samples[from + i] ?? 0) - mean) / sd;
    }
    const input = tf.tensor2d(batch, [count, FRAME]);
    const output = model.predict(input) as TF.Tensor;
    const act = await output.data();
    input.dispose();
    output.dispose();
    for (let k = 0; k < count; k++) {
      const r = binsToMidi(act, k * BINS);
      midi[first + k] = r.midi;
      confidence[first + k] = silent[k] ? 0 : r.confidence;
    }
    onProgress?.(Math.min(1, (first + count) / n));
  }
  return { startTime, hopSeconds, midi, confidence };
}
