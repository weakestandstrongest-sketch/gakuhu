/// <reference lib="webworker" />
import { estimateTempoFromOnset, onsetEnvelope } from './tempo';
import { segmentNotes, trackPitch } from './yin';

// 重い解析 (YIN・テンポ推定) を画面が固まらないよう別スレッドで動かす

export type WorkerRequest =
  | { kind: 'yin'; samples: Float32Array; sampleRate: number; minFreq: number; maxFreq: number; sensitivity: number }
  | { kind: 'tempo'; samples: Float32Array; sampleRate: number };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'yin') {
      const track = trackPitch(
        req.samples,
        req.sampleRate,
        { minFreq: req.minFreq, maxFreq: req.maxFreq, threshold: 0.1 + 0.12 * req.sensitivity },
        (p) => self.postMessage({ kind: 'progress', progress: p }),
      );
      const notes = segmentNotes(track, { silenceDb: -25 - 25 * req.sensitivity });
      self.postMessage({ kind: 'done', notes });
    } else {
      // テンポの推定に加えて、拍を1つずつ追いかけるための「音の立ち上がりの強さ」も返す
      const onset = onsetEnvelope(req.samples, req.sampleRate);
      self.postMessage({ kind: 'done', tempo: estimateTempoFromOnset(onset), onset });
    }
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err) });
  }
};
