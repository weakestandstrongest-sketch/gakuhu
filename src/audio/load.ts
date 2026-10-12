import { pickMimeType } from './record';

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export class DecodeError extends Error {
  /** 再生しながら音声を取り出す方法 (decodeViaPlayback) なら読めるかもしれない */
  readonly canTryPlayback: boolean;
  constructor(message: string, canTryPlayback: boolean) {
    super(message);
    this.canTryPlayback = canTryPlayback;
  }
}

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const buf = await blob.arrayBuffer();
  try {
    return await audioContext().decodeAudioData(buf);
  } catch {
    throw new DecodeError(
      'このファイルの音声を直接読み込めませんでした。mp3 / m4a / wav / mp4 などを試してください。',
      typeof MediaRecorder !== 'undefined',
    );
  }
}

/**
 * iPhone で撮った .mov 動画のように decodeAudioData で読めないファイル用。
 * ブラウザで (音を出さずに) 再生しながら音声を録音し、それを読み込む。再生時間ぶん時間がかかる。
 * AudioContext を動かすため、ボタンを押したときなどユーザー操作の中で呼ぶこと。
 */
export async function decodeViaPlayback(blob: Blob, onProgress: (p: number) => void): Promise<AudioBuffer> {
  const ac = audioContext();
  await ac.resume();
  const url = URL.createObjectURL(blob);
  const media = document.createElement('video');
  media.playsInline = true;
  media.preload = 'auto';
  media.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve();
      media.onerror = () => reject(new Error('このファイルは再生できませんでした。'));
    });
    const source = ac.createMediaElementSource(media);
    const dest = ac.createMediaStreamDestination();
    // スピーカーには繋がないので、取り出し中に音は鳴らない
    source.connect(dest);
    const mimeType = pickMimeType();
    const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.start(1000);
    media.ontimeupdate = () => onProgress(media.duration ? media.currentTime / media.duration : 0);
    const ended = new Promise<void>((resolve, reject) => {
      media.onended = () => resolve();
      media.onerror = () => reject(new Error('再生中にエラーが起きました。'));
    });
    await media.play();
    await ended;
    rec.stop();
    await stopped;
    source.disconnect();
    onProgress(1);
    const recorded = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/mp4' });
    return await ac.decodeAudioData(await recorded.arrayBuffer());
  } finally {
    media.pause();
    URL.revokeObjectURL(url);
  }
}

/** 解析用に、指定区間をモノラル・指定サンプルレートに変換する */
export async function renderMono(buffer: AudioBuffer, start: number, end: number, sampleRate = 22050): Promise<Float32Array> {
  const s = Math.max(0, start);
  const e = Math.min(buffer.duration, end);
  const length = Math.max(1, Math.ceil((e - s) * sampleRate));
  const offline = new OfflineAudioContext(1, length, sampleRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0, s, e - s);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** 波形表示用に、区間ごとの最大振幅を求める */
export function computePeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const peaks = new Float32Array(columns);
  const ch = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const per = Math.max(1, Math.floor(buffer.length / columns));
  for (let c = 0; c < columns; c++) {
    let max = 0;
    const from = c * per;
    const to = Math.min(buffer.length, from + per);
    for (const data of ch) {
      for (let i = from; i < to; i += 4) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
    }
    peaks[c] = max;
  }
  return peaks;
}
