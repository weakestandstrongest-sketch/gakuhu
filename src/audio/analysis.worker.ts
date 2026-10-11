/// <reference lib="webworker" />
import { estimateTempo } from './tempo';
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
      self.postMessage({ kind: 'done', tempo: estimateTempo(req.samples, req.sampleRate) });
    }
  } catch (err) {
    self.postMessage({ kind: 'error', message: String(err) });
  }
};
