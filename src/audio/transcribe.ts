import { DetectedNote } from '../music/notes';
import { midiToFrequency } from '../music/pitch';
import type { TempoEstimate } from './tempo';
import type { WorkerRequest } from './analysis.worker';

export const ANALYSIS_SAMPLE_RATE = 22050;

function runWorker<T>(req: WorkerRequest, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.kind === 'progress') onProgress?.(msg.progress);
      else {
        worker.terminate();
        if (msg.kind === 'error') reject(new Error(msg.message));
        else resolve(msg as T);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(req);
  });
}

export interface RangeOptions {
  minMidi: number;
  maxMidi: number;
  /** 0..1 大きいほど小さな音も拾う */
  sensitivity: number;
}

/** 単音 (ソロ楽器だけ) の音源を YIN で解析 */
export async function transcribeMonophonic(samples: Float32Array, opts: RangeOptions, onProgress?: (p: number) => void): Promise<DetectedNote[]> {
  const res = await runWorker<{ notes: DetectedNote[] }>(
    {
      kind: 'yin',
      samples,
      sampleRate: ANALYSIS_SAMPLE_RATE,
      minFreq: midiToFrequency(opts.minMidi - 1),
      maxFreq: midiToFrequency(opts.maxMidi + 1),
      sensitivity: opts.sensitivity,
    },
    onProgress,
  );
  return res.notes.filter((n) => n.midi >= opts.minMidi && n.midi <= opts.maxMidi);
}

export interface RhythmAnalysis {
  tempo: TempoEstimate | null;
  /** 音の立ち上がりの強さ (拍の追跡に使う) */
  onset: { env: Float32Array; fps: number; offsetSeconds: number };
}

export async function analyzeRhythm(samples: Float32Array): Promise<RhythmAnalysis> {
  return runWorker<RhythmAnalysis>({ kind: 'tempo', samples, sampleRate: ANALYSIS_SAMPLE_RATE });
}

// Spotify の Basic Pitch (AI モデル) で伴奏込みの音源から音を拾う。
// TensorFlow.js が大きいので、使うときに初めて読み込む。
let basicPitch: Promise<{ bp: import('@spotify/basic-pitch').BasicPitch; lib: typeof import('@spotify/basic-pitch') }> | null = null;

function loadBasicPitch() {
  if (!basicPitch) {
    basicPitch = (async () => {
      const lib = await import('@spotify/basic-pitch');
      const modelUrl = new URL('models/basic-pitch/model.json', document.baseURI).href;
      const bp = new lib.BasicPitch(modelUrl);
      await bp.model;
      return { bp, lib };
    })();
    basicPitch.catch(() => (basicPitch = null));
  }
  return basicPitch;
}

/** AI で解析し、和音を含むすべての音を返す (メロディの抽出は呼び出し側で行う) */
export async function transcribePolyphonic(
  samples: Float32Array,
  opts: RangeOptions,
  onProgress?: (p: number, stage: string) => void,
): Promise<DetectedNote[]> {
  onProgress?.(0, 'AI モデルを読み込み中…');
  const { bp, lib } = await loadBasicPitch();
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await bp.evaluateModel(
    samples,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p, '解析中…'),
  );
  const s = opts.sensitivity;
  const events = lib.outputToNotesPoly(
    frames,
    onsets,
    0.6 - 0.3 * s,
    0.4 - 0.2 * s,
    6,
    true,
    midiToFrequency(opts.maxMidi + 0.5),
    midiToFrequency(opts.minMidi - 0.5),
    true,
  );
  const timed = lib.noteFramesToTime(lib.addPitchBendsToNoteEvents(contours, events));
  return timed.map((n, i) => ({
    id: i,
    start: n.startTimeSeconds,
    duration: n.durationSeconds,
    midi: n.pitchMidi,
    amplitude: n.amplitude,
  }));
}
